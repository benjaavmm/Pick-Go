import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { createPayments } from './payments.js';
import { DEMO_PASSWORD, seedIfEmpty } from './seed.js';

// Viernes 13 de noviembre de 2026, 12:00 en Chile.
let clock = new Date('2026-11-13T15:00:00Z');
const servers = [];
after(() => servers.forEach((s) => (s.close(), s.closeAllConnections())));

async function start(payments) {
  const db = openDb(':memory:');
  seedIfEmpty(db, { now: clock, history: false });
  const app = createApp(db, { now: () => clock, payments });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  servers.push(server);
  return { db, app, base: `http://127.0.0.1:${server.address().port}` };
}

function client(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  call.cookie = () => cookie;
  return call;
}
const login = async (base, email) => {
  const c = client(base);
  assert.equal((await c('POST', '/api/auth/login', { email, password: DEMO_PASSWORD })).status, 200);
  return c;
};

test('modo de prueba: el pedido llega al local solo cuando se paga, y se reembolsa si el local lo rechaza', async () => {
  const { db, app, base } = await start(createPayments({ PICKGO_PAYMENTS: 'simulado' }));
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Pronto Copec'").get();
  const agua = db.prepare("SELECT id FROM products WHERE shop_id = ? AND name = 'Agua mineral'").get(shop.id).id;
  const student = await login(base, 'estudiante@pickgo.cl');
  const local = await login(base, 'copec@pickgo.cl');
  const owner = await login(base, 'plataforma@pickgo.cl');
  assert.equal((await student('GET', '/api/config')).body.payments, 'simulado');

  // Pronto Copec no acepta pagar al retirar.
  let r = await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:00', paymentMethod: 'local', items: [{ productId: agua, qty: 1 }] });
  assert.equal(r.status, 409);

  r = await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:00', items: [{ productId: agua, qty: 2 }] });
  assert.equal(r.status, 201);
  const order = r.body;
  assert.equal(order.status, 'pago_pendiente');
  assert.equal(order.payment_method, 'app');
  assert.equal(order.pay_url, `/pago-de-prueba/${order.id}`);
  // Reserva la hora, pero el local todavía no lo ve ni puede entregarlo.
  assert.equal((await student('GET', `/api/shops/${shop.id}/slots`)).body.find((s) => s.slot === '2026-11-13T13:00').remaining, shop.slot_capacity - 1);
  assert.equal((await local('GET', '/api/shop/orders')).body.orders.length, 0);
  assert.equal((await local('POST', '/api/shop/pickup', { code: order.code })).status, 404);

  // Rechazar el pago de prueba no cambia nada; aprobarlo lo envía al local con la comisión calculada (8 %).
  await student('POST', `/api/orders/${order.id}/simulate-payment`, { approve: false });
  assert.equal((await student('GET', `/api/orders/${order.id}`)).body.status, 'pago_pendiente');
  r = await student('POST', `/api/orders/${order.id}/simulate-payment`, { approve: true });
  assert.equal(r.body.status, 'recibido');
  assert.equal(r.body.payment_status, 'aprobado');
  assert.equal(r.body.paid, true);
  assert.equal(r.body.fee, Math.round(2000 * 0.08));
  assert.equal((await local('GET', '/api/shop/orders')).body.orders.length, 1);
  // Un segundo aviso de aprobación no lo duplica.
  r = await student('POST', `/api/orders/${order.id}/simulate-payment`, { approve: true });
  assert.equal(r.body.events.filter((e) => e.status === 'recibido').length, 1);

  // El local lo rechaza: reembolso automático y sin comisión.
  r = await local('POST', `/api/shop/orders/${order.id}/status`, { status: 'cancelado', reason: 'Se agotó un producto' });
  assert.equal(r.body.status, 'cancelado');
  assert.equal(r.body.payment_status, 'reembolsado');
  assert.equal(r.body.fee, 0);

  // Otro pedido que se paga y se entrega: queda por liquidar al local.
  const o2 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:30', items: [{ productId: agua, qty: 3 }] })).body;
  await student('POST', `/api/orders/${o2.id}/simulate-payment`, { approve: true });
  await local('POST', `/api/shop/orders/${o2.id}/status`, { status: 'preparando' });
  let pay = (await local('GET', '/api/shop/payouts')).body;
  assert.deepEqual(pay.in_progress, { orders: 1, gross: 3000 });
  assert.equal(pay.pending.orders, 0);
  await local('POST', '/api/shop/pickup', { code: o2.code });
  pay = (await local('GET', '/api/shop/payouts')).body;
  assert.deepEqual(pay.pending, { orders: 1, gross: 3000, fee: 240, amount: 2760 });

  // La plataforma registra la transferencia.
  const overview = (await owner('GET', '/api/owner/payments')).body;
  assert.equal(overview.shops.find((s) => s.id === shop.id).pending.amount, 2760);
  assert.equal((await local('GET', '/api/owner/payments')).status, 403);
  r = await owner('POST', '/api/owner/settlements', { shopId: shop.id, reference: 'Transferencia 1234' });
  assert.equal(r.status, 201);
  assert.equal(r.body.amount, 2760);
  assert.equal((await owner('POST', '/api/owner/settlements', { shopId: shop.id })).status, 409);
  pay = (await local('GET', '/api/shop/payouts')).body;
  assert.equal(pay.pending.orders, 0);
  assert.equal(pay.settlements[0].reference, 'Transferencia 1234');
  const csv = await (await fetch(`${base}/api/shop/settlements/${r.body.id}.csv`, { headers: { Cookie: local.cookie() } })).text();
  assert.match(csv, new RegExp(`"${o2.code}";"Entregado";"3000";"240";"2760"`));
  assert.match(csv, /"Total";"";"";"3000";"240";"2760"/);
  // Otro local no puede ver esta liquidación.
  const other = await login(base, 'pepepug@pickgo.cl');
  assert.equal((await fetch(`${base}/api/shop/settlements/${r.body.id}.csv`, { headers: { Cookie: other.cookie() } })).status, 404);

  // Comisión configurable: se aplica a lo que se pague desde ahora.
  assert.equal((await owner('PATCH', '/api/owner/settings', { commission_bps: 9999 })).status, 400);
  assert.equal((await owner('PATCH', '/api/owner/settings', { commission_bps: 1000 })).body.commission_bps, 1000);
  const o3 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T14:00', items: [{ productId: agua, qty: 1 }] })).body;
  assert.equal((await student('POST', `/api/orders/${o3.id}/simulate-payment`, { approve: true })).body.fee, 100);

  // Un pedido que nadie paga se libera solo pasado el plazo.
  const o4 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T14:00', items: [{ productId: agua, qty: 1 }] })).body;
  const real = clock;
  clock = new Date(real.getTime() + 20 * 60000);
  await app.locals.expireUnpaid();
  const expired = (await student('GET', `/api/orders/${o4.id}`)).body;
  assert.equal(expired.status, 'cancelado');
  assert.equal(expired.payment_status, 'expirado');
  assert.equal(expired.cancel_reason, 'No se completó el pago');
  // Si igual llega a pagarse tarde, se devuelve el dinero.
  r = await student('POST', `/api/orders/${o4.id}/simulate-payment`, { approve: true });
  assert.equal(r.body.status, 'cancelado');
  clock = real;
});

