import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { DEMO_PASSWORD, seedIfEmpty } from './seed.js';
import { buildSlots, chileNow } from './time.js';

// Viernes 13 de noviembre de 2026, 12:00 en Chile (UTC-3 en horario de verano).
let clock = new Date('2026-11-13T15:00:00Z');
let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db);
  server = createApp(db, { now: () => clock }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  server.closeAllConnections();
});

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

async function login(email) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password: DEMO_PASSWORD });
  assert.equal(r.status, 200);
  return c;
}

const copec = () => db.prepare("SELECT * FROM shops WHERE name = 'Pronto Copec'").get();
const productOf = (shopId, name) => db.prepare('SELECT * FROM products WHERE shop_id = ? AND name = ?').get(shopId, name);

test('la hora de Chile y las franjas respetan la anticipación y el cierre', () => {
  assert.deepEqual(chileNow(clock), { date: '2026-11-13', minutes: 720 });
  const slots = buildSlots({ opens: 450, closes: 1320, prep_minutes: 10, slot_capacity: 6, paused: 0 }, clock);
  assert.equal(slots[0].slot, '2026-11-13T12:10');
  const today = slots.filter((s) => s.day === 'hoy');
  assert.equal(today.at(-1).time, '22:00');
  const tomorrow = slots.filter((s) => s.day === 'manana');
  assert.equal(tomorrow[0].slot, '2026-11-14T07:40');
  assert.equal(buildSlots({ opens: 450, closes: 1320, prep_minutes: 10, slot_capacity: 6, paused: 1 }, clock).length, 0);
});

test('registro valida los datos y no permite correos repetidos', async () => {
  const c = client();
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  let r = await c('POST', '/api/auth/register', { name: 'Ana', email: 'ana@duocuc.cl', password: 'corta', campusId: campus });
  assert.equal(r.status, 400);
  r = await c('POST', '/api/auth/register', { name: 'Ana', email: 'ana@duocuc.cl', password: 'clave-segura', campusId: campus });
  assert.equal(r.status, 201);
  assert.equal(r.body.role, 'student');
  assert.equal((await c('GET', '/api/me')).body.email, 'ana@duocuc.cl');
  r = await client()('POST', '/api/auth/register', { name: 'Otra', email: 'ANA@duocuc.cl', password: 'clave-segura', campusId: campus });
  assert.equal(r.status, 409);
  assert.equal((await client()('GET', '/api/me')).status, 401);
});

test('flujo completo: pedir, preparar, avisar y retirar con código', async () => {
  const student = await login('estudiante@pickgo.cl');
  const shopUser = await login('copec@pickgo.cl');
  const shop = copec();
  const menu = productOf(shop.id, 'Menú ejecutivo casero');
  const agua = productOf(shop.id, 'Agua mineral');

  const slots = (await student('GET', `/api/shops/${shop.id}/slots`)).body;
  assert.equal(slots[0].remaining, 6);

  const created = await student('POST', '/api/orders', {
    shopId: shop.id,
    slot: slots[0].slot,
    paymentMethod: 'efectivo',
    note: 'Sin mayonesa',
    // El precio que mande el cliente se ignora: el total se calcula con los precios de la base.
    items: [
      { productId: menu.id, qty: 2, price: 1 },
      { productId: agua.id, qty: 1 },
    ],
  });
  assert.equal(created.status, 201);
  const order = created.body;
  assert.equal(order.total, 4500 * 2 + 1000);
  assert.equal(order.status, 'recibido');
  assert.equal(order.paid, false);
  assert.match(order.code, /^PG[2-9A-Z]{4}$/);

  assert.equal((await student('GET', `/api/shops/${shop.id}/slots`)).body[0].remaining, 5);

  const board = (await shopUser('GET', '/api/shop/orders')).body;
  assert.equal(board.orders.length, 1);
  assert.equal(board.orders[0].customer_name, 'Estudiante Demo');

  // Un estudiante no puede usar el panel del local, y un local no puede tocar pedidos de otro.
  assert.equal((await student('GET', '/api/shop/orders')).status, 403);
  const other = await login('pepepug@pickgo.cl');
  assert.equal((await other('POST', `/api/shop/orders/${order.id}/status`, { status: 'listo' })).status, 404);
  assert.equal((await other('POST', '/api/shop/pickup', { code: order.code })).status, 404);

  let r = await shopUser('POST', `/api/shop/orders/${order.id}/status`, { status: 'preparando' });
  assert.equal(r.body.status, 'preparando');
  assert.equal((await student('POST', `/api/orders/${order.id}/cancel`)).status, 409);
  assert.equal((await shopUser('POST', `/api/shop/orders/${order.id}/status`, { status: 'recibido' })).status, 400);
  r = await shopUser('POST', `/api/shop/orders/${order.id}/status`, { status: 'listo' });
  assert.equal(r.body.status, 'listo');

  r = await shopUser('POST', '/api/shop/pickup', { code: order.code.toLowerCase() });
  assert.equal(r.body.status, 'entregado');
  assert.equal(r.body.paid, true);
  assert.equal((await shopUser('POST', '/api/shop/pickup', { code: order.code })).status, 409);

  const mine = (await student('GET', `/api/orders/${order.id}`)).body;
  assert.deepEqual(
    mine.events.map((e) => e.status),
    ['recibido', 'preparando', 'listo', 'entregado'],
  );
});

