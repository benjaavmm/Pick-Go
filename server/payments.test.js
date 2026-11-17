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
  const { db, app, base } = await start(createPayments({ ALTIRO_PAYMENTS: 'simulado' }));
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'Café Andén'").get();
  const agua = db.prepare("SELECT id FROM products WHERE shop_id = ? AND name = 'Agua mineral'").get(shop.id).id;
  const student = await login(base, 'estudiante@altiro.cl');
  const local = await login(base, 'cafe@altiro.cl');
  const owner = await login(base, 'plataforma@altiro.cl');
  assert.equal((await student('GET', '/api/config')).body.payments, 'simulado');

  // Café Andén no acepta pagar al retirar.
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
  const other = await login(base, 'sangucheria@altiro.cl');
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

test('Mercado Pago (API de Orders): crea el cobro, confirma consultando a Mercado Pago y reembolsa', async () => {
  // Servidor falso con la forma de la API de Orders de Mercado Pago (respuestas tomadas de su documentación).
  const calls = [];
  const orders = new Map();
  let next = 1;
  const mp = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, idem: req.headers['x-idempotency-key'], body: body ? JSON.parse(body) : null });
      const send = (code, data) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(data)));
      if (req.headers.authorization !== 'Bearer TEST-token') return send(401, { errors: [{ code: 'unauthorized', message: 'invalid token' }] });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'POST' && url.pathname === '/v1/orders') {
        const b = JSON.parse(body);
        if (b.processing_mode !== 'manual') return send(400, { errors: [{ code: 'required_properties', message: 'Missing properties' }] });
        const id = `ORDTST${String(next++).padStart(4, '0')}`;
        const o = { ...b, id, status: 'created', status_detail: 'created', total_paid_amount: '0', currency: 'CLP', checkout_url: `https://www.mercadopago.cl/checkout/v1/redirect?order_id=${id}` };
        orders.set(id, o);
        return send(201, o);
      }
      const m = url.pathname.match(/^\/v1\/orders\/(\w+)(\/(refund|cancel))?$/);
      const o = m && orders.get(m[1]);
      if (!o) return send(404, { errors: [{ code: 'not_found', message: 'order not found' }] });
      if (req.method === 'GET') return send(200, o);
      if (m[3] === 'refund') Object.assign(o, { status: 'refunded', status_detail: 'refunded' });
      if (m[3] === 'cancel') Object.assign(o, { status: 'canceled', status_detail: 'canceled' });
      send(201, o);
    });
  });
  mp.listen(0);
  await new Promise((r) => mp.once('listening', r));
  servers.push(mp);
  const secret = 'secreto-webhook';
  const provider = createPayments(
    { ALTIRO_PAYMENTS: 'mercadopago', ALTIRO_MP_ACCESS_TOKEN: 'TEST-token', ALTIRO_PUBLIC_URL: 'https://altiro.test', ALTIRO_MP_WEBHOOK_SECRET: secret },
    { apiBase: `http://127.0.0.1:${mp.address().port}` },
  );
  assert.throws(() => createPayments({ ALTIRO_PAYMENTS: 'mercadopago' }), /ALTIRO_MP_ACCESS_TOKEN/);
  const { db, app, base } = await start(provider);
  const shop = db.prepare("SELECT * FROM shops WHERE name = 'La Sanguchería'").get();
  const papas = db.prepare("SELECT id FROM products WHERE shop_id = ? AND name = 'Papas fritas'").get(shop.id).id;
  const student = await login(base, 'estudiante@altiro.cl');
  const local = await login(base, 'sangucheria@altiro.cl');
  const pay = (id, amount = '1900') => Object.assign(orders.get(id), { status: 'processed', status_detail: 'accredited', total_paid_amount: amount });

  const order = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:00', items: [{ productId: papas, qty: 1 }] })).body;
  const mpId = order.payment_ref;
  assert.match(mpId, /^ORDTST/);
  assert.equal(order.pay_url, `https://www.mercadopago.cl/checkout/v1/redirect?order_id=${mpId}`);
  const sent = calls.find((c) => c.url === '/v1/orders' && c.method === 'POST');
  assert.equal(sent.body.type, 'online');
  assert.equal(sent.body.external_reference, `${order.code}-${order.id}`);
  assert.equal(sent.body.total_amount, '1900');
  assert.equal(sent.body.items[0].unit_price, '1900');
  assert.equal(sent.body.expiration_time, 'PT15M');
  assert.equal(sent.body.config.online.success_url, `https://altiro.test/pedidos/${order.id}?pago=1`);
  assert.ok(sent.idem);

  // Volver a abrir el pago reutiliza la misma order de Mercado Pago: nunca hay dos cobros abiertos.
  assert.equal((await student('POST', `/api/orders/${order.id}/pay`)).body.pay_url, order.pay_url);
  assert.equal(orders.size, 1);

  // Avisos: sin firma válida se rechazan; con firma, se vuelve a consultar la order antes de aprobar.
  const hook = (id, headers = {}) =>
    fetch(`${base}/api/payments/webhook?type=order&data.id=${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  const signed = (id) => {
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:req-1;ts:${ts};`).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' };
  };
  assert.equal((await hook(mpId)).status, 401);
  // Pagada por un monto distinto: no se aprueba.
  pay(mpId, '1');
  await hook(mpId, signed(mpId));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await student('GET', `/api/orders/${order.id}`)).body.status, 'pago_pendiente');
  // Pagada por el monto correcto: llega al local.
  pay(mpId);
  assert.equal((await hook(mpId, signed(mpId))).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  let o = (await student('GET', `/api/orders/${order.id}`)).body;
  assert.equal(o.status, 'recibido');
  assert.equal(o.payment_status, 'aprobado');
  assert.equal((await local('GET', '/api/shop/orders')).body.orders.length, 1);
  // El navegador no puede aprobar pagos por su cuenta.
  assert.equal((await student('POST', `/api/orders/${order.id}/simulate-payment`, { approve: true })).status, 404);

  // El estudiante cancela antes de que lo acepten: reembolso en Mercado Pago, una sola vez.
  o = (await student('POST', `/api/orders/${order.id}/cancel`)).body;
  assert.equal(o.payment_status, 'reembolsado');
  const refunds = calls.filter((c) => c.url === `/v1/orders/${mpId}/refund`);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].idem, `refund-${mpId}`);
  assert.equal(orders.get(mpId).status, 'refunded');

  // Un aviso de un cobro que no es de ningún pedido de esta app (por ejemplo, de una base anterior) se ignora,
  // aunque su referencia se parezca a la de un pedido actual.
  const foreign = 'ORDTSTAJENO1';
  orders.set(foreign, { id: foreign, status: 'processed', status_detail: 'accredited', total_amount: '1900', total_paid_amount: '1900', currency: 'CLP', external_reference: `XXXX-${order.id + 1}` });
  const pending = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:40', items: [{ productId: papas, qty: 1 }] })).body;
  await hook(foreign, signed(foreign));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await student('GET', `/api/orders/${pending.id}`)).body.status, 'pago_pendiente');
  await student('POST', `/api/orders/${pending.id}/cancel`);

  // Al volver del pago, la consulta del estudiante también aprueba (sin esperar el aviso).
  const o2 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:10', items: [{ productId: papas, qty: 1 }] })).body;
  pay(o2.payment_ref);
  assert.equal((await student('POST', `/api/orders/${o2.id}/payment/check`)).body.status, 'recibido');

  // Un cobro que nadie paga se libera y se cierra en Mercado Pago.
  const o3 = (await student('POST', '/api/orders', { shopId: shop.id, slot: '2026-11-13T13:20', items: [{ productId: papas, qty: 1 }] })).body;
  const real = clock;
  clock = new Date(real.getTime() + 20 * 60000);
  await app.locals.expireUnpaid();
  clock = real;
  assert.equal((await student('GET', `/api/orders/${o3.id}`)).body.status, 'cancelado');
  assert.equal(orders.get(o3.payment_ref).status, 'canceled');
});

test('las variables PICKGO_* siguen funcionando y la base anterior se sigue usando', async () => {
  const { migrateEnv } = await import('./brand.js');
  const { dbFileFrom } = await import('./db.js');
  const warnings = [];
  const env = migrateEnv({ PICKGO_PAYMENTS: 'simulado', ALTIRO_DEMO: '0', PICKGO_DEMO: '1' }, (w) => warnings.push(w));
  assert.equal(env.ALTIRO_PAYMENTS, 'simulado');
  // Si ya está la variable nueva, manda la nueva.
  assert.equal(env.ALTIRO_DEMO, '0');
  assert.equal(warnings.length, 1);
  assert.equal(createPayments(env).mode, 'simulado');

  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'altiro-'));
  assert.equal(dbFileFrom({}, dir), path.join(dir, 'data', 'altiro.db'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'pickgo.db'), '');
  assert.equal(dbFileFrom({}, dir), path.join(dir, 'data', 'pickgo.db'));
  assert.equal(dbFileFrom({ ALTIRO_DB: path.join(dir, 'data', 'altiro.db') }, dir), path.join(dir, 'data', 'pickgo.db'));
  assert.equal(dbFileFrom({ ALTIRO_DB: '/otra/base.db' }, dir), '/otra/base.db');
});