test('Mercado Pago: crea el pago, confirma consultando a Mercado Pago y reembolsa', async () => {
  // Servidor falso con la forma de la API de Mercado Pago.
  const calls = [];
  const payments = new Map();
  let nextId = 9000;
  const mp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers['x-idempotency-key'], body: body ? JSON.parse(body) : null });
      const send = (code, data) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(data)));
      if (req.headers.authorization !== 'Bearer TEST-token') return send(401, { message: 'invalid token' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/checkout/preferences') return send(201, { id: 'pref-1', init_point: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-1' });
      if (req.method === 'GET' && url.pathname === '/v1/payments/search')
        return send(200, { results: [...payments.values()].filter((p) => p.external_reference === url.searchParams.get('external_reference')) });
      const m = url.pathname.match(/^\/v1\/payments\/(\d+)(\/refunds)?$/);
      if (m && req.method === 'GET') return payments.has(m[1]) ? send(200, payments.get(m[1])) : send(404, { message: 'not found' });
      if (m && m[2] && req.method === 'POST') return send(201, { id: 77, payment_id: Number(m[1]) });
      send(404, { message: 'ruta' });
    });
  });
  mp.listen(0);
  await new Promise((r) => mp.once('listening', r));
  servers.push(mp);
  const secret = 'secreto-webhook';
  const provider = createPayments(
    { PICKGO_PAYMENTS: 'mercadopago', PICKGO_MP_ACCESS_TOKEN: 'TEST-token', PICKGO_PUBLIC_URL: 'https://pickgo.test', PICKGO_MP_WEBHOOK_SECRET: secret },
    { apiBase: `http://127.0.0.1:${mp.address().port}` },
  );
  assert.throws(() => createPayments({ PICKGO_PAYMENTS: 'mercadopago' }), /PICKGO_MP_ACCESS_TOKEN/);
  const { db, base } = await start(provider);
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Pepepug'").get();
  const papas = db.prepare("SELECT id FROM products WHERE shop_id = ? AND name = 'Papas fritas'").get(shop.id).id;
  const student = await login(base, 'estudiante@pickgo.cl');
  const local = await login(base, 'pepepug@pickgo.cl');

  const order = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:00', items: [{ productId: papas, qty: 1 }] })).body;
  assert.equal(order.pay_url, 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-1');
  const pref = calls.find((c) => c.url === '/checkout/preferences').body;
  assert.equal(pref.external_reference, String(order.id));
  assert.equal(pref.items[0].unit_price, 2000);
  assert.equal(pref.items[0].currency_id, 'CLP');
  assert.equal(pref.notification_url, 'https://pickgo.test/api/payments/webhook');
  assert.equal(pref.back_urls.success, `https://pickgo.test/pedidos/${order.id}?pago=1`);

  // Un aviso sin firma válida se rechaza.
  const hook = (id, headers = {}) =>
    fetch(`${base}/api/payments/webhook?type=payment&data.id=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await hook('9001')).status, 401);
  const signed = (id) => {
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`id:${id};request-id:req-1;ts:${ts};`).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' };
  };

  // Un pago aprobado por un monto distinto no aprueba el pedido.
  const pay = (status, amount) => {
    const id = String(++nextId);
    payments.set(id, { id: Number(id), status, transaction_amount: amount, currency_id: 'CLP', external_reference: String(order.id) });
    return id;
  };
  let id = pay('approved', 1);
  assert.equal((await hook(id, signed(id))).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await student('GET', `/api/orders/${order.id}`)).body.status, 'pago_pendiente');

  // Rechazado: sigue pendiente. Aprobado por el monto correcto: llega al local.
  payments.clear();
  id = pay('rejected', 2000);
  assert.equal((await student('POST', `/api/orders/${order.id}/payment/check`)).body.status, 'pago_pendiente');
  id = pay('approved', 2000);
  await hook(id, signed(id));
  await new Promise((r) => setTimeout(r, 100));
  let o = (await student('GET', `/api/orders/${order.id}`)).body;
  assert.equal(o.status, 'recibido');
  assert.equal(o.payment_ref, id);
  // El navegador no puede aprobar pagos por su cuenta.
  assert.equal((await student('POST', `/api/orders/${order.id}/simulate-payment`, { approve: true })).status, 404);

  // El estudiante cancela antes de que lo acepten: reembolso en Mercado Pago, una sola vez.
  o = (await student('POST', `/api/orders/${order.id}/cancel`)).body;
  assert.equal(o.payment_status, 'reembolsado');
  const refunds = calls.filter((c) => c.url === `/v1/payments/${id}/refunds`);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].idem, `refund-${id}`);
  assert.equal((await local('GET', '/api/shop/orders')).body.orders[0].status, 'cancelado');
});