test('cada franja tiene cupo y cancelar lo libera', async () => {
  const shop = copec();
  const item = [{ productId: productOf(shop.id, 'Café americano').id, qty: 1 }];
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const slot = '2026-11-13T13:00';
  const orders = [];
  for (let i = 0; i < shop.slot_capacity; i++) {
    const c = client();
    await c('POST', '/api/auth/register', { name: `Est ${i}`, email: `est${i}@duocuc.cl`, password: 'clave-segura', campusId: campus });
    const r = await c('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
    assert.equal(r.status, 201);
    assert.equal(r.body.paid, true);
    orders.push({ c, id: r.body.id });
  }
  const late = await login('estudiante@pickgo.cl');
  let r = await late('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /se llenó/);

  r = await orders[0].c('POST', `/api/orders/${orders[0].id}/cancel`);
  assert.equal(r.body.status, 'cancelado');
  r = await late('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
  assert.equal(r.status, 201);
});

test('no se puede pedir para una hora pasada, productos agotados ni locales en pausa', async () => {
  const student = await login('estudiante@pickgo.cl');
  const shopUser = await login('copec@pickgo.cl');
  const shop = copec();
  const cafe = productOf(shop.id, 'Café americano');
  const good = { shopId: shop.id, slot: '2026-11-13T14:00', paymentMethod: 'junaeb', items: [{ productId: cafe.id, qty: 1 }] };

  assert.equal((await student('POST', '/api/orders', { ...good, slot: '2026-11-13T11:00' })).status, 409);
  assert.equal((await student('POST', '/api/orders', { ...good, slot: '2026-11-13T12:05' })).status, 409);
  assert.equal((await student('POST', '/api/orders', { ...good, items: [] })).status, 400);
  assert.equal((await student('POST', '/api/orders', { ...good, items: [{ productId: cafe.id, qty: 0 }] })).status, 400);
  const ajeno = productOf(db.prepare("SELECT id FROM shops WHERE name = 'Pepepug'").get().id, 'Papas fritas');
  assert.equal((await student('POST', '/api/orders', { ...good, items: [{ productId: ajeno.id, qty: 1 }] })).status, 409);

  await shopUser('PATCH', `/api/shop/products/${cafe.id}`, { available: false });
  let r = await student('POST', '/api/orders', good);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /se agotó/);
  await shopUser('PATCH', `/api/shop/products/${cafe.id}`, { available: true });

  await shopUser('PATCH', '/api/shop/me', { paused: true });
  assert.equal((await student('POST', '/api/orders', good)).status, 409);
  assert.equal((await student('GET', `/api/shops/${shop.id}/slots`)).body.length, 0);
  await shopUser('PATCH', '/api/shop/me', { paused: false });
  assert.equal((await student('POST', '/api/orders', good)).status, 201);
});

test('un local nuevo se registra, arma su menú y aparece en la sede', async () => {
  const c = client();
  const campus = db.prepare("SELECT id FROM campuses WHERE name = 'Sede Valparaíso'").get().id;
  let r = await c('POST', '/api/auth/register-shop', {
    name: 'Carla',
    email: 'carla@local.cl',
    password: 'clave-segura',
    campusId: campus,
    shopName: 'Kiosko Puerto',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.role, 'shop');
  r = await c('POST', '/api/shop/products', { category: 'Snacks', name: 'Sopaipilla', price: 500 });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal((await c('POST', '/api/shop/products', { category: 'Snacks', name: 'Mala', price: -5 })).status, 400);

  const student = await login('estudiante@pickgo.cl');
  const shops = (await student('GET', `/api/campuses/${campus}/shops`)).body;
  assert.equal(shops.length, 1);
  assert.equal((await student('GET', `/api/shops/${shops[0].id}`)).body.products.length, 1);
  await c('DELETE', `/api/shop/products/${id}`);
  assert.equal((await student('GET', `/api/shops/${shops[0].id}`)).body.products.length, 0);
});
