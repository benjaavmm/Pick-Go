import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, SCHEMA_VERSION } from './db.js';
import { DEMO_PASSWORD, seedIfEmpty } from './seed.js';
import { buildSlots, chileNow } from './time.js';

// Viernes 13 de noviembre de 2026, 12:00 en Chile (UTC-3 en horario de verano).
let clock = new Date('2026-11-13T15:00:00Z');
let server;
let base;
let db;
const pushed = [];
const mails = [];

before(async () => {
  db = openDb(':memory:');
  seedIfEmpty(db, { now: clock, history: false });
  const push = { publicKey: 'clave-de-prueba', toUser: (id, p) => pushed.push({ user: id, ...p }), toShop: (id, p) => pushed.push({ shop: id, ...p }) };
  const mail = { link: (p) => `https://gobite.test${p}`, send: async (m) => void mails.push(m) };
  server = createApp(db, { now: () => clock, push, mail }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  server.closeAllConnections();
});

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  call.cookie = () => cookie;
  call.raw = async (path, bytes, type) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': type, Cookie: cookie }, body: bytes });
    return { status: res.status, body: await res.json() };
  };
  return call;
}

async function login(email) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { email, password: DEMO_PASSWORD });
  assert.equal(r.status, 200);
  return c;
}

const anden = () => db.prepare("SELECT * FROM shops WHERE name = 'Café Andén'").get();
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
  const student = await login('estudiante@gobite.cl');
  const shopUser = await login('cafe@gobite.cl');
  const shop = anden();
  const menu = productOf(shop.id, 'Plato del día');
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
      { productId: menu.id, qty: 2, price: 1, choices: ['a1', 'e2'] },
      { productId: agua.id, qty: 1 },
    ],
  });
  assert.equal(created.status, 201);
  const order = created.body;
  // Plato del día $4.300 + postre $700, dos veces, más el agua.
  assert.equal(order.total, (4300 + 700) * 2 + 1000);
  assert.deepEqual(order.items[0].options.map((o) => o.name), ['Arroz', 'Postre']);
  assert.equal(order.payment_method, 'local');
  // Falta la opción obligatoria, se eligen dos donde va una, o se manda una que no existe.
  for (const choices of [[], ['a1', 'a2'], ['a1', 'zz']]) {
    const bad = await student('POST', '/api/orders', { shopId: shop.id, slot: slots[1].slot, items: [{ productId: menu.id, qty: 1, choices }] });
    assert.equal(bad.status >= 400 && bad.status < 500, true, JSON.stringify(choices));
  }
  assert.equal(order.status, 'recibido');
  assert.equal(order.paid, false);
  assert.match(order.code, /^GB[2-9A-Z]{4}$/);

  assert.equal((await student('GET', `/api/shops/${shop.id}/slots`)).body[0].remaining, 5);

  const board = (await shopUser('GET', '/api/shop/orders')).body;
  assert.equal(board.orders.length, 1);
  assert.equal(board.orders[0].customer_name, 'Estudiante Demo');

  // Un estudiante no puede usar el panel del local, y un local no puede tocar pedidos de otro.
  assert.equal((await student('GET', '/api/shop/orders')).status, 403);
  const other = await login('sangucheria@gobite.cl');
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
  const shop = anden();
  const item = [{ productId: productOf(shop.id, 'Café americano').id, qty: 1, choices: ['t1'] }];
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const slot = '2026-11-13T13:00';
  const orders = [];
  for (let i = 0; i < shop.slot_capacity; i++) {
    const c = client();
    await c('POST', '/api/auth/register', { name: `Est ${i}`, email: `est${i}@duocuc.cl`, password: 'clave-segura', campusId: campus });
    const r = await c('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
    assert.equal(r.status, 201);
    assert.equal(r.body.paid, false);
    orders.push({ c, id: r.body.id });
  }
  const late = await login('estudiante@gobite.cl');
  let r = await late('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /se llenó/);

  r = await orders[0].c('POST', `/api/orders/${orders[0].id}/cancel`);
  assert.equal(r.body.status, 'cancelado');
  r = await late('POST', '/api/orders', { shopId: shop.id, slot, paymentMethod: 'tarjeta', items: item });
  assert.equal(r.status, 201);
});

