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
const pushed = [];

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, { now: clock, history: false });
  const push = { publicKey: 'clave-de-prueba', toUser: (id, p) => pushed.push({ user: id, ...p }), toShop: (id, p) => pushed.push({ shop: id, ...p }) };
  server = createApp(db, { now: () => clock, push }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  server.closeAllConnections();
});

function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
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

test('un local nuevo queda pendiente hasta que la institución lo aprueba', async () => {
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
  assert.equal(r.body.shop_status, 'pendiente');
  const shopId = r.body.shop_id;
  r = await c('POST', '/api/shop/products', { category: 'Snacks', name: 'Sopaipilla', price: 500 });
  assert.equal(r.status, 201);
  const productId = r.body.id;
  assert.equal((await c('POST', '/api/shop/products', { category: 'Snacks', name: 'Mala', price: -5 })).status, 400);
  // El dueño ve su menú aunque esté pendiente; los estudiantes todavía no.
  assert.equal((await c('GET', `/api/shops/${shopId}`)).body.products.length, 1);
  const student = await login('estudiante@pickgo.cl');
  assert.equal((await student('GET', `/api/campuses/${campus}/shops`)).body.length, 0);
  assert.equal((await student('GET', `/api/shops/${shopId}`)).status, 404);
  r = await student('POST', '/api/orders', { shopId, slot: '2026-11-13T13:00', paymentMethod: 'tarjeta', items: [{ productId, qty: 1 }] });
  assert.equal(r.status, 404);

  // Solo la administración de esa institución puede aprobarlo.
  assert.equal((await student('POST', `/api/admin/shops/${shopId}/status`, { status: 'activo' })).status, 403);
  const otherAdmin = await login('admin2@pickgo.cl');
  assert.equal((await otherAdmin('POST', `/api/admin/shops/${shopId}/status`, { status: 'activo' })).status, 404);
  const admin = await login('admin@pickgo.cl');
  const overview = (await admin('GET', '/api/admin/overview')).body;
  assert.equal(overview.institution, 'Duoc UC');
  assert.equal(overview.shops.find((s) => s.id === shopId).status, 'pendiente');
  assert.ok(overview.totals.orders > 0);
  assert.ok(!overview.shops.some((s) => s.name === 'Cafetería Central'));
  assert.equal((await admin('POST', `/api/admin/shops/${shopId}/status`, { status: 'activo' })).status, 200);
  assert.equal((await student('GET', `/api/campuses/${campus}/shops`)).body.length, 1);

  await c('DELETE', `/api/shop/products/${productId}`);
  assert.equal((await student('GET', `/api/shops/${shopId}`)).body.products.length, 0);
  assert.equal((await admin('POST', '/api/admin/campuses', { name: 'Sede Maipú', city: 'Santiago' })).status, 201);
  assert.equal((await admin('POST', '/api/admin/campuses', { name: 'sede maipú', city: 'Santiago' })).status, 409);
});