test('no se puede pedir para una hora pasada, productos agotados ni locales en pausa', async () => {
  const student = await login('estudiante@gobite.cl');
  const shopUser = await login('cafe@gobite.cl');
  const shop = anden();
  const cafe = productOf(shop.id, 'Café americano');
  const good = { shopId: shop.id, slot: '2026-11-13T14:00', items: [{ productId: cafe.id, qty: 1, choices: ['t1'] }] };

  assert.equal((await student('POST', '/api/orders', { ...good, slot: '2026-11-13T11:00' })).status, 409);
  assert.equal((await student('POST', '/api/orders', { ...good, slot: '2026-11-13T12:05' })).status, 409);
  assert.equal((await student('POST', '/api/orders', { ...good, items: [] })).status, 400);
  assert.equal((await student('POST', '/api/orders', { ...good, items: [{ productId: cafe.id, qty: 0 }] })).status, 400);
  const ajeno = productOf(db.prepare("SELECT id FROM shops WHERE name = 'La Sanguchería'").get().id, 'Papas fritas');
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
  const student = await login('estudiante@gobite.cl');
  assert.equal((await student('GET', `/api/campuses/${campus}/shops`)).body.length, 0);
  assert.equal((await student('GET', `/api/shops/${shopId}`)).status, 404);
  r = await student('POST', '/api/orders', { shopId, slot: '2026-11-13T13:00', paymentMethod: 'tarjeta', items: [{ productId, qty: 1 }] });
  assert.equal(r.status, 404);

  // Solo la administración de esa institución puede aprobarlo.
  assert.equal((await student('POST', `/api/admin/shops/${shopId}/status`, { status: 'activo' })).status, 403);
  const otherAdmin = await login('admin2@gobite.cl');
  assert.equal((await otherAdmin('POST', `/api/admin/shops/${shopId}/status`, { status: 'activo' })).status, 404);
  const admin = await login('admin@gobite.cl');
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

  const student = await login('estudiante@gobite.cl');
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
  for (const password of ['12345678', 'gobite123', 'aaaaaaaa', 'lola@duocuc.cl']) {
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
  assert.equal(me.can_order, true);
  const shopUser = await login('casino@gobite.cl');
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
  // Entregar sin el código no se puede; con el código de otro pedido, tampoco.
  assert.equal((await shopUser('POST', `/api/shop/orders/${first.id}/status`, { status: 'entregado' })).status, 400);
  const board = (await shopUser('GET', '/api/shop/orders')).body.orders.find((o) => o.id === first.id);
  assert.equal(board.code, null);
  assert.equal((await shopUser('POST', '/api/shop/pickup', { code: 'GBZZZZ', orderId: first.id })).status, 409);
  let r = await shopUser('POST', '/api/shop/pickup', { code: first.code, orderId: first.id });
  assert.equal(r.body.on_time, true);
  assert.equal((await student('POST', `/api/orders/${first.id}/rate`, { rating: 9 })).status, 400);
  r = await student('POST', `/api/orders/${first.id}/rate`, { rating: 4, comment: 'Rápido y rico' });
  assert.equal(r.body.rating, 4);
  assert.equal((await student('GET', `/api/shops/${shop.id}`)).body.shop.rating, 4);

  // Tres pedidos que nadie retira: se suspenden los pedidos nuevos de esa cuenta.
  const a = await order('2026-11-13T12:40');
  const b = await order('2026-11-13T12:50');
  const c = await order('2026-11-13T13:00');
  const real = clock;
  clock = new Date('2026-11-13T16:30:00Z'); // 13:30 en Chile
  for (const o of [a, b, c]) {
    r = await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'listo' });
    assert.equal(r.body.on_time, false);
    assert.equal((await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'no_retirado' })).status, 200);
  }
  assert.equal((await student('GET', '/api/me')).body.can_order, false);
  r = await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T14:00', items: item });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /sin retirar/);

  const stats = (await shopUser('GET', '/api/shop/stats')).body;
  assert.equal(stats.totals.no_show, 3);
  assert.equal(stats.totals.delivered, 1);
  assert.equal(stats.totals.sales, 4000);
  assert.equal(stats.totals.on_time_pct, 25);
  assert.equal(stats.by_day.length, 7);
  assert.equal(stats.comments[0].comment, 'Rápido y rico');
  clock = real;
});