test('cabeceras de seguridad y rechazo de solicitudes desde otros sitios', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);

  const student = await login('estudiante@pickgo.cl');
  const body = { name: 'Hackeado' };
  assert.equal((await student('PATCH', '/api/me', body, { Origin: 'https://sitio-malicioso.example' })).status, 403);
  assert.equal((await student('PATCH', '/api/me', body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await student('GET', '/api/me')).body.name, 'Estudiante Demo');
  const ok = await student('PATCH', '/api/me', { name: 'Estudiante Demo' }, { Origin: base, 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(ok.status, 200);
});

test('la cuenta se bloquea tras varios intentos fallidos y se rechazan contraseñas débiles', async () => {
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const c = client();
  for (const password of ['12345678', 'pickgo123', 'aaaaaaaa', 'lola@duocuc.cl']) {
    const r = await c('POST', '/api/auth/register', { name: 'Lola', email: 'lola@duocuc.cl', password, campusId: campus });
    assert.equal(r.status, 400, password);
  }
  await c('POST', '/api/auth/register', { name: 'Lola', email: 'lola@duocuc.cl', password: 'clave-segura', campusId: campus });
  const attacker = client();
  for (let i = 0; i < 8; i++)
    assert.equal((await attacker('POST', '/api/auth/login', { email: 'lola@duocuc.cl', password: `intento-${i}` })).status, 401);
  // Bloqueada incluso con la contraseña correcta, hasta que pase la ventana.
  assert.equal((await attacker('POST', '/api/auth/login', { email: 'lola@duocuc.cl', password: 'clave-segura' })).status, 429);
});

test('cambiar la contraseña cierra las demás sesiones; eliminar la cuenta borra los datos personales', async () => {
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const phone = client();
  const r0 = await phone('POST', '/api/auth/register', { name: 'Pedro Paz', email: 'pedro@duocuc.cl', password: 'clave-segura', campusId: campus });
  const laptop = client();
  await laptop('POST', '/api/auth/login', { email: 'pedro@duocuc.cl', password: 'clave-segura' });
  assert.equal((await phone('POST', '/api/me/password', { current: 'equivocada', next: 'otra-clave-segura' })).status, 403);
  assert.equal((await phone('POST', '/api/me/password', { current: 'clave-segura', next: 'otra-clave-segura' })).status, 200);
  assert.equal((await phone('GET', '/api/me')).status, 200);
  assert.equal((await laptop('GET', '/api/me')).status, 401);

  const exported = (await phone('GET', '/api/me/export')).body;
  assert.equal(exported.cuenta.email, 'pedro@duocuc.cl');
  assert.equal((await phone('POST', '/api/me/delete', { password: 'otra-clave-segura' })).status, 200);
  assert.equal((await phone('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'pedro@duocuc.cl', password: 'otra-clave-segura' })).status, 401);
  const row = db.prepare('SELECT name, email FROM users WHERE id = ?').get(r0.body.id);
  assert.equal(row.name, 'Cuenta eliminada');
  assert.doesNotMatch(row.email, /pedro/);
});

test('calificación, puntualidad, pedidos no retirados y avisos push', async () => {
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const student = client();
  const me = (await student('POST', '/api/auth/register', { name: 'Sofía Lagos', email: 'sofia@duocuc.cl', password: 'clave-segura', campusId: campus })).body;
  assert.equal(me.cash_allowed, true);
  const shopUser = await login('casino@pickgo.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Casino'").get();
  const item = [{ productId: productOf(shop.id, 'Menú del día').id, qty: 1 }];
  const order = async (slot, paymentMethod = 'efectivo') =>
    (await student('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod, items: item })).body;

  pushed.length = 0;
  const first = await order('2026-11-13T12:30');
  assert.equal(pushed.at(-1).shop, shop.id);
  assert.match(pushed.at(-1).title, /12:30/);
  assert.equal((await student('POST', `/api/orders/${first.id}/rate`, { rating: 5 })).status, 409);
  await shopUser('POST', `/api/shop/orders/${first.id}/status`, { status: 'listo' });
  assert.equal(pushed.at(-1).user, me.id);
  assert.match(pushed.at(-1).body, /está listo/);
  // Todavía no pasa la hora de retiro: no se puede marcar como no retirado.
  assert.equal((await shopUser('POST', `/api/shop/orders/${first.id}/status`, { status: 'no_retirado' })).status, 409);
  let r = await shopUser('POST', `/api/shop/orders/${first.id}/status`, { status: 'entregado' });
  assert.equal(r.body.on_time, true);
  assert.equal((await student('POST', `/api/orders/${first.id}/rate`, { rating: 9 })).status, 400);
  r = await student('POST', `/api/orders/${first.id}/rate`, { rating: 4, comment: 'Rápido y rico' });
  assert.equal(r.body.rating, 4);
  assert.equal((await student('GET', `/api/shops/${shop.id}`)).body.shop.rating, 4);

  // Dos pedidos en efectivo que nadie retira: después se exige pago anticipado.
  const a = await order('2026-11-13T12:40');
  const b = await order('2026-11-13T12:50');
  const real = clock;
  clock = new Date('2026-11-13T16:30:00Z'); // 13:30 en Chile
  for (const o of [a, b]) {
    r = await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'listo' });
    assert.equal(r.body.on_time, false);
    assert.equal((await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'no_retirado' })).status, 200);
  }
  assert.equal((await student('GET', '/api/me')).body.cash_allowed, false);
  r = await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T14:00', paymentMethod: 'efectivo', items: item });
  assert.equal(r.status, 409);
  assert.equal((await order('2026-11-13T14:00', 'tarjeta')).status, 'recibido');

  const stats = (await shopUser('GET', '/api/shop/stats')).body;
  assert.equal(stats.totals.no_show, 2);
  assert.equal(stats.totals.delivered, 1);
  assert.equal(stats.totals.sales, 4200);
  assert.equal(stats.totals.on_time_pct, 33);
  assert.equal(stats.by_day.length, 7);
  assert.equal(stats.comments[0].comment, 'Rápido y rico');
  clock = real;
});

test('las suscripciones push solo aceptan servicios de notificación conocidos', async () => {
  const student = await login('estudiante@pickgo.cl');
  const keys = { p256dh: 'BNc'.repeat(20), auth: 'abc123' };
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://interno.empresa.cl/push', 'no-es-url'])
    assert.equal((await student('POST', '/api/push/subscribe', { endpoint, keys })).status, 400, endpoint);
  assert.equal((await student('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status, 201);
  assert.equal((await student('POST', '/api/push/subscribe', { endpoint: 'https://web.push.apple.com/abc', keys })).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions').get().c, 2);
  assert.equal((await client()('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/zzz', keys })).status, 401);
});