test('las suscripciones push solo aceptan servicios de notificación conocidos', async () => {
  const student = await login('estudiante@gobite.cl');
  const keys = { p256dh: 'BNc'.repeat(20), auth: 'abc123' };
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://interno.empresa.cl/push', 'no-es-url'])
    assert.equal((await student('POST', '/api/push/subscribe', { endpoint, keys })).status, 400, endpoint);
  assert.equal((await student('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status, 201);
  assert.equal((await student('POST', '/api/push/subscribe', { endpoint: 'https://web.push.apple.com/abc', keys })).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions').get().c, 2);
  assert.equal((await client()('POST', '/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/zzz', keys })).status, 401);
});

test('fotos y opciones de productos: solo imágenes reales y solo del propio local', async () => {
  const shopUser = await login('sangucheria@gobite.cl');
  const other = await login('casino@gobite.cl');
  const upload = async (c, bytes, type = 'image/png') => {
    const login2 = await c('GET', '/api/me');
    assert.equal(login2.status, 200);
    return c.raw('/api/shop/images', bytes, type);
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  // Un archivo que dice ser PNG pero no lo es.
  assert.equal((await upload(shopUser, Buffer.from('<script>alert(1)</script>'))).status, 400);
  assert.equal((await upload(shopUser, Buffer.alloc(600 * 1024, 1))).status, 413);
  const up = await upload(shopUser, png);
  assert.equal(up.status, 201);
  const img = await fetch(base + up.body.url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await img.arrayBuffer()).equals(png), true);

  const options = [
    { name: 'Tamaño', required: true, multiple: false, choices: [{ name: 'Normal', price: 0 }, { name: 'XL', price: 900 }] },
    { name: 'Salsas', required: false, multiple: true, choices: [{ name: 'Ají', price: 0 }, { name: 'Ajo', price: 100 }] },
  ];
  // Otro local no puede usar esta foto en sus productos.
  let r = await other('POST', '/api/shop/products', { category: 'X', name: 'Ajeno', price: 100, imageId: up.body.id });
  assert.equal(r.status, 400);
  r = await shopUser('POST', '/api/shop/products', { category: 'Papas', name: 'Papas rústicas', price: 2500, emoji: '', imageId: up.body.id, options });
  assert.equal(r.status, 201);
  const product = r.body;
  assert.equal(product.image, up.body.url);
  assert.equal(product.emoji, '');
  assert.equal(product.options.length, 2);
  const [size, sauces] = product.options;
  assert.ok(size.choices[1].id && sauces.choices[0].id !== sauces.choices[1].id);
  assert.equal((await shopUser('PATCH', `/api/shop/products/${product.id}`, { options: [{ name: 'Vacío', choices: [] }] })).status, 400);
  assert.equal((await shopUser('PATCH', `/api/shop/products/${product.id}`, { options: [{ name: 'Precio', choices: [{ name: 'x', price: -1 }] }] })).status, 400);

  const student = await login('demo-opciones@duocuc.cl').catch(() => null);
  assert.equal(student, null);
  const c = client();
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  await c('POST', '/api/auth/register', { name: 'Nico', email: 'nico@duocuc.cl', password: 'clave-segura', campusId: campus });
  r = await c('POST', '/api/orders', {
    shopId: product.shop_id,
    slot: '2026-11-13T15:00',
    items: [
      { productId: product.id, qty: 1, choices: [size.choices[1].id, sauces.choices[0].id, sauces.choices[1].id] },
      { productId: product.id, qty: 2, choices: [size.choices[0].id] },
    ],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.total, 2500 + 900 + 100 + 2500 * 2);
  // Quitar la foto la elimina del producto.
  r = await shopUser('PATCH', `/api/shop/products/${product.id}`, { imageId: null });
  assert.equal(r.body.image, null);
});

test('la plataforma crea instituciones y recupera accesos; nadie más puede', async () => {
  const owner = await login('plataforma@gobite.cl');
  const admin = await login('admin@gobite.cl');
  const body = { name: 'Instituto Profesional Andes', campus: 'Sede Centro', city: 'Concepción', adminEmail: 'admin@ipandes.cl' };
  assert.equal((await admin('POST', '/api/owner/institutions', body)).status, 403);
  assert.equal((await admin('GET', '/api/owner/overview')).status, 403);
  let r = await owner('POST', '/api/owner/institutions', body);
  assert.equal(r.status, 201);
  const { email, password } = r.body.admin;
  assert.equal((await owner('POST', '/api/owner/institutions', body)).status, 409);

  const fresh = client();
  r = await fresh('POST', '/api/auth/login', { email, password });
  assert.equal(r.body.role, 'admin');
  assert.equal(r.body.institution, 'Instituto Profesional Andes');
  assert.equal((await fresh('GET', '/api/admin/overview')).body.campuses[0].name, 'Sede Centro');
  const list = (await owner('GET', '/api/owner/overview')).body.institutions;
  assert.equal(list.find((i) => i.name === body.name).admins[0].email, email);

  // Recuperar el acceso de alguien que olvidó su contraseña: nueva clave temporal y sesiones cerradas.
  r = await owner('POST', '/api/owner/reset-password', { email });
  assert.equal(r.status, 200);
  assert.equal((await fresh('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email, password })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email, password: r.body.password })).status, 200);
  assert.equal((await owner('POST', '/api/owner/reset-password', { email: 'plataforma@gobite.cl' })).status, 403);
  assert.equal((await owner('POST', '/api/owner/reset-password', { email: 'nadie@x.cl' })).status, 404);
});

test('aceptación automática: el pedido entra directo a preparación y se avisa al estudiante', async () => {
  const shopUser = await login('sangucheria@gobite.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'La Sanguchería'").get();
  assert.equal((await shopUser('PATCH', '/api/shop/me', { auto_accept: true })).body.auto_accept, true);
  const c = client();
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const me = (await c('POST', '/api/auth/register', { name: 'Auto', email: 'auto@duocuc.cl', password: 'clave-segura', campusId: campus })).body;
  pushed.length = 0;
  const r = await c('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T15:30', items: [{ productId: productOf(shop.id, 'Papas fritas').id, qty: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'preparando');
  assert.deepEqual(r.body.events.map((e) => e.status), ['recibido', 'preparando']);
  assert.ok(pushed.some((p) => p.user === me.id && /aceptó/.test(p.body)));
  assert.equal((await c('POST', `/api/orders/${r.body.id}/cancel`)).status, 409);
  await shopUser('PATCH', '/api/shop/me', { auto_accept: false });
});

test('una base de la versión 3 se actualiza sin perder datos', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gobite-')), 'v3.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
            CREATE TABLE shops (id INTEGER PRIMARY KEY, name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER);
            INSERT INTO orders (total) VALUES (4500);
            INSERT INTO shops (name, paused) VALUES ('Kiosko antiguo', 1);
            PRAGMA user_version = 3;`);
  old.close();
  const migrated = openDb(file);
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const row = migrated.prepare('SELECT name, paused, auto_accept, days FROM shops').get();
  assert.deepEqual({ ...row }, { name: 'Kiosko antiguo', paused: 1, auto_accept: 0, days: '0123456' });
  assert.deepEqual({ ...migrated.prepare('SELECT total, cancel_reason, subtotal FROM orders').get() }, { total: 4500, cancel_reason: '', subtotal: 4500 });
  assert.equal(migrated.prepare('SELECT COUNT(*) AS c FROM password_resets').get().c, 0);
  migrated.close();
  // Una base anterior a la primera versión migrable no se toca: se rechaza para apartarla.
  const ancient = path.join(path.dirname(file), 'v2.db');
  const a = new DatabaseSync(ancient);
  a.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); PRAGMA user_version = 2;');
  a.close();
  assert.throws(() => openDb(ancient), { code: 'OLD_DB' });
});

test('recuperar la contraseña por correo: enlace de un solo uso que vence', async () => {
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const c = client();
  await c('POST', '/api/auth/register', { name: 'Olvido', email: 'olvido@duocuc.cl', password: 'clave-original-1', campusId: campus });
  mails.length = 0;
  // Misma respuesta exista o no la cuenta, y sin correo para la que no existe.
  assert.deepEqual((await client()('POST', '/api/auth/forgot', { email: 'nadie@duocuc.cl' })).body, { ok: true });
  assert.equal(mails.length, 0);
  assert.deepEqual((await client()('POST', '/api/auth/forgot', { email: 'OLVIDO@duocuc.cl' })).body, { ok: true });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'olvido@duocuc.cl');
  const token = mails[0].text.match(/https:\/\/gobite\.test\/restablecer\?token=([\w-]+)/)[1];
  // El token no queda guardado tal cual en la base.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM password_resets WHERE token_hash = ?').get(token).c, 0);

  assert.equal((await client()('POST', '/api/auth/reset', { token: 'inventado', password: 'otra-clave-nueva-1' })).status, 400);
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: '12345678' })).status, 400);
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'otra-clave-nueva-1' })).status, 200);
  assert.equal((await c('GET', '/api/me')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'olvido@duocuc.cl', password: 'clave-original-1' })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { email: 'olvido@duocuc.cl', password: 'otra-clave-nueva-1' })).status, 200);
  // Un solo uso.
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'tercera-clave-nueva-1' })).status, 400);

  // Un enlace vencido no sirve.
  await client()('POST', '/api/auth/forgot', { email: 'olvido@duocuc.cl' });
  const second = mails.at(-1).text.match(/token=([\w-]+)/)[1];
  const real = clock;
  clock = new Date(real.getTime() + 31 * 60000);
  assert.equal((await client()('POST', '/api/auth/reset', { token: second, password: 'tercera-clave-nueva-1' })).status, 400);
  clock = real;
  // Tope de solicitudes por cuenta: no se puede usar para llenar de correos a alguien.
  const before = mails.length;
  for (let i = 0; i < 5; i++) await client()('POST', '/api/auth/forgot', { email: 'olvido@duocuc.cl' });
  assert.ok(mails.length - before <= 1);
});

test('días de atención, motivo al rechazar y exportación de pedidos', async () => {
  const shopUser = await login('casino@gobite.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Casino'").get();
  const student = await login('estudiante@gobite.cl');
  // El 13 de noviembre de 2026 es viernes (5) y el 14, sábado (6).
  assert.equal((await shopUser('PATCH', '/api/shop/me', { days: '' })).status, 400);
  let r = await shopUser('PATCH', '/api/shop/me', { days: '12345' });
  assert.equal(r.body.days, '12345');
  let slots = (await student('GET', `/api/shops/${shop.id}/slots`)).body;
  assert.ok(slots.length > 0 && slots.every((s) => s.day === 'hoy'));
  r = await shopUser('PATCH', '/api/shop/me', { days: '6' });
  slots = (await student('GET', `/api/shops/${shop.id}/slots`)).body;
  assert.ok(slots.length > 0 && slots.every((s) => s.day === 'manana'));
  assert.equal(r.body.is_open, false);
  await shopUser('PATCH', '/api/shop/me', { days: '0123456' });

  const item = [{ productId: productOf(shop.id, 'Menú del día').id, qty: 1 }];
  const o = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T15:00', items: item })).body;
  pushed.length = 0;
  r = await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'cancelado', reason: 'Se nos acabó el menú del día' });
  assert.equal(r.body.cancel_reason, 'Se nos acabó el menú del día');
  assert.match(pushed.at(-1).body, /Se nos acabó el menú del día/);
  assert.equal((await student('GET', `/api/orders/${o.id}`)).body.cancel_reason, 'Se nos acabó el menú del día');

  const res = await fetch(`${base}/api/shop/orders.csv`, { headers: { Cookie: shopUser.cookie() } });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /"Fecha";"Hora de retiro";"Código"/);
  assert.match(csv, new RegExp(`"${o.code}";"Estudiante Demo";"1x Menú del día";"4000";"En el local";"Cancelado"`));
  assert.equal((await fetch(`${base}/api/shop/orders.csv`, { headers: { Cookie: student.cookie() } })).status, 403);
});

test('el local no ve el código de retiro y tiene un tope de intentos por pedido', async () => {
  const shopUser = await login('casino@gobite.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Casino'").get();
  const student = await login('estudiante@gobite.cl');
  const o = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T16:00', items: [{ productId: productOf(shop.id, 'Fruta picada').id, qty: 1 }] })).body;
  assert.match(o.code, /^GB/);
  const seen = (await shopUser('GET', '/api/shop/orders')).body.orders.find((x) => x.id === o.id);
  assert.equal(seen.code, null);
  assert.equal((await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'preparando' })).body.code, null);
  for (let i = 0; i < 5; i++) assert.equal((await shopUser('POST', '/api/shop/pickup', { code: `GBXX${i}A`, orderId: o.id })).status, 409);
  // Bloqueado por un rato, incluso con el código correcto.
  assert.equal((await shopUser('POST', '/api/shop/pickup', { code: o.code, orderId: o.id })).status, 429);
  // El código escaneado en el mostrador (sin elegir pedido) sigue funcionando.
  const done = (await shopUser('POST', '/api/shop/pickup', { code: o.code })).body;
  assert.equal(done.status, 'entregado');
  assert.equal(done.code, o.code);
});

test('promociones por horario, tarjeta de sellos y precio calculado por el servidor', async () => {
  const shopUser = await login('sangucheria@gobite.cl');
  const owner = await login('plataforma@gobite.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'La Sanguchería'").get();
  const papas = productOf(shop.id, 'Papas fritas'); // $1.900
  const empanada = productOf(shop.id, 'Empanada de pino'); // $1.800
  // Las promociones y los premios los define la plataforma, no el local.
  assert.equal((await shopUser('PATCH', '/api/shop/me', { promos: [{ from: 900, to: 960, percent: 10 }] })).status, 403);
  assert.equal((await shopUser('PATCH', '/api/shop/me', { loyalty_every: 3 })).status, 403);
  assert.equal((await shopUser('PATCH', `/api/owner/shops/${shop.id}`, { promos: [] })).status, 403);
  // Validaciones: traslapes, porcentajes fuera de rango y premios sin valor.
  const setShop = (body) => owner('PATCH', `/api/owner/shops/${shop.id}`, body);
  assert.equal((await setShop({ promos: [{ from: 900, to: 960, percent: 10 }, { from: 930, to: 1000, percent: 5 }] })).status, 400);
  assert.equal((await setShop({ promos: [{ from: 900, to: 960, percent: 80 }] })).status, 400);
  assert.equal((await setShop({ loyalty_every: 3, loyalty_max: 0 })).status, 400);
  let r = await setShop({ promos: [{ from: 900, to: 960, percent: 10 }], loyalty_every: 3, loyalty_max: 1500 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.promos, [{ from: 900, to: 960, percent: 10 }]);

  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const st = client();
  await st('POST', '/api/auth/register', { name: 'Fiel', email: 'fiel@duocuc.cl', password: 'clave-segura', campusId: campus });
  const slots = (await st('GET', `/api/shops/${shop.id}/slots`)).body;
  assert.equal(slots.find((s) => s.slot === '2026-11-13T15:00').promo, 10);
  assert.equal(slots.find((s) => s.slot === '2026-11-13T16:00').promo, undefined);

  // Con promoción: 10 % menos, calculado en el servidor aunque el navegador mande otro precio.
  const items = [{ productId: papas.id, qty: 2, price: 1 }];
  let q = (await st('POST', '/api/orders/quote', { shopId: shop.id, slot: '2026-11-13T15:00', items })).body;
  assert.deepEqual([q.subtotal, q.promo_discount, q.total], [3800, 380, 3420]);
  const o1 = (await st('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T15:00', items })).body;
  assert.deepEqual([o1.subtotal, o1.promo_discount, o1.total, o1.funded_discount], [3800, 380, 3420, 380]);
  assert.equal((await st('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T16:00', items, useReward: true })).status, 409);

  // Tres pedidos entregados = un premio.
  const deliver = async (o) => shopUser('POST', '/api/shop/pickup', { code: o.code, orderId: o.id });
  await deliver(o1);
  for (const slot of ['2026-11-13T16:10', '2026-11-13T16:20']) {
    const o = (await st('POST', '/api/orders', { shopId: shop.id, slot, items: [{ productId: empanada.id, qty: 1 }] })).body;
    await deliver(o);
  }
  q = (await st('POST', '/api/orders/quote', { shopId: shop.id, slot: '2026-11-13T16:30', items: [{ productId: papas.id, qty: 1 }, { productId: empanada.id, qty: 1 }] })).body;
  assert.deepEqual(q.loyalty, { every: 3, max: 1500, stamps: 0, rewards: 1 });
  // El premio cubre el producto más caro hasta el tope ($1.500 de las papas de $1.900).
  const withReward = { shopId: shop.id, slot: '2026-11-13T16:30', items: [{ productId: papas.id, qty: 1 }, { productId: empanada.id, qty: 1 }], useReward: true };
  const o4 = (await st('POST', '/api/orders', withReward)).body;
  assert.deepEqual([o4.subtotal, o4.reward_discount, o4.total, o4.funded_discount], [3700, 1500, 2200, 1500]);
  // El premio ya está ocupado por un pedido en curso: no se puede usar dos veces.
  assert.equal((await st('POST', '/api/orders', { ...withReward, slot: '2026-11-13T16:40' })).status, 409);
  // Si ese pedido se cancela, el premio vuelve.
  await st('POST', `/api/orders/${o4.id}/cancel`);
  assert.equal((await st('POST', '/api/orders/quote', withReward)).body.loyalty.rewards, 1);

  // Impacto para el local: sus ventas cuentan a precio completo, porque el descuento lo pone la plataforma.
  const impact = (await shopUser('GET', '/api/shop/impact')).body;
  assert.equal(impact.delivered >= 3, true);
  assert.equal('promo_given' in impact, false);
  assert.equal(impact.queue_minutes_saved, impact.delivered * impact.queue_minutes_per_order);
  assert.equal((await st('GET', '/api/shop/impact')).status, 403);
  // La plataforma ve cuánto puso en descuentos en este local.
  const mine = (await owner('GET', '/api/owner/shops')).body.shops.find((x) => x.id === shop.id);
  assert.equal(mine.discounts, 380);
  assert.deepEqual(mine.promos, [{ from: 900, to: 960, percent: 10 }]);
  await setShop({ promos: [], loyalty_every: 0 });
});

test('tiempo de preparación por producto y favoritos', async () => {
  const shopUser = await login('casino@gobite.cl');
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Casino'").get();
  const menu = productOf(shop.id, 'Menú del día');
  const fruta = productOf(shop.id, 'Fruta picada');
  // El menú necesita 45 minutos: con él en el carrito, la primera hora es más tarde.
  assert.equal((await shopUser('PATCH', `/api/shop/products/${menu.id}`, { prepMinutes: 45 })).body.prep_minutes, 45);
  const st = await login('estudiante@gobite.cl');
  const fast = (await st('GET', `/api/shops/${shop.id}/slots?products=${fruta.id}`)).body[0].slot;
  const slow = (await st('GET', `/api/shops/${shop.id}/slots?products=${fruta.id},${menu.id}`)).body[0].slot;
  assert.equal(fast, '2026-11-13T12:20'); // 12:00 + 15 min del local
  assert.equal(slow, '2026-11-13T12:50'); // 12:00 + 45 min del menú
  const r = await st('POST', '/api/orders', { shopId: shop.id, slot: fast, items: [{ productId: menu.id, qty: 1 }] });
  assert.equal(r.status, 409);
  await shopUser('PATCH', `/api/shop/products/${menu.id}`, { prepMinutes: 0 });

  assert.equal((await st('POST', `/api/favorites/${fruta.id}`)).status, 200);
  assert.equal((await st('POST', `/api/favorites/${fruta.id}`)).status, 200);
  let fav = (await st('GET', '/api/favorites')).body;
  assert.deepEqual(fav.map((f) => [f.name, f.shop_name]), [['Fruta picada', 'Casino']]);
  assert.equal((await st('POST', '/api/favorites/999999')).status, 404);
  await st('DELETE', `/api/favorites/${fruta.id}`);
  assert.equal((await st('GET', '/api/favorites')).body.length, 0);
});

test('beca Junaeb: operador por sede, pago al retirar y cobro confirmado por el local', async () => {
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Casino'").get();
  const noBaes = db.prepare("SELECT * FROM shops WHERE name = 'La Sanguchería'").get();
  const shopUser = await login('casino@gobite.cl');
  const student = await login('estudiante@gobite.cl');
  // Viña del Mar queda con Edenred; una sede en Santiago, con Pluxee.
  const campuses = (await client()('GET', '/api/campuses')).body;
  assert.equal(campuses.find((c) => c.city === 'Viña del Mar').baes_operator, 'edenred');
  assert.equal(campuses.find((c) => c.city === 'Santiago').baes_operator, 'pluxee');
  const me = (await student('GET', '/api/me')).body;
  assert.equal(me.baes, true);
  assert.equal(me.baes_operator, 'edenred');
  const info = (await student('GET', `/api/shops/${shop.id}`)).body.shop;
  assert.deepEqual([info.accepts_baes, info.baes_operator], [true, 'edenred']);

  const item = [{ productId: productOf(shop.id, 'Menú del día').id, qty: 1 }];
  // Un local que no está adherido no recibe la beca.
  const rejected = await student('POST', '/api/orders', { shopId: noBaes.id, slot: '2026-11-13T15:00', paymentMethod: 'junaeb', items: [{ productId: productOf(noBaes.id, 'Papas fritas').id, qty: 1 }] });
  assert.equal(rejected.status, 409);
  const o = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T17:00', paymentMethod: 'junaeb', items: item })).body;
  assert.equal(o.payment_method, 'junaeb');
  assert.equal(o.status, 'recibido');
  assert.equal(o.baes_operator, 'edenred');
  assert.match(pushed.find((p) => p.shop === shop.id && p.tag === `order-${o.id}`).body, /paga con Junaeb/);

  await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'preparando' });
  pushed.length = 0;
  await shopUser('POST', `/api/shop/orders/${o.id}/status`, { status: 'listo' });
  // El aviso de "listo" le dice qué app abrir y cuánto va a pagar.
  assert.match(pushed.at(-1).body, /Ticket Junaeb \(Edenred\) para pagar \$4\.000/);

  // Entregar sin confirmar el cobro no se puede: el servidor devuelve lo necesario para cobrar.
  let r = await shopUser('POST', '/api/shop/pickup', { code: o.code, orderId: o.id });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.charge, { orderId: o.id, code: o.code, total: 4000, operator: 'edenred', customer: 'Estudiante Demo' });
  assert.equal((await shopUser('POST', '/api/shop/pickup', { code: o.code, orderId: o.id, charge: 'tarjeta' })).status, 409);
  r = await shopUser('POST', '/api/shop/pickup', { code: o.code, orderId: o.id, charge: 'junaeb' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.status, r.body.payment_status, r.body.paid], ['entregado', 'aprobado', true]);

  // Si la beca no pasa, el estudiante paga con otro medio y queda registrado.
  const o2 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T17:10', paymentMethod: 'junaeb', items: item })).body;
  r = await shopUser('POST', '/api/shop/pickup', { code: o2.code, charge: 'otro' });
  assert.equal(r.body.payment_status, 'otro_medio');

  // El local ve sus ventas con la beca, y nada de esto entra a las liquidaciones de la plataforma.
  const impact = (await shopUser('GET', '/api/shop/impact')).body;
  assert.deepEqual([impact.baes_orders, impact.baes_sales], [1, 4000]);
  const res = await fetch(`${base}/api/shop/orders.csv`, { headers: { Cookie: shopUser.cookie() } });
  const csv = await res.text();
  assert.match(csv, new RegExp(`"${o.code}";"Estudiante Demo";"1x Menú del día";"4000";"Beca Junaeb";"Entregado"`));
  assert.match(csv, new RegExp(`"${o2.code}";.*"En el local \\(la beca no pasó\\)"`));
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM orders WHERE payment_method = 'junaeb' AND settlement_id IS NOT NULL").get().c, 0);

  // El local decide si recibe la beca.
  assert.equal((await shopUser('PATCH', '/api/shop/me', { accepts_baes: false })).body.accepts_baes, false);
  assert.equal((await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T17:20', paymentMethod: 'junaeb', items: item })).status, 409);
  await shopUser('PATCH', '/api/shop/me', { accepts_baes: true });
});

test('la institución corrige el operador de la beca en cada sede', async () => {
  const admin = await login('admin@gobite.cl');
  const other = await login('admin2@gobite.cl');
  const sede = (await admin('POST', '/api/admin/campuses', { name: 'Sede Puente Alto', city: 'Puente Alto' })).body;
  assert.equal(sede.baes_operator, 'pluxee');
  const conce = (await admin('POST', '/api/admin/campuses', { name: 'Sede Concepción', city: 'Concepción', baes_operator: 'edenred' })).body;
  assert.equal(conce.baes_operator, 'edenred');
  assert.equal((await admin('POST', '/api/admin/campuses', { name: 'Sede X', city: 'Talca', baes_operator: 'sodexo' })).status, 400);
  assert.equal((await admin('PATCH', `/api/admin/campuses/${sede.id}`, { baes_operator: 'edenred' })).body.baes_operator, 'edenred');
  // Otra institución no puede tocar esta sede.
  assert.equal((await other('PATCH', `/api/admin/campuses/${sede.id}`, { baes_operator: 'pluxee' })).status, 404);
  const overview = (await admin('GET', '/api/admin/overview')).body;
  assert.equal(overview.campuses.find((c) => c.id === sede.id).baes_operator, 'edenred');
  assert.equal(overview.campuses.find((c) => c.name === 'Sede Viña del Mar').baes_shops, 2);
});

test('recreos del estudiante: se validan y se guardan ordenados', async () => {
  const campus = db.prepare('SELECT id FROM campuses LIMIT 1').get().id;
  const st = client();
  await st('POST', '/api/auth/register', { name: 'Recreo', email: 'recreo@duocuc.cl', password: 'clave-segura', campusId: campus });
  assert.deepEqual((await st('GET', '/api/me')).body.breaks, []);
  assert.equal((await st('GET', '/api/me')).body.baes, false);
  for (const bad of [[{ days: '', from: 600, to: 620 }], [{ days: '1', from: 620, to: 600 }], [{ days: '1', from: 600, to: 900 }], 'no']) {
    assert.equal((await st('PATCH', '/api/me', { breaks: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await st('PATCH', '/api/me', { breaks: Array.from({ length: 13 }, () => ({ days: '1', from: 600, to: 620 })) })).status, 400);
  const r = await st('PATCH', '/api/me', { baes: true, breaks: [{ days: '531', from: 790, to: 830 }, { days: '12345', from: 620, to: 640, extra: 'x' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.baes, true);
  assert.deepEqual(r.body.breaks, [{ days: '12345', from: 620, to: 640 }, { days: '135', from: 790, to: 830 }]);
  // Un local o una institución no tienen estos datos.
  const shopMe = (await (await login('casino@gobite.cl'))('GET', '/api/me')).body;
  assert.equal('breaks' in shopMe || 'baes' in shopMe, false);
});
