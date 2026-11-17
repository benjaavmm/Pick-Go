import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COOKIE,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  passwordProblem,
  readCookie,
  sessionCookie,
  userFromToken,
  verifyPassword,
} from './auth.js';
import { OPERATORS, operatorForCity } from './baes.js';
import { BRAND, CODE_PREFIX, SLUG } from './brand.js';
import { CHECKOUT_MINUTES } from './payments.js';
import { addDays, buildSlots, chileNow, chileStamp, isOpenNow, toMinutes } from './time.js';

class HttpError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
/** Corta la solicitud con un error. `data` viaja junto al mensaje cuando la app necesita más contexto. */
const fail = (status, message, data) => {
  throw new HttpError(status, message, data);
};
const clp = new Intl.NumberFormat('es-CL');
const money = (n) => `$${clp.format(n)}`;
/** Nombre del operador de la beca Junaeb y de la app que usa el estudiante para pagar. */
const BAES_APP = { edenred: 'Ticket Junaeb (Edenred)', pluxee: 'Pluxee Chile' };
const MAX_BREAKS = 12;

const RANK = { recibido: 0, preparando: 1, listo: 2, entregado: 3 };
const ACTIVE = "('recibido','preparando','listo')";
// Pedidos que aún esperan el pago en la app: reservan la hora de retiro, pero el local todavía no los ve.
const UNPAID = "('pendiente','expirado')";
const MAX_ACTIVE_ORDERS = 5;
const NO_SHOW_LIMIT = 3; // con este número de pedidos no retirados en 30 días se suspenden los pedidos nuevos
const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_STREAMS = 6;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// Solo se aceptan suscripciones de los servicios de push de los navegadores:
// así el servidor nunca hace solicitudes a una dirección elegida por un usuario.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const str = (v, max, label, { required = true } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) fail(400, `Falta ${label}.`);
  if (s.length > max) fail(400, `${label} es demasiado largo.`);
  return s;
};
const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} no es válido.`);
  return n;
};

/** Canales de eventos en vivo (Server-Sent Events) por estudiante y por local. */
function createHub() {
  const channels = new Map();
  const beat = setInterval(() => {
    for (const set of channels.values()) for (const res of set) res.write(': ping\n\n');
  }, 25000);
  beat.unref();
  return {
    add(key, res) {
      if (!channels.has(key)) channels.set(key, new Set());
      const set = channels.get(key);
      // Tope de conexiones por cuenta: la más antigua se cierra.
      if (set.size >= MAX_STREAMS) {
        const oldest = set.values().next().value;
        set.delete(oldest);
        oldest.end();
      }
      set.add(res);
    },
    remove(key, res) {
      const set = channels.get(key);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) channels.delete(key);
    },
    send(key, event, data) {
      for (const res of channels.get(key) ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

/** Limitador de solicitudes en memoria, por clave. */
function createLimiter() {
  const buckets = new Map();
  const sweep = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of buckets) if (v.until < t) buckets.delete(k);
  }, 60000);
  sweep.unref();
  return {
    /** Registra un intento y devuelve true si se pasó del máximo dentro de la ventana. */
    hit(key, max, windowMs) {
      const t = Date.now();
      let b = buckets.get(key);
      if (!b || b.until < t) buckets.set(key, (b = { count: 0, until: t + windowMs }));
      b.count++;
      return b.count > max;
    },
    blocked(key, max) {
      const b = buckets.get(key);
      return !!b && b.until >= Date.now() && b.count >= max;
    },
    clear(key) {
      buckets.delete(key);
    },
  };
}

export function createApp(
  db,
  // Los topes por IP son amplios a propósito: en una sede todos los celulares salen por la misma red.
  { demo = true, now = () => new Date(), distDir = null, push = null, mail = null, payments = null, ipLimit = 6000, authIpLimit = 300 } = {},
) {
  const app = express();
  const hub = createHub();
  const limiter = createLimiter();
  app.disable('x-powered-by');
  const behindProxy = !!process.env.TRUST_PROXY;
  if (behindProxy) app.set('trust proxy', 1);

  const isSecure = (req) => req.secure || (behindProxy && req.headers['x-forwarded-proto'] === 'https');

  // ---------- seguridad transversal ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    if (isSecure(req)) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (limiter.hit(`all|${req.ip}`, ipLimit, 60000))
      return next(new HttpError(429, 'Demasiadas solicitudes. Espera un momento.'));
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    // Protección CSRF: las acciones solo se aceptan desde la propia app (además de la cookie SameSite).
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none')
      return next(new HttpError(403, 'Solicitud rechazada por seguridad.'));
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* origen malformado */
      }
      const expected = (behindProxy && req.headers['x-forwarded-host']) || req.headers.host;
      if (host !== expected) return next(new HttpError(403, 'Solicitud rechazada por seguridad.'));
    }
    next();
  });

  app.use(express.json({ limit: '50kb' }));

  // ---------- helpers ----------
  const authLimit = (req, _res, next) =>
    limiter.hit(`auth|${req.ip}`, authIpLimit, 10 * 60 * 1000)
      ? next(new HttpError(429, 'Demasiados intentos. Espera unos minutos.'))
      : next();

  const auth = (req, _res, next) => {
    req.token = readCookie(req, COOKIE);
    req.user = userFromToken(db, req.token);
    if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar.'));
    next();
  };
  const role = (r) => (req, _res, next) => {
    if (req.user.role !== r) return next(new HttpError(403, 'Tu cuenta no tiene acceso a esta sección.'));
    next();
  };
  const student = [auth, role('student')];
  const shopOnly = [auth, role('shop')];
  const adminOnly = [auth, role('admin')];
  const ownerOnly = [auth, role('owner')];

  const startSession = (req, res, userId) => {
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, userId), isSecure(req)));
  };

  // Como se paga al retirar, un pedido que nadie busca es una pérdida para el local.
  const noShows = (userId) => {
    const from = addDays(chileNow(now()).date, -30);
    return db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'no_retirado' AND slot >= ?")
      .get(userId, from).c;
  };

  /**
   * Por qué un estudiante no puede pagar al retirar, o null si puede. Solo aplica si hay cobro en la app (si no,
   * todo se paga al retirar). Así, quien no retira un pedido sin pagar pierde ese medio por un tiempo, y nadie tiene
   * más de un pedido sin pagar a la vez: lo más que arriesga un local es un pedido.
   */
  const payLaterProblem = (userId) => {
    if (!payments) return null;
    if (noShows(userId) > 0)
      return 'Tienes un pedido sin retirar en los últimos 30 días, así que por ahora solo puedes pagar en la app.';
    const open = db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND payment_method != 'app' AND status IN ${ACTIVE}`)
      .get(userId).c;
    if (open > 0) return 'Ya tienes un pedido por pagar al retirar. Retíralo antes de hacer otro así, o paga este en la app.';
    return null;
  };
  /** Historial del cliente en toda la plataforma, para que el local sepa a quién le prepara sin pago previo. */
  const historyOf = (userId) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(status = 'entregado'), 0) AS delivered, COALESCE(SUM(status = 'no_retirado'), 0) AS no_shows
         FROM orders WHERE user_id = ?`,
      )
      .get(userId);

  const parseJson = (text) => {
    try {
      const v = JSON.parse(text);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const productRow = (p) => ({
    id: p.id,
    shop_id: p.shop_id,
    category: p.category,
    name: p.name,
    description: p.description,
    price: p.price,
    emoji: p.emoji,
    image: p.image_id ? `/api/images/${p.image_id}` : null,
    options: parseJson(p.options),
    prep_minutes: p.prep_minutes ?? 0,
    available: !!p.available,
  });

  const userOut = (id) => {
    const u = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.campus_id, u.shop_id, u.institution_id, u.baes, u.breaks,
                c.name AS campus_name, c.baes_operator, COALESCE(i.name, ai.name) AS institution,
                s.name AS shop_name, s.status AS shop_status
         FROM users u
         LEFT JOIN campuses c ON c.id = u.campus_id
         LEFT JOIN institutions i ON i.id = c.institution_id
         LEFT JOIN institutions ai ON ai.id = u.institution_id
         LEFT JOIN shops s ON s.id = u.shop_id
         WHERE u.id = ?`,
      )
      .get(id);
    if (u.role === 'student') {
      u.no_shows = noShows(id);
      u.can_order = u.no_shows < NO_SHOW_LIMIT;
      u.baes = !!u.baes;
      u.breaks = parseJson(u.breaks);
      u.pay_later_problem = payLaterProblem(id);
    } else {
      delete u.baes;
      delete u.breaks;
    }
    return u;
  };

  const slotCounts = (shopId) => {
    const today = chileNow(now()).date;
    const rows = db
      .prepare(
        `SELECT slot, COUNT(*) AS c FROM orders
         WHERE shop_id = ? AND status != 'cancelado' AND slot >= ? GROUP BY slot`,
      )
      .all(shopId, today);
    return new Map(rows.map((r) => [r.slot, r.c]));
  };

  const shopOut = (s) => {
    const next = s.status === 'activo' ? buildSlots(s, now(), slotCounts(s.id)).find((x) => x.remaining > 0) : null;
    const r = db.prepare('SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM orders WHERE shop_id = ?').get(s.id);
    return {
      ...s,
      paused: !!s.paused,
      auto_accept: !!s.auto_accept,
      // Sin cobro en la app, todos los pedidos se pagan en el local.
      pay_at_shop: payments ? !!s.pay_at_shop : true,
      accepts_baes: !!s.accepts_baes,
      baes_operator: campusOperator(s.campus_id),
      promos: parseJson(s.promos),
      is_open: isOpenNow(s, now()),
      next_slot: next ? { slot: next.slot, day: next.day, time: next.time } : null,
      rating: r.n ? Math.round(r.avg * 10) / 10 : null,
      ratings: r.n,
    };
  };

  const campusOperator = (campusId) =>
    db.prepare('SELECT baes_operator FROM campuses WHERE id = ?').get(campusId)?.baes_operator ?? 'edenred';
  const getShop = (id) => db.prepare('SELECT * FROM shops WHERE id = ?').get(id) ?? fail(404, 'No encontramos ese local.');
  /** Local visible para quien consulta: activo, o el propio aunque esté pendiente. */
  const visibleShop = (req, id) => {
    const shop = getShop(id);
    if (shop.status !== 'activo' && req.user.shop_id !== shop.id) fail(404, 'No encontramos ese local.');
    return shop;
  };

  const ORDER_SELECT = `
    SELECT o.*, s.name AS shop_name, s.emoji AS shop_emoji, s.location AS shop_location, u.name AS customer_name,
           sc.baes_operator
    FROM orders o JOIN shops s ON s.id = o.shop_id JOIN users u ON u.id = o.user_id JOIN campuses sc ON sc.id = s.campus_id`;

  const orderOut = (o) => ({
    ...o,
    settlement_id: undefined,
    customer_history: o.payment_method === 'app' ? null : historyOf(o.user_id),
    paid: !!o.paid,
    on_time: o.on_time === null ? null : !!o.on_time,
    items: db
      .prepare('SELECT id, product_id, name, emoji, price, qty, options FROM order_items WHERE order_id = ? ORDER BY id')
      .all(o.id)
      .map((i) => ({ ...i, options: parseJson(i.options) })),
    events: db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id),
  });

  /**
   * Lo que ve el local de un pedido. Mientras está abierto, sin el código de retiro: el código lo dice el estudiante
   * al llegar, y así nadie puede entregar un pedido sin que esté presente quien lo pidió.
   */
  const forShop = (o) => (o && (o.status in RANK && o.status !== 'entregado') ? { ...o, code: null } : o);

  const getOrder = (id) => {
    const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
    return o ? orderOut(o) : null;
  };

  const STUDENT_PUSH = {
    preparando: (o) => `${o.shop_name} aceptó tu pedido y lo está preparando.`,
    listo: (o) =>
      o.payment_method === 'junaeb'
        ? `Tu pedido ${o.code} está listo en ${o.shop_name}. Abre ${BAES_APP[o.baes_operator] ?? 'la app de tu beca'} para pagar ${money(o.total)} en el mesón.`
        : `Tu pedido ${o.code} está listo. Pasa a retirarlo en ${o.shop_name}.`,
    cancelado: (o) => `${o.shop_name} canceló tu pedido ${o.code}${o.cancel_reason ? `: ${o.cancel_reason}` : '.'}`,
  };

  const setStatus = (order, status, { paid = order.paid, by = 'shop' } = {}) => {
    let onTime = order.on_time === null ? null : order.on_time ? 1 : 0;
    // Puntualidad: ¿estaba listo a la hora que eligió el estudiante?
    if (onTime === null && (status === 'listo' || status === 'entregado'))
      onTime = chileStamp(now()) <= order.slot ? 1 : 0;
    db.prepare('UPDATE orders SET status = ?, paid = ?, on_time = ? WHERE id = ?').run(
      status,
      paid ? 1 : 0,
      onTime,
      order.id,
    );
    db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?,?,?)').run(
      order.id,
      status,
      now().toISOString(),
    );
    const fresh = getOrder(order.id);
    hub.send(`user:${fresh.user_id}`, 'order', { type: 'update', order: fresh });
    // El local no se entera de los pedidos que nunca llegaron a pagarse.
    if (fresh.payment_status !== 'pendiente' && fresh.payment_status !== 'expirado')
      hub.send(`shop:${fresh.shop_id}`, 'order', { type: 'update', order: forShop(fresh) });
    if (push) {
      if (by === 'shop' && STUDENT_PUSH[status])
        push.toUser(fresh.user_id, {
          title: status === 'listo' ? '¡Tu pedido está listo!' : BRAND,
          body: STUDENT_PUSH[status](fresh),
          url: `/pedidos/${fresh.id}`,
          tag: `order-${fresh.id}`,
        });
      if (by === 'student' && status === 'cancelado')
        push.toShop(fresh.shop_id, {
          title: 'Pedido cancelado',
          body: `${fresh.customer_name} canceló el pedido ${fresh.code}.`,
          url: '/panel',
          tag: `order-${fresh.id}`,
        });
    }
    return fresh;
  };

  const newCode = () => {
    for (let i = 0; i < 20; i++) {
      let code = CODE_PREFIX;
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
    }
    return `${CODE_PREFIX}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  };

  const emailOf = (v) => {
    const email = str(v, 120, 'El correo').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Revisa el correo: no parece válido.');
    return email;
  };
  const passwordOf = (v, email) => {
    const problem = passwordProblem(v, email);
    if (problem) fail(400, problem);
    return v;
  };
  const campusOf = (v) => {
    const id = int(v, 1, 1e9, 'La sede');
    if (!db.prepare('SELECT 1 FROM campuses WHERE id = ?').get(id)) fail(400, 'Elige una sede de la lista.');
    return id;
  };
  const emailFree = (email) => {
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
      fail(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');
  };
  const checkPassword = (req, password) => {
    const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user.id);
    if (limiter.hit(`pw|${req.user.id}`, 8, 15 * 60 * 1000)) fail(429, 'Demasiados intentos. Espera unos minutos.');
    if (typeof password !== 'string' || !verifyPassword(password, row.pass_hash))
      fail(403, 'La contraseña actual no es correcta.');
    limiter.clear(`pw|${req.user.id}`);
  };

  // ---------- métricas ----------
  const stats = (shopIds, days) => {
    const today = chileNow(now()).date;
    const from = addDays(today, -(days - 1));
    const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
    const empty = {
      from,
      to: today,
      totals: { orders: 0, delivered: 0, sales: 0, cancelled: 0, no_show: 0, on_time_pct: null, rating: null, ratings: 0, customers: 0, avg_ticket: 0 },
      by_day: dayList.map((date) => ({ date, orders: 0, sales: 0 })),
      by_hour: [],
      top: [],
    };
    if (shopIds.length === 0) return empty;
    const marks = shopIds.map(() => '?').join(',');
    const where = `o.shop_id IN (${marks}) AND substr(o.slot, 1, 10) BETWEEN ? AND ? AND o.payment_status NOT IN ${UNPAID}`;
    const args = [...shopIds, from, today];
    const t = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(o.status = 'entregado'), 0) AS delivered,
                COALESCE(SUM(CASE WHEN o.status = 'entregado' THEN o.total + o.funded_discount ELSE 0 END), 0) AS sales,
                COALESCE(SUM(o.status = 'cancelado'), 0) AS cancelled,
                COALESCE(SUM(o.status = 'no_retirado'), 0) AS no_show,
                COALESCE(SUM(o.on_time = 1), 0) AS on_time,
                COALESCE(SUM(o.on_time IS NOT NULL), 0) AS timed,
                AVG(o.rating) AS rating, COUNT(o.rating) AS ratings,
                COUNT(DISTINCT o.user_id) AS customers
         FROM orders o WHERE ${where}`,
      )
      .get(...args);
    const byDay = new Map(
      db
        .prepare(
          `SELECT substr(o.slot, 1, 10) AS date, COALESCE(SUM(o.status != 'cancelado'), 0) AS orders,
                  COALESCE(SUM(CASE WHEN o.status = 'entregado' THEN o.total + o.funded_discount ELSE 0 END), 0) AS sales
           FROM orders o WHERE ${where} GROUP BY date`,
        )
        .all(...args)
        .map((r) => [r.date, r]),
    );
    return {
      from,
      to: today,
      totals: {
        orders: t.orders,
        delivered: t.delivered,
        sales: t.sales,
        cancelled: t.cancelled,
        no_show: t.no_show,
        on_time_pct: t.timed ? Math.round((t.on_time / t.timed) * 100) : null,
        rating: t.ratings ? Math.round(t.rating * 10) / 10 : null,
        ratings: t.ratings,
        customers: t.customers,
        avg_ticket: t.delivered ? Math.round(t.sales / t.delivered) : 0,
      },
      by_day: dayList.map((date) => byDay.get(date) ?? { date, orders: 0, sales: 0 }),
      by_hour: db
        .prepare(
          `SELECT CAST(substr(o.slot, 12, 2) AS INTEGER) AS hour, COUNT(*) AS orders
           FROM orders o WHERE ${where} AND o.status != 'cancelado' GROUP BY hour ORDER BY hour`,
        )
        .all(...args),
      top: db
        .prepare(
          `SELECT i.name, i.emoji, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS sales
           FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE ${where} AND o.status NOT IN ('cancelado','no_retirado')
           GROUP BY i.product_id ORDER BY qty DESC, sales DESC LIMIT 5`,
        )
        .all(...args),
    };
  };
  const daysOf = (req) => (Number(req.query.days) === 30 ? 30 : 7);

  // Chequeo de salud para el servicio de hosting.
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  // ---------- público ----------
  app.get('/api/config', (_req, res) => {
    res.json({ demo, push_key: push?.publicKey ?? null, mail: !!mail, payments: payments?.mode ?? null });
  });

  app.get('/api/images/:id', (req, res) => {
    const img = db.prepare('SELECT mime, data FROM images WHERE id = ?').get(Number(req.params.id));
    if (!img) fail(404, 'No encontramos esa imagen.');
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(Buffer.from(img.data));
  });

  app.get('/api/campuses', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT c.id, c.name, c.city, c.baes_operator, i.name AS institution,
                  (SELECT COUNT(*) FROM shops s WHERE s.campus_id = c.id AND s.status = 'activo') AS shops_count
           FROM campuses c JOIN institutions i ON i.id = c.institution_id
           ORDER BY i.name, c.name`,
        )
        .all(),
    );
  });

  // ---------- cuentas ----------
  app.post('/api/auth/register', authLimit, (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 60, 'Tu nombre');
    const email = emailOf(b.email);
    const password = passwordOf(b.password, email);
    const campusId = campusOf(b.campusId);
    emailFree(email);
    const id = db
      .prepare('INSERT INTO users (name, email, pass_hash, role, campus_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(name, email, hashPassword(password), 'student', campusId, now().toISOString()).lastInsertRowid;
    startSession(req, res, id);
    res.status(201).json(userOut(id));
  });

  app.post('/api/auth/register-shop', authLimit, (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 60, 'Tu nombre');
    const email = emailOf(b.email);
    const password = passwordOf(b.password, email);
    const campusId = campusOf(b.campusId);
    const shopName = str(b.shopName, 60, 'El nombre del local');
    const description = str(b.description, 120, 'La descripción', { required: false });
    const location = str(b.location, 80, 'La ubicación', { required: false });
    emailFree(email);
    db.exec('BEGIN');
    let id;
    try {
      const at = now().toISOString();
      // Queda pendiente hasta que la institución lo apruebe.
      const shopId = db
        .prepare('INSERT INTO shops (campus_id, name, description, location, status, created_at) VALUES (?,?,?,?,?,?)')
        .run(campusId, shopName, description, location, 'pendiente', at).lastInsertRowid;
      id = db
        .prepare(
          'INSERT INTO users (name, email, pass_hash, role, campus_id, shop_id, created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(name, email, hashPassword(password), 'shop', campusId, shopId, at).lastInsertRowid;
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    for (const admin of db
      .prepare(
        `SELECT u.email FROM users u JOIN campuses c ON c.institution_id = u.institution_id
         WHERE c.id = ? AND u.role = 'admin' AND u.deleted_at IS NULL`,
      )
      .all(campusId))
      sendMail({
        to: admin.email,
        subject: `Nuevo local por aprobar: ${shopName}`,
        text: `${shopName} se registró en ${BRAND} y espera tu aprobación para aparecer a los estudiantes.\n\nRevísalo aquí: ${mail?.link('/institucion/locales')}\n\n${BRAND}`,
      });
    startSession(req, res, id);
    res.status(201).json(userOut(id));
  });

  app.post('/api/auth/login', authLimit, (req, res) => {
    const b = req.body ?? {};
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase().slice(0, 120) : '';
    // Bloqueo por cuenta: frena los intentos de adivinar una contraseña aunque vengan de muchas redes.
    const key = `login|${email}`;
    if (limiter.blocked(key, 8)) fail(429, 'Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.');
    const u = db.prepare('SELECT id, pass_hash FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
    if (!u || typeof b.password !== 'string' || !verifyPassword(b.password, u.pass_hash)) {
      limiter.hit(key, 8, 15 * 60 * 1000);
      fail(401, 'Correo o contraseña incorrectos.');
    }
    limiter.clear(key);
    startSession(req, res, u.id);
    res.json(userOut(u.id));
  });

  // Recuperar la contraseña por correo. Solo existe si el servidor tiene configurado el envío de correos.
  const sendMail = (message) => {
    mail?.send(message).catch((e) => console.warn('No se pudo enviar un correo:', e.message));
  };
  const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

  app.post('/api/auth/forgot', authLimit, (req, res) => {
    if (!mail) fail(503, 'La recuperación por correo no está disponible. Pide ayuda a tu institución.');
    const email = emailOf(req.body?.email);
    // La respuesta es la misma exista o no la cuenta: así nadie puede averiguar quién está registrado.
    const ok = { ok: true };
    if (limiter.hit(`forgot|${email}`, 3, 3600_000)) return res.json(ok);
    const u = db.prepare('SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL').get(email);
    if (!u) return res.json(ok);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(u.id, now().toISOString());
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(
      sha256(token),
      u.id,
      new Date(now().getTime() + 30 * 60000).toISOString(),
    );
    sendMail({
      to: email,
      subject: `Recupera tu contraseña de ${BRAND}`,
      text: `Hola, ${u.name}:\n\nPara elegir una contraseña nueva abre este enlace. Vale por 30 minutos y se puede usar una sola vez.\n\n${mail.link(`/restablecer?token=${token}`)}\n\nSi no pediste esto, ignora este correo: tu contraseña sigue igual.\n\n${BRAND}`,
    });
    res.json(ok);
  });

  app.post('/api/auth/reset', authLimit, (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const row = db
      .prepare(
        `SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.expires_at > ? AND u.deleted_at IS NULL`,
      )
      .get(sha256(token), now().toISOString());
    if (!row) fail(400, 'El enlace ya no sirve. Pide uno nuevo desde «Olvidé mi contraseña».');
    const password = passwordOf(req.body?.password, row.email);
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
    // Quien conocía la contraseña anterior pierde el acceso en todos los dispositivos.
    destroyUserSessions(db, row.user_id);
    limiter.clear(`login|${row.email}`);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, readCookie(req, COOKIE));
    res.setHeader('Set-Cookie', sessionCookie(null, isSecure(req)));
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => {
    res.json(userOut(req.user.id));
  });

  app.patch('/api/me', auth, (req, res) => {
    const b = req.body ?? {};
    if (b.name !== undefined)
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(b.name, 60, 'Tu nombre'), req.user.id);
    if (b.campusId !== undefined && req.user.role === 'student')
      db.prepare('UPDATE users SET campus_id = ? WHERE id = ?').run(campusOf(b.campusId), req.user.id);
    if (b.baes !== undefined && req.user.role === 'student')
      db.prepare('UPDATE users SET baes = ? WHERE id = ?').run(b.baes ? 1 : 0, req.user.id);
    if (b.breaks !== undefined && req.user.role === 'student')
      db.prepare('UPDATE users SET breaks = ? WHERE id = ?').run(JSON.stringify(breaksOf(b.breaks)), req.user.id);
    res.json(userOut(req.user.id));
  });

  /**
   * Recreos del estudiante: días de la semana y rango horario. Con ellos la app le propone retirar justo en su
   * próximo recreo. Hasta 12, de 5 minutos a 4 horas cada uno.
   */
  const breaksOf = (v) => {
    if (!Array.isArray(v)) fail(400, 'Los recreos no son válidos.');
    if (v.length > MAX_BREAKS) fail(400, `Puedes guardar hasta ${MAX_BREAKS} recreos.`);
    return v
      .map((x) => {
        const days = [...new Set(String(x?.days ?? ''))].filter((d) => /^[0-6]$/.test(d)).sort().join('');
        if (!days) fail(400, 'Elige al menos un día para cada recreo.');
        const from = int(x?.from, 0, 1435, 'El inicio del recreo');
        const to = int(x?.to, 5, 1440, 'El término del recreo');
        if (to - from < 5) fail(400, 'Cada recreo debe terminar después de empezar.');
        if (to - from > 240) fail(400, 'Un recreo puede durar hasta 4 horas.');
        return { days, from, to };
      })
      .sort((a, b) => a.from - b.from);
  };

  app.post('/api/me/password', auth, (req, res) => {
    const b = req.body ?? {};
    checkPassword(req, b.current);
    const next = passwordOf(b.next, req.user.email);
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    // Cierra las demás sesiones: si alguien más tenía acceso, lo pierde.
    destroyUserSessions(db, req.user.id, req.token);
    res.json({ ok: true });
  });

  app.post('/api/me/logout-all', auth, (req, res) => {
    destroyUserSessions(db, req.user.id, req.token);
    res.json({ ok: true });
  });

  app.get('/api/me/export', auth, (req, res) => {
    const orders = db.prepare(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id`).all(req.user.id).map(orderOut);
    res.setHeader('Content-Disposition', `attachment; filename="mis-datos-${SLUG}.json"`);
    res.json({ generado: now().toISOString(), cuenta: userOut(req.user.id), pedidos: orders });
  });

  app.post('/api/me/delete', student, (req, res) => {
    checkPassword(req, req.body?.password);
    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status IN ${ACTIVE}`)
      .get(req.user.id).c;
    if (active > 0) fail(409, 'Tienes pedidos en curso. Retíralos o cancélalos antes de eliminar tu cuenta.');
    // Los pedidos se conservan para la contabilidad de los locales, pero sin datos personales.
    db.prepare(
      `UPDATE users SET name = 'Cuenta eliminada', email = ?, pass_hash = ?, deleted_at = ? WHERE id = ?`,
    ).run(`eliminada-${req.user.id}@invalid`, hashPassword(crypto.randomBytes(24).toString('hex')), now().toISOString(), req.user.id);
    db.prepare(`UPDATE orders SET note = '', rating_comment = '' WHERE user_id = ?`).run(req.user.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
    destroyUserSessions(db, req.user.id);
    res.setHeader('Set-Cookie', sessionCookie(null, isSecure(req)));
    res.json({ ok: true });
  });

  // ---------- notificaciones push ----------
  app.post('/api/push/subscribe', auth, (req, res) => {
    if (!push) fail(503, 'Las notificaciones push no están disponibles en este servidor.');
    const b = req.body ?? {};
    const endpoint = str(b.endpoint, 1000, 'La suscripción');
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      fail(400, 'La suscripción no es válida.');
    }
    if (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname)))
      fail(400, 'Este navegador usa un servicio de notificaciones que no reconocemos.');
    const p256dh = str(b.keys?.p256dh, 200, 'La suscripción');
    const authKey = str(b.keys?.auth, 100, 'La suscripción');
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)').run(
      req.user.id,
      endpoint,
      p256dh,
      authKey,
      now().toISOString(),
    );
    // Tope por cuenta: se conservan las diez más recientes.
    db.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 10)`,
    ).run(req.user.id, req.user.id);
    res.status(201).json({ ok: true });
  });

  app.post('/api/push/unsubscribe', auth, (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(
      req.user.id,
      String(req.body?.endpoint ?? ''),
    );
    res.json({ ok: true });
  });

  // ---------- eventos en vivo ----------
  app.get('/api/events', auth, (req, res) => {
    if (req.user.role !== 'student' && req.user.role !== 'shop') fail(403, 'Tu cuenta no tiene acceso a esta sección.');
    const key = req.user.role === 'shop' ? `shop:${req.user.shop_id}` : `user:${req.user.id}`;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    hub.add(key, res);
    req.on('close', () => hub.remove(key, res));
  });

  // ---------- estudiante: locales y menú ----------
  app.get('/api/campuses/:id/shops', auth, (req, res) => {
    const shops = db
      .prepare("SELECT * FROM shops WHERE campus_id = ? AND status = 'activo' ORDER BY name")
      .all(Number(req.params.id));
    res.json(shops.map(shopOut));
  });

  app.get('/api/shops/:id', auth, (req, res) => {
    const shop = visibleShop(req, Number(req.params.id));
    const products = db
      .prepare('SELECT * FROM products WHERE shop_id = ? AND deleted = 0 ORDER BY id')
      .all(shop.id)
      .map(productRow);
    res.json({ shop: shopOut(shop), products, loyalty: req.user.role === 'student' ? loyaltyFor(shop, req.user.id) : null });
  });

  app.get('/api/shops/:id/slots', auth, (req, res) => {
    const shop = visibleShop(req, Number(req.params.id));
    if (shop.status !== 'activo') return res.json([]);
    const ids = String(req.query.products ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 30);
    res.json(slotsFor(shop, ids));
  });

  /** Anticipación del pedido: la mayor entre la del local y la de cada producto del carrito. */
  const leadFor = (shop, productIds) => {
    if (productIds.length === 0) return shop.prep_minutes;
    const marks = productIds.map(() => '?').join(',');
    const r = db
      .prepare(`SELECT MAX(prep_minutes) AS m FROM products WHERE shop_id = ? AND id IN (${marks})`)
      .get(shop.id, ...productIds);
    return Math.max(shop.prep_minutes, r?.m ?? 0);
  };
  /** Promoción vigente para una hora de retiro (minutos desde medianoche): el mayor descuento que la cubra. */
  const promoFor = (shop, minutes) =>
    parseJson(shop.promos)
      .filter((p) => minutes >= p.from && minutes < p.to)
      .reduce((best, p) => (p.percent > (best?.percent ?? 0) ? p : best), null);
  const slotsFor = (shop, productIds) =>
    buildSlots({ ...shop, prep_minutes: leadFor(shop, productIds) }, now(), slotCounts(shop.id)).map((s) => {
      const promo = promoFor(shop, toMinutes(s.time));
      return promo ? { ...s, promo: promo.percent } : s;
    });

  // ---------- tarjeta de sellos ----------
  // Cada pedido entregado suma un sello; cada `loyalty_every` sellos se gana un producto de regalo
  // (hasta `loyalty_max`). Se calcula desde los pedidos, así que no hay saldo que se pueda alterar.
  const loyaltyFor = (shop, userId) => {
    if (!shop.loyalty_every) return null;
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(status = 'entregado'), 0) AS stamps,
                COALESCE(SUM(reward_discount > 0 AND status NOT IN ('cancelado')), 0) AS used
         FROM orders WHERE shop_id = ? AND user_id = ?`,
      )
      .get(shop.id, userId);
    const earned = Math.floor(r.stamps / shop.loyalty_every);
    return {
      every: shop.loyalty_every,
      max: shop.loyalty_max,
      stamps: r.stamps % shop.loyalty_every,
      rewards: Math.max(0, earned - r.used),
    };
  };

  /**
   * Precio de un pedido, calculado solo con datos de la base: productos y opciones del menú actual,
   * promoción de la hora de retiro y premio de la tarjeta de sellos.
   */
  const priceOrder = (shop, b, userId) => {
    if (!Array.isArray(b.items) || b.items.length === 0) fail(400, 'Tu carrito está vacío.');
    if (b.items.length > 30) fail(400, 'El pedido tiene demasiados productos distintos.');
    const seen = new Set();
    const lines = b.items.map((it) => {
      const qty = int(it?.qty, 1, 20, 'La cantidad');
      const p = db
        .prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted = 0')
        .get(Number(it?.productId), shop.id);
      if (!p) fail(409, 'Un producto de tu carrito ya no existe. Revisa el menú.');
      if (!p.available) fail(409, `"${p.name}" se agotó. Quítalo del carrito para continuar.`);
      // Opciones elegidas: se validan contra el menú actual y su precio también sale de la base.
      const wanted = new Set(Array.isArray(it?.choices) ? it.choices.slice(0, 40).map(String) : []);
      const chosen = [];
      for (const g of parseJson(p.options)) {
        const picked = g.choices.filter((c) => wanted.has(c.id));
        if (g.required && picked.length === 0) fail(409, `Elige ${g.name.toLowerCase()} para "${p.name}".`);
        if (!g.multiple && picked.length > 1) fail(400, `Solo puedes elegir una opción de ${g.name.toLowerCase()} en "${p.name}".`);
        for (const c of picked) {
          wanted.delete(c.id);
          chosen.push({ id: c.id, group: g.name, name: c.name, price: c.price });
        }
      }
      if (wanted.size > 0) fail(409, `El menú de "${p.name}" cambió. Vuelve a agregarlo al carrito.`);
      const key = `${p.id}:${chosen.map((c) => c.id).sort().join(',')}`;
      if (seen.has(key)) fail(400, 'Hay un producto repetido en el pedido.');
      seen.add(key);
      return { p, qty, chosen, unit: p.price + chosen.reduce((n, c) => n + c.price, 0) };
    });
    const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
    // Premio: el producto más caro del pedido sale gratis, hasta el tope que definió el local.
    let reward = 0;
    if (b.useReward) {
      const card = loyaltyFor(shop, userId);
      if (!card || card.rewards < 1) fail(409, 'No tienes premios disponibles en este local.');
      reward = Math.min(shop.loyalty_max, Math.max(...lines.map((l) => l.unit)));
    }
    const slotTime = typeof b.slot === 'string' && /T\d{2}:\d{2}$/.test(b.slot) ? toMinutes(b.slot.slice(11)) : null;
    const promo = slotTime === null ? null : promoFor(shop, slotTime);
    const promoDiscount = promo ? Math.round(((subtotal - reward) * promo.percent) / 100) : 0;
    return {
      lines,
      subtotal,
      reward_discount: reward,
      promo_discount: promoDiscount,
      promo_percent: promo?.percent ?? 0,
      total: subtotal - reward - promoDiscount,
      lead: leadFor(shop, lines.map((l) => l.p.id)),
    };
  };

  // Vista previa del precio en el carrito: la misma cuenta que se usa al crear el pedido.
  app.post('/api/orders/quote', student, (req, res) => {
    const b = req.body ?? {};
    const shop = getShop(int(b.shopId, 1, 1e9, 'El local'));
    if (shop.status !== 'activo') fail(404, 'No encontramos ese local.');
    const q = priceOrder(shop, b, req.user.id);
    res.json({
      subtotal: q.subtotal,
      promo_discount: q.promo_discount,
      promo_percent: q.promo_percent,
      reward_discount: q.reward_discount,
      total: q.total,
      loyalty: loyaltyFor(shop, req.user.id),
    });
  });

  // ---------- favoritos ----------
  app.get('/api/favorites', student, (req, res) => {
    const rows = db
      .prepare(
        `SELECT p.*, s.name AS shop_name FROM favorites f
         JOIN products p ON p.id = f.product_id JOIN shops s ON s.id = p.shop_id
         WHERE f.user_id = ? AND p.deleted = 0 AND s.status = 'activo' AND s.campus_id = ?
         ORDER BY f.created_at DESC LIMIT 30`,
      )
      .all(req.user.id, req.user.campus_id ?? 0);
    res.json(rows.map((r) => ({ ...productRow(r), shop_name: r.shop_name })));
  });
  app.post('/api/favorites/:productId', student, (req, res) => {
    const p = db
      .prepare(
        "SELECT p.id FROM products p JOIN shops s ON s.id = p.shop_id WHERE p.id = ? AND p.deleted = 0 AND s.status = 'activo'",
      )
      .get(Number(req.params.productId));
    if (!p) fail(404, 'No encontramos ese producto.');
    const count = db.prepare('SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?').get(req.user.id).c;
    if (count >= 100) fail(409, 'Llegaste al máximo de favoritos.');
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id, created_at) VALUES (?,?,?)').run(req.user.id, p.id, now().toISOString());
    res.json({ ok: true });
  });
  app.delete('/api/favorites/:productId', student, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
    res.json({ ok: true });
  });

  // Búsqueda de productos en los locales activos de una sede, sin distinguir tildes ni mayúsculas.
  const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  app.get('/api/campuses/:id/search', auth, (req, res) => {
    const q = plain(String(req.query.q ?? '').trim().slice(0, 40));
    if (q.length < 2) return res.json([]);
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.description, p.price, p.emoji, p.image_id, p.category, s.id AS shop_id, s.name AS shop_name
         FROM products p JOIN shops s ON s.id = p.shop_id
         WHERE s.campus_id = ? AND s.status = 'activo' AND p.deleted = 0 AND p.available = 1`,
      )
      .all(Number(req.params.id));
    res.json(
      rows
        .filter((r) => plain(`${r.name} ${r.category} ${r.description}`).includes(q))
        .slice(0, 20)
        .map(({ image_id, ...r }) => ({ ...r, image: image_id ? `/api/images/${image_id}` : null })),
    );
  });

  // ---------- estudiante: pedidos ----------
  app.post('/api/orders', student, async (req, res) => {
    const b = req.body ?? {};
    const shop = getShop(int(b.shopId, 1, 1e9, 'El local'));
    if (shop.status !== 'activo') fail(404, 'No encontramos ese local.');
    if (shop.paused) fail(409, `${shop.name} no está recibiendo pedidos en este momento.`);
    if (noShows(req.user.id) >= NO_SHOW_LIMIT)
      fail(409, `Tienes ${NO_SHOW_LIMIT} pedidos sin retirar en los últimos 30 días, así que por ahora no puedes hacer pedidos nuevos.`);
    const note = str(b.note, 200, 'La nota', { required: false });
    // Si la plataforma cobra en la app, ese es el camino por defecto; pagar al retirar solo si el local lo acepta.
    // La beca Junaeb se paga siempre al retirar, en los locales adheridos a su operador.
    let method;
    if (b.paymentMethod === 'junaeb') {
      if (!shop.accepts_baes) fail(409, `${shop.name} no recibe la beca Junaeb. Elige otro medio de pago.`);
      method = 'junaeb';
    } else {
      method = payments ? (b.paymentMethod === 'local' ? 'local' : 'app') : 'local';
      if (method === 'local' && payments && !shop.pay_at_shop)
        fail(409, `${shop.name} solo recibe pedidos pagados en la app.`);
    }
    // Pagar al retirar exige confianza: el local prepara algo que todavía no está pagado.
    if (method !== 'app') {
      const blocked = payLaterProblem(req.user.id);
      if (blocked) fail(409, blocked);
    }
    // Los precios siempre se calculan aquí: lo que mande el navegador no se usa para cobrar.
    const price = priceOrder(shop, b, req.user.id);
    const { lines, total } = price;

    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND (status IN ${ACTIVE} OR status = 'pago_pendiente')`)
      .get(req.user.id).c;
    if (active >= MAX_ACTIVE_ORDERS)
      fail(409, `Tienes ${active} pedidos en curso. Retira alguno antes de hacer otro.`);

    db.exec('BEGIN IMMEDIATE');
    let orderId;
    try {
      // El cupo se revisa dentro de la transacción para que dos pedidos no tomen el último lugar.
      const slot = buildSlots({ ...shop, prep_minutes: price.lead }, now(), slotCounts(shop.id)).find((s) => s.slot === b.slot);
      if (!slot) fail(409, 'Esa hora de retiro ya no está disponible. Elige otra.');
      if (slot.remaining <= 0) fail(409, `El retiro de las ${slot.time} se llenó. Elige otra hora.`);
      const at = now().toISOString();
      orderId = db
        .prepare(
          `INSERT INTO orders (code, user_id, shop_id, slot, status, payment_method, payment_status, paid, total, subtotal, promo_discount, reward_discount, funded_discount, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          newCode(),
          req.user.id,
          shop.id,
          slot.slot,
          method === 'app' ? 'pago_pendiente' : 'recibido',
          method,
          method === 'app' ? 'pendiente' : '',
          0,
          total,
          price.subtotal,
          price.promo_discount,
          price.reward_discount,
          // Las promociones y los premios los paga la plataforma, no el local.
          price.promo_discount + price.reward_discount,
          note,
          at,
        ).lastInsertRowid;
      const ins = db.prepare(
        'INSERT INTO order_items (order_id, product_id, name, emoji, price, qty, options) VALUES (?,?,?,?,?,?,?)',
      );
      for (const l of lines) ins.run(orderId, l.p.id, l.p.name, l.p.emoji, l.unit, l.qty, JSON.stringify(l.chosen));
      db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?,?,?)').run(orderId, method === 'app' ? 'pago_pendiente' : 'recibido', at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const order = getOrder(orderId);
    if (method !== 'app') return res.status(201).json(announce(order));
    // Pago en la app: el pedido le llega al local recién cuando el pago se aprueba.
    let checkout;
    try {
      checkout = await payments.createCheckout(order);
    } catch (e) {
      console.warn('No se pudo iniciar el pago:', e.message);
      db.prepare("UPDATE orders SET status = 'cancelado', payment_status = 'expirado', cancel_reason = 'No se pudo iniciar el pago' WHERE id = ?").run(order.id);
      fail(502, 'No pudimos conectar con el servicio de pago. Intenta de nuevo en un momento.');
    }
    db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(checkout.ref ?? '', order.id);
    res.status(201).json({ ...getOrder(order.id), pay_url: checkout.url });
  });

  /** Entrega un pedido nuevo al local: aceptación automática, aviso en vivo y notificación push. */
  const announce = (orderIn) => {
    let order = orderIn;
    const shop = getShop(order.shop_id);
    // Con aceptación automática el pedido entra directo a preparación y el estudiante recibe el aviso de inmediato.
    if (shop.auto_accept) order = setStatus(order, 'preparando');
    hub.send(`shop:${shop.id}`, 'order', { type: 'new', order: forShop(order) });
    push?.toShop(shop.id, {
      title: `Nuevo pedido para las ${order.slot.slice(11)}`,
      body: `${order.customer_name}: ${order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}${order.payment_method === 'junaeb' ? ' · paga con Junaeb' : ''}`,
      url: '/panel',
      tag: `order-${order.id}`,
    });
    return order;
  };

  const commissionBps = () =>
    Number(db.prepare("SELECT value FROM settings WHERE key = 'commission_bps'").get()?.value ?? 0);

  /** Devuelve el dinero de un pedido pagado en la app. Si el proveedor falla, queda marcado para revisión. */
  const refund = async (order) => {
    if (order.payment_method !== 'app' || order.payment_status !== 'aprobado') return getOrder(order.id);
    let status = 'reembolsado';
    try {
      await payments.refund(order.payment_ref);
    } catch (e) {
      console.warn(`No se pudo reembolsar el pedido ${order.code}:`, e.message);
      status = 'reembolso_fallido';
    }
    db.prepare('UPDATE orders SET payment_status = ?, fee = 0, paid = 0 WHERE id = ?').run(status, order.id);
    const fresh = getOrder(order.id);
    hub.send(`user:${fresh.user_id}`, 'order', { type: 'update', order: fresh });
    return fresh;
  };

  /**
   * Aplica a un pedido el resultado de un pago consultado al proveedor (nunca lo que diga el navegador).
   * Es idempotente: puede llegar el aviso del proveedor y la consulta del estudiante al mismo tiempo.
   */
  const applyPayment = async (orderId, payment) => {
    const order = getOrder(orderId);
    if (!order || order.payment_method !== 'app' || !payment) return order;
    if (payment.status !== 'approved') return order;
    // El pago tiene que ser el cobro creado para este pedido, no uno con un número de pedido parecido.
    if (payments?.mode === 'mercadopago' && payment.ref !== order.payment_ref) {
      console.warn(`El cobro ${payment.ref} no es el del pedido ${order.code}: no se aplica.`);
      return order;
    }
    if (payment.amount !== order.total || (payment.currency && payment.currency !== 'CLP')) {
      console.warn(`El pago ${payment.ref} no coincide con el pedido ${order.code}: no se aprueba.`);
      return order;
    }
    if (order.payment_status === 'pendiente') {
      // La comisión se calcula sobre el precio completo: el descuento lo pone la plataforma.
      const fee = Math.round(((order.total + order.funded_discount) * commissionBps()) / 10000);
      // Solo una de las vías concurrentes puede pasar el pedido de pendiente a aprobado.
      const changed = db
        .prepare("UPDATE orders SET payment_status = 'aprobado', payment_ref = ?, fee = ?, paid = 1 WHERE id = ? AND payment_status = 'pendiente'")
        .run(payment.ref, fee, order.id).changes;
      if (!changed) return getOrder(order.id);
      if (order.status === 'pago_pendiente') return announce(setStatus(getOrder(order.id), 'recibido', { by: 'payment' }));
    }
    // Pagó tarde, cuando la reserva ya había vencido: se le devuelve el dinero.
    if (order.payment_status === 'expirado') {
      db.prepare("UPDATE orders SET payment_status = 'aprobado', payment_ref = ?, paid = 1 WHERE id = ? AND payment_status = 'expirado'").run(payment.ref, order.id);
      return refund(getOrder(order.id));
    }
    return getOrder(order.id);
  };

  /** Libera las horas reservadas por pedidos que nunca se pagaron. */
  const expireUnpaid = async () => {
    const limit = new Date(now().getTime() - (CHECKOUT_MINUTES + 2) * 60000).toISOString();
    const stale = db
      .prepare("SELECT id FROM orders WHERE status = 'pago_pendiente' AND payment_status = 'pendiente' AND created_at < ?")
      .all(limit);
    for (const { id } of stale) {
      // Antes de liberar la hora se consulta una última vez por si el aviso del proveedor no llegó.
      const found = await payments?.findPayment(getOrder(id)).catch(() => null);
      const after = await applyPayment(id, found);
      if (after?.payment_status !== 'pendiente') continue;
      // Se cierra el cobro en el proveedor para que el enlace ya no se pueda pagar.
      await payments?.cancel(after.payment_ref).catch(() => {});
      db.prepare("UPDATE orders SET payment_status = 'expirado', cancel_reason = 'No se completó el pago' WHERE id = ?").run(id);
      setStatus(getOrder(id), 'cancelado', { paid: false, by: 'payment' });
    }
  };
  app.locals.expireUnpaid = expireUnpaid;
  if (payments) setInterval(() => void expireUnpaid().catch((e) => console.warn(e.message)), 60000).unref();

  // Volver a abrir el pago de un pedido pendiente (por ejemplo, si cerró la pestaña del pago).
  app.post('/api/orders/:id/pay', student, async (req, res) => {
    const o = myOrder(req);
    if (!payments || o.status !== 'pago_pendiente') fail(409, 'Este pedido no tiene un pago pendiente.');
    const checkout = await payments.createCheckout(o).catch((e) => {
      console.warn('No se pudo iniciar el pago:', e.message);
      fail(502, 'No pudimos conectar con el servicio de pago. Intenta de nuevo.');
    });
    db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(checkout.ref ?? '', o.id);
    res.json({ pay_url: checkout.url });
  });

  // Al volver del pago, la app pregunta el resultado. La respuesta sale del proveedor, no del navegador.
  app.post('/api/orders/:id/payment/check', student, async (req, res) => {
    const o = myOrder(req);
    if (!payments || o.payment_method !== 'app' || o.payment_status !== 'pendiente') return res.json(o);
    if (limiter.hit(`paycheck|${o.id}`, 20, 60000)) return res.json(o);
    const found = await payments.findPayment(o).catch(() => null);
    res.json(await applyPayment(o.id, found));
  });

  // Pantalla de pago de prueba (solo en modo simulado): aprueba o rechaza sin mover dinero.
  app.post('/api/orders/:id/simulate-payment', student, async (req, res) => {
    if (payments?.mode !== 'simulado') fail(404, 'Ruta no encontrada.');
    const o = myOrder(req);
    if (o.payment_status !== 'pendiente') return res.json(o);
    if (!req.body?.approve) return res.json(o);
    res.json(await applyPayment(o.id, { ref: `simulado-${o.id}-${Date.now()}`, status: 'approved', amount: o.total, currency: 'CLP' }));
  });

  // Aviso de Mercado Pago. Se responde rápido y el pago se vuelve a consultar a Mercado Pago antes de usarlo.
  app.post('/api/payments/webhook', async (req, res) => {
    if (payments?.mode !== 'mercadopago') return res.status(404).json({ error: 'Ruta no encontrada.' });
    const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
    const type = String(req.query.type ?? req.body?.type ?? '');
    if (type !== 'order' || !/^[A-Za-z0-9]{1,64}$/.test(dataId)) return res.json({ ok: true });
    if (!payments.verifyWebhook(req.headers, dataId)) return res.status(401).json({ error: 'Firma inválida.' });
    res.json({ ok: true });
    try {
      const p = await payments.getPayment(dataId);
      // El pedido se busca por el cobro de Mercado Pago, que es único; nunca por el número que viene en el aviso.
      const local = p && db.prepare('SELECT id FROM orders WHERE payment_ref = ?').get(p.ref);
      if (local) await applyPayment(local.id, p);
    } catch (e) {
      console.warn('No se pudo procesar un aviso de pago:', e.message);
    }
  });

  app.get('/api/orders', student, (req, res) => {
    const rows = db.prepare(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50`).all(req.user.id);
    res.json(rows.map(orderOut));
  });

  const myOrder = (req) => {
    const o = getOrder(Number(req.params.id));
    if (!o || o.user_id !== req.user.id) fail(404, 'No encontramos ese pedido.');
    return o;
  };

  app.get('/api/orders/:id', student, (req, res) => {
    res.json(myOrder(req));
  });

  app.post('/api/orders/:id/cancel', student, async (req, res) => {
    let o = myOrder(req);
    if (o.status === 'pago_pendiente') {
      // Si alcanzó a pagar justo antes de cancelar, el pago se aplica y el pedido se cancela con devolución (abajo).
      const found = await payments?.findPayment(o).catch(() => null);
      if (found?.status === 'approved') o = await applyPayment(o.id, found);
    }
    if (o.status === 'pago_pendiente') {
      await payments?.cancel(o.payment_ref).catch(() => {});
      db.prepare("UPDATE orders SET payment_status = 'expirado' WHERE id = ? AND payment_status = 'pendiente'").run(o.id);
      return res.json(setStatus(getOrder(o.id), 'cancelado', { paid: false, by: 'payment' }));
    }
    if (o.status !== 'recibido') fail(409, 'El local ya empezó a preparar tu pedido, así que no se puede cancelar.');
    const cancelled = setStatus(o, 'cancelado', { paid: o.paid, by: 'student' });
    res.json(await refund(cancelled));
  });

  app.post('/api/orders/:id/rate', student, (req, res) => {
    const o = myOrder(req);
    if (o.status !== 'entregado') fail(409, 'Puedes calificar un pedido cuando ya lo retiraste.');
    const rating = int(req.body?.rating, 1, 5, 'La calificación');
    const comment = str(req.body?.comment, 200, 'El comentario', { required: false });
    db.prepare('UPDATE orders SET rating = ?, rating_comment = ? WHERE id = ?').run(rating, comment, o.id);
    res.json(getOrder(o.id));
  });

  // ---------- panel del local ----------
  const myShop = (req) => getShop(req.user.shop_id);

  app.get('/api/shop/me', shopOnly, (req, res) => {
    res.json(shopOut(myShop(req)));
  });

  /** Valida las promociones por horario: hasta 6, de 1 % a 50 %, sin traslaparse. */
  const promosOf = (v) => {
    if (!Array.isArray(v)) fail(400, 'Las promociones no son válidas.');
    if (v.length > 6) fail(400, 'Puedes tener hasta 6 promociones.');
    const list = v
      .map((p) => ({
        from: int(p?.from, 0, 1439, 'La hora de inicio de la promoción'),
        to: int(p?.to, 1, 1440, 'La hora de término de la promoción'),
        percent: int(p?.percent, 1, 50, 'El descuento de la promoción'),
      }))
      .sort((a, b) => a.from - b.from);
    list.forEach((p, i) => {
      if (p.to <= p.from) fail(400, 'Cada promoción debe terminar después de empezar.');
      if (i > 0 && p.from < list[i - 1].to) fail(400, 'Hay promociones que se traslapan. Ajusta sus horarios.');
    });
    return list;
  };

  const daysOfWeek = (v) => {
    const set = [...new Set(String(v))].filter((d) => /^[0-6]$/.test(d)).sort();
    if (set.length === 0) fail(400, 'Elige al menos un día de atención.');
    return set.join('');
  };

  app.patch('/api/shop/me', shopOnly, (req, res) => {
    const s = myShop(req);
    const b = req.body ?? {};
    if (b.promos !== undefined || b.loyalty_every !== undefined || b.loyalty_max !== undefined)
      fail(403, `Las promociones y la tarjeta de sellos las define y las paga ${BRAND}.`);
    const next = {
      name: b.name !== undefined ? str(b.name, 60, 'El nombre') : s.name,
      description: b.description !== undefined ? str(b.description, 120, 'La descripción', { required: false }) : s.description,
      location: b.location !== undefined ? str(b.location, 80, 'La ubicación', { required: false }) : s.location,
      emoji: b.emoji !== undefined ? str(b.emoji, 8, 'El ícono') : s.emoji,
      opens: b.opens !== undefined ? int(b.opens, 0, 1430, 'La hora de apertura') : s.opens,
      closes: b.closes !== undefined ? int(b.closes, 10, 1439, 'La hora de cierre') : s.closes,
      prep_minutes: b.prep_minutes !== undefined ? int(b.prep_minutes, 0, 120, 'El tiempo de preparación') : s.prep_minutes,
      slot_capacity: b.slot_capacity !== undefined ? int(b.slot_capacity, 1, 100, 'El cupo por franja') : s.slot_capacity,
      paused: b.paused !== undefined ? (b.paused ? 1 : 0) : s.paused,
      auto_accept: b.auto_accept !== undefined ? (b.auto_accept ? 1 : 0) : s.auto_accept,
      days: b.days !== undefined ? daysOfWeek(b.days) : s.days,
      pay_at_shop: b.pay_at_shop !== undefined ? (b.pay_at_shop ? 1 : 0) : s.pay_at_shop,
      accepts_baes: b.accepts_baes !== undefined ? (b.accepts_baes ? 1 : 0) : s.accepts_baes,
      promos: s.promos,
      loyalty_every: s.loyalty_every,
      loyalty_max: s.loyalty_max,
    };
    if (next.closes <= next.opens) fail(400, 'La hora de cierre debe ser posterior a la de apertura.');
    db.prepare(
      `UPDATE shops SET name=?, description=?, location=?, emoji=?, opens=?, closes=?, prep_minutes=?, slot_capacity=?, paused=?, auto_accept=?, days=?, pay_at_shop=?, accepts_baes=?, promos=?, loyalty_every=?, loyalty_max=?
       WHERE id=?`,
    ).run(
      next.name,
      next.description,
      next.location,
      next.emoji,
      next.opens,
      next.closes,
      next.prep_minutes,
      next.slot_capacity,
      next.paused,
      next.auto_accept,
      next.days,
      next.pay_at_shop,
      next.accepts_baes,
      next.promos,
      next.loyalty_every,
      next.loyalty_max,
      s.id,
    );
    res.json(shopOut(getShop(s.id)));
  });

  app.get('/api/shop/orders', shopOnly, (req, res) => {
    const today = chileNow(now()).date;
    const rows = db
      .prepare(
        `${ORDER_SELECT} WHERE o.shop_id = ? AND (o.slot >= ? OR o.status IN ${ACTIVE}) AND o.payment_status NOT IN ${UNPAID}
         ORDER BY o.slot, o.id`,
      )
      .all(req.user.shop_id, today);
    res.json({ today, orders: rows.map((o) => forShop(orderOut(o))) });
  });

  // Detalle de pedidos del período en CSV, para la contabilidad del local.
  app.get('/api/shop/orders.csv', shopOnly, (req, res) => {
    const today = chileNow(now()).date;
    const from = addDays(today, -(daysOf(req) - 1));
    const rows = db
      .prepare(`${ORDER_SELECT} WHERE o.shop_id = ? AND substr(o.slot, 1, 10) BETWEEN ? AND ? ORDER BY o.slot, o.id`)
      .all(req.user.shop_id, from, today)
      .map(orderOut);
    // Las celdas que parten con =, +, - o @ se anteponen con ' para que la planilla no las ejecute como fórmula.
    const cell = (v) => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
    const STATUS = { recibido: 'Por aceptar', preparando: 'En preparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado', no_retirado: 'No retirado' };
    const PAYMENT = { app: 'En la app', local: 'En el local', junaeb: 'Beca Junaeb', otro_medio: 'En el local (la beca no pasó)' };
    const lines = [
      ['Fecha', 'Hora de retiro', 'Código', 'Cliente', 'Productos', 'Total (CLP)', 'Pago', 'Estado', 'Calificación'],
      ...rows.map((o) => [
        o.slot.slice(0, 10),
        o.slot.slice(11),
        o.code,
        o.customer_name,
        o.items.map((i) => `${i.qty}x ${i.name}${i.options.length ? ` (${i.options.map((c) => c.name).join(', ')})` : ''}`).join(' + '),
        o.total,
        PAYMENT[o.payment_method === 'junaeb' && o.payment_status === 'otro_medio' ? 'otro_medio' : o.payment_method] ?? o.payment_method,
        STATUS[o.status] ?? o.status,
        o.rating ?? '',
      ]),
    ];
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${SLUG}-pedidos-${from}-a-${today}.csv"`,
    });
    res.send('\ufeff' + lines.map((l) => l.map(cell).join(';')).join('\r\n'));
  });

  // Lo que la app le generó al local en el período, comparado con el período anterior.
  // Los minutos de fila evitados son una estimación con un valor conservador por pedido, y la app lo dice.
  const QUEUE_MINUTES_PER_ORDER = 5;
  app.get('/api/shop/impact', shopOnly, (req, res) => {
    const days = daysOf(req);
    const today = chileNow(now()).date;
    const from = addDays(today, -(days - 1));
    const prevFrom = addDays(from, -days);
    const prevTo = addDays(from, -1);
    const shopId = req.user.shop_id;
    const base = `shop_id = ? AND payment_status NOT IN ${UNPAID}`;
    const period = (a, b) =>
      db
        .prepare(
          `SELECT COALESCE(SUM(status = 'entregado'), 0) AS delivered,
                  COALESCE(SUM(CASE WHEN status = 'entregado' THEN total + funded_discount ELSE 0 END), 0) AS sales,
                  COALESCE(SUM(status = 'no_retirado' AND payment_method = 'app' AND payment_status = 'aprobado'), 0) AS no_show_paid,
                  COALESCE(SUM(CASE WHEN status = 'no_retirado' AND payment_method = 'app' AND payment_status = 'aprobado' THEN total ELSE 0 END), 0) AS no_show_paid_amount,
                  COALESCE(SUM(status = 'entregado' AND payment_method = 'junaeb' AND payment_status = 'aprobado'), 0) AS baes_orders,
                  COALESCE(SUM(CASE WHEN status = 'entregado' AND payment_method = 'junaeb' AND payment_status = 'aprobado' THEN total ELSE 0 END), 0) AS baes_sales
           FROM orders WHERE ${base} AND substr(slot, 1, 10) BETWEEN ? AND ?`,
        )
        .get(shopId, a, b);
    const cur = period(from, today);
    const prev = period(prevFrom, prevTo);
    // Horas peak: las de mayor demanda del período (al menos 80 % de la hora más pedida).
    const hours = db
      .prepare(
        `SELECT CAST(substr(slot, 12, 2) AS INTEGER) AS hour, COUNT(*) AS orders FROM orders
         WHERE ${base} AND status = 'entregado' AND substr(slot, 1, 10) BETWEEN ? AND ? GROUP BY hour`,
      )
      .all(shopId, from, today);
    const top = Math.max(0, ...hours.map((h) => h.orders));
    const peak = hours.filter((h) => top > 0 && h.orders >= top * 0.8);
    const customers = db
      .prepare(
        `SELECT user_id, COUNT(*) AS n,
                (SELECT MIN(substr(o2.slot, 1, 10)) FROM orders o2 WHERE o2.shop_id = o.shop_id AND o2.user_id = o.user_id AND o2.status = 'entregado') AS first
         FROM orders o WHERE ${base} AND status = 'entregado' AND substr(slot, 1, 10) BETWEEN ? AND ? GROUP BY user_id`,
      )
      .all(shopId, from, today);
    res.json({
      days,
      from,
      to: today,
      delivered: cur.delivered,
      sales: cur.sales,
      previous: { delivered: prev.delivered, sales: prev.sales },
      peak_hours: peak.map((h) => h.hour).sort((a, b) => a - b),
      peak_orders: peak.reduce((n, h) => n + h.orders, 0),
      queue_minutes_saved: cur.delivered * QUEUE_MINUTES_PER_ORDER,
      queue_minutes_per_order: QUEUE_MINUTES_PER_ORDER,
      customers: customers.length,
      returning: customers.filter((c) => c.n >= 2).length,
      new_customers: customers.filter((c) => c.first >= from).length,
      no_show_paid: cur.no_show_paid,
      no_show_paid_amount: cur.no_show_paid_amount,
      baes_orders: cur.baes_orders,
      baes_sales: cur.baes_sales,
    });
  });

  app.get('/api/shop/stats', shopOnly, (req, res) => {
    const s = stats([req.user.shop_id], daysOf(req));
    const comments = db
      .prepare(
        `SELECT rating, rating_comment AS comment, substr(slot, 1, 10) AS date FROM orders
         WHERE shop_id = ? AND rating IS NOT NULL AND rating_comment != '' ORDER BY id DESC LIMIT 8`,
      )
      .all(req.user.shop_id);
    res.json({ ...s, comments });
  });

  const shopOrder = (req, id) => {
    const o = getOrder(id);
    if (!o || o.shop_id !== req.user.shop_id || o.status === 'pago_pendiente') fail(404, 'No encontramos ese pedido.');
    return o;
  };

  app.post('/api/shop/orders/:id/status', shopOnly, async (req, res) => {
    const o = shopOrder(req, Number(req.params.id));
    const status = req.body?.status;
    if (!(o.status in RANK) || o.status === 'entregado') fail(409, 'Ese pedido ya está cerrado.');
    if (status === 'cancelado') {
      const reason = str(req.body?.reason, 120, 'El motivo', { required: false });
      db.prepare('UPDATE orders SET cancel_reason = ? WHERE id = ?').run(reason, o.id);
      // Si el estudiante pagó en la app, se le devuelve el dinero automáticamente.
      return res.json(forShop(await refund(setStatus(getOrder(o.id), 'cancelado', { paid: o.paid }))));
    }
    if (status === 'no_retirado') {
      if (o.status !== 'listo') fail(409, 'Solo un pedido listo se puede marcar como no retirado.');
      if (chileStamp(now()) <= o.slot) fail(409, 'Todavía no pasa la hora de retiro de este pedido.');
      return res.json(forShop(setStatus(o, 'no_retirado')));
    }
    // Entregar exige el código que muestra el estudiante (ver /api/shop/pickup).
    if (status === 'entregado') fail(400, 'Para entregar, pídele al estudiante su código de retiro.');
    if (!(status in RANK) || RANK[status] <= RANK[o.status]) fail(400, 'Ese cambio de estado no es válido.');
    res.json(forShop(setStatus(o, status)));
  });

  app.post('/api/shop/pickup', shopOnly, (req, res) => {
    const code = str(req.body?.code, 12, 'El código').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Tope de intentos: nadie puede probar códigos al azar desde una cuenta de local.
    if (limiter.hit(`pickup|${req.user.shop_id}`, 40, 60000)) fail(429, 'Demasiados intentos. Espera un momento.');
    // Si se entrega desde la tarjeta de un pedido, el código tiene que ser el de ese pedido.
    const expected = req.body?.orderId !== undefined ? shopOrder(req, Number(req.body.orderId)) : null;
    if (expected && limiter.blocked(`pickup-order|${expected.id}`, 5))
      fail(429, 'Demasiados códigos incorrectos para este pedido. Espera unos minutos o revisa el QR del estudiante.');
    const row = db.prepare('SELECT id FROM orders WHERE code = ? AND shop_id = ?').get(code, req.user.shop_id);
    if (expected && row?.id !== expected.id) {
      limiter.hit(`pickup-order|${expected.id}`, 5, 10 * 60000);
      fail(409, `Ese código no corresponde al pedido de ${expected.customer_name}. Pídele que te muestre su código.`);
    }
    if (!row) fail(404, `No hay un pedido con el código ${code} en este local.`);
    const o = getOrder(row.id);
    if (o.status === 'entregado') fail(409, `El pedido ${code} ya fue entregado.`);
    if (o.status === 'pago_pendiente') fail(404, `No hay un pedido con el código ${code} en este local.`);
    if (!(o.status in RANK)) fail(409, `El pedido ${code} está cerrado y no se puede entregar.`);
    // Beca Junaeb: antes de entregar, el local confirma cómo se cobró. Si la beca no pasó (sin saldo, sin señal),
    // el estudiante paga con otro medio y queda registrado.
    if (o.payment_method === 'junaeb') {
      const charge = req.body?.charge;
      if (charge !== 'junaeb' && charge !== 'otro')
        fail(409, `Cobra ${money(o.total)} con la beca Junaeb antes de entregar.`, {
          charge: { orderId: o.id, code: o.code, total: o.total, operator: o.baes_operator, customer: o.customer_name },
        });
      db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(charge === 'junaeb' ? 'aprobado' : 'otro_medio', o.id);
    }
    res.json(forShop(setStatus(getOrder(o.id), 'entregado', { paid: true })));
  });

  // menú del local
  const newId = () => crypto.randomBytes(4).toString('hex');
  /** Valida los grupos de opciones de un producto (tamaños, agregados…) y les asigna identificadores estables. */
  const optionsOf = (v) => {
    if (!Array.isArray(v)) fail(400, 'Las opciones no son válidas.');
    if (v.length > 8) fail(400, 'Un producto puede tener hasta 8 grupos de opciones.');
    const ids = new Set();
    const idOf = (raw) => {
      let id = typeof raw === 'string' && /^[a-z0-9]{1,12}$/i.test(raw) && !ids.has(raw) ? raw : newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      return id;
    };
    return v.map((g) => {
      const choices = Array.isArray(g?.choices) ? g.choices : [];
      if (choices.length < 1 || choices.length > 15) fail(400, 'Cada grupo de opciones necesita entre 1 y 15 alternativas.');
      return {
        id: idOf(g.id),
        name: str(g.name, 30, 'El nombre del grupo de opciones'),
        required: !!g.required,
        multiple: !!g.multiple,
        choices: choices.map((c) => ({
          id: idOf(c?.id),
          name: str(c?.name, 40, 'El nombre de la alternativa'),
          price: int(c?.price ?? 0, 0, 1_000_000, 'El precio de la alternativa'),
        })),
      };
    });
  };
  const productBody = (b, base = {}, shopId) => {
    const p = {
      category: b.category !== undefined ? str(b.category, 30, 'La categoría') : base.category,
      name: b.name !== undefined ? str(b.name, 60, 'El nombre') : base.name,
      description:
        b.description !== undefined ? str(b.description, 120, 'La descripción', { required: false }) : base.description ?? '',
      price: b.price !== undefined ? int(b.price, 0, 1_000_000, 'El precio') : base.price,
      emoji: b.emoji !== undefined ? str(b.emoji, 8, 'El ícono', { required: false }) : base.emoji ?? '',
      available: b.available !== undefined ? (b.available ? 1 : 0) : base.available ?? 1,
      image_id: base.image_id ?? null,
      options: base.options ?? '[]',
      prep_minutes: b.prepMinutes !== undefined ? int(b.prepMinutes, 0, 240, 'El tiempo de preparación') : base.prep_minutes ?? 0,
    };
    if (b.imageId !== undefined) {
      p.image_id = b.imageId === null ? null : int(b.imageId, 1, 1e12, 'La foto');
      if (p.image_id && !db.prepare('SELECT 1 FROM images WHERE id = ? AND shop_id = ?').get(p.image_id, shopId))
        fail(400, 'Esa foto no pertenece a tu local.');
    }
    if (b.options !== undefined) p.options = JSON.stringify(optionsOf(b.options));
    if (p.category === undefined || p.name === undefined || p.price === undefined)
      fail(400, 'El producto necesita categoría, nombre y precio.');
    return p;
  };
  const productOut = (id) => productRow(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  /** Borra las fotos del local que ya no usa ningún producto (con una hora de gracia para las recién subidas). */
  const sweepImages = (shopId) => {
    db.prepare(
      `DELETE FROM images WHERE shop_id = ? AND created_at < ?
         AND id NOT IN (SELECT image_id FROM products WHERE shop_id = ? AND image_id IS NOT NULL AND deleted = 0)`,
    ).run(shopId, new Date(now().getTime() - 3600_000).toISOString(), shopId);
  };

  // Fotos de productos. El navegador las reduce antes de subirlas; aquí se revisa que de verdad sean imágenes.
  const imageType = (buf) => {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
  };
  app.post(
    '/api/shop/images',
    shopOnly,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
    (req, res) => {
      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      const mime = buf && imageType(buf);
      if (!mime) fail(400, 'El archivo no es una imagen JPG, PNG o WebP.');
      const count = db.prepare('SELECT COUNT(*) AS c FROM images WHERE shop_id = ?').get(req.user.shop_id).c;
      if (count >= 400) fail(409, 'Llegaste al máximo de fotos. Elimina productos que ya no uses.');
      const id = db
        .prepare('INSERT INTO images (shop_id, mime, data, created_at) VALUES (?,?,?,?)')
        .run(req.user.shop_id, mime, buf, now().toISOString()).lastInsertRowid;
      res.status(201).json({ id, url: `/api/images/${id}` });
    },
  );
  const myProduct = (req) =>
    db
      .prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted = 0')
      .get(Number(req.params.id), req.user.shop_id) ?? fail(404, 'No encontramos ese producto.');

  app.post('/api/shop/products', shopOnly, (req, res) => {
    const p = productBody(req.body ?? {}, {}, req.user.shop_id);
    const count = db.prepare('SELECT COUNT(*) AS c FROM products WHERE shop_id = ? AND deleted = 0').get(req.user.shop_id).c;
    if (count >= 300) fail(409, 'Llegaste al máximo de 300 productos en el menú.');
    const id = db
      .prepare(
        'INSERT INTO products (shop_id, category, name, description, price, emoji, available, image_id, options, prep_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(req.user.shop_id, p.category, p.name, p.description, p.price, p.emoji, p.available, p.image_id, p.options, p.prep_minutes).lastInsertRowid;
    res.status(201).json(productOut(id));
  });

  app.patch('/api/shop/products/:id', shopOnly, (req, res) => {
    const current = myProduct(req);
    const p = productBody(req.body ?? {}, current, req.user.shop_id);
    db.prepare(
      'UPDATE products SET category=?, name=?, description=?, price=?, emoji=?, available=?, image_id=?, options=?, prep_minutes=? WHERE id=?',
    ).run(
      p.category,
      p.name,
      p.description,
      p.price,
      p.emoji,
      p.available,
      p.image_id,
      p.options,
      p.prep_minutes,
      current.id,
    );
    sweepImages(req.user.shop_id);
    res.json(productOut(current.id));
  });

  app.delete('/api/shop/products/:id', shopOnly, (req, res) => {
    // Borrado lógico: los pedidos antiguos siguen apuntando al producto.
    db.prepare('UPDATE products SET deleted = 1 WHERE id = ?').run(myProduct(req).id);
    sweepImages(req.user.shop_id);
    res.json({ ok: true });
  });

  // ---------- panel de la institución ----------
  const institutionShops = (req) =>
    db
      .prepare(
        `SELECT s.*, c.name AS campus_name FROM shops s JOIN campuses c ON c.id = s.campus_id
         WHERE c.institution_id = ? ORDER BY c.name, s.name`,
      )
      .all(req.user.institution_id);

  app.get('/api/admin/overview', adminOnly, (req, res) => {
    const days = daysOf(req);
    const campusId = req.query.campus ? Number(req.query.campus) : null;
    const campuses = db
      .prepare(
        `SELECT c.id, c.name, c.city, c.baes_operator,
                (SELECT COUNT(*) FROM users u WHERE u.campus_id = c.id AND u.role = 'student' AND u.deleted_at IS NULL) AS students,
                (SELECT COUNT(*) FROM shops s WHERE s.campus_id = c.id AND s.status = 'activo' AND s.accepts_baes = 1) AS baes_shops
         FROM campuses c WHERE c.institution_id = ? ORDER BY c.name`,
      )
      .all(req.user.institution_id);
    const shops = institutionShops(req).filter((s) => !campusId || s.campus_id === campusId);
    res.json({
      institution: db.prepare('SELECT name FROM institutions WHERE id = ?').get(req.user.institution_id).name,
      days,
      campuses,
      students: campuses.filter((c) => !campusId || c.id === campusId).reduce((n, c) => n + c.students, 0),
      ...stats(
        shops.map((s) => s.id),
        days,
      ),
      shops: shops.map((s) => ({
        id: s.id,
        name: s.name,
        emoji: s.emoji,
        campus_name: s.campus_name,
        description: s.description,
        location: s.location,
        status: s.status,
        paused: !!s.paused,
        products: db.prepare('SELECT COUNT(*) AS c FROM products WHERE shop_id = ? AND deleted = 0').get(s.id).c,
        contact: db.prepare("SELECT email FROM users WHERE shop_id = ? AND role = 'shop' ORDER BY id LIMIT 1").get(s.id)?.email ?? null,
        totals: stats([s.id], days).totals,
      })),
    });
  });

  app.post('/api/admin/shops/:id/status', adminOnly, (req, res) => {
    const shop = institutionShops(req).find((s) => s.id === Number(req.params.id));
    if (!shop) fail(404, 'No encontramos ese local.');
    const status = req.body?.status;
    if (status !== 'activo' && status !== 'suspendido') fail(400, 'Ese estado no es válido.');
    db.prepare('UPDATE shops SET status = ? WHERE id = ?').run(status, shop.id);
    push?.toShop(shop.id, {
      title: BRAND,
      body: status === 'activo' ? `${shop.name} fue aprobado y ya aparece para los estudiantes.` : `${shop.name} fue suspendido por la institución.`,
      url: '/panel',
      tag: 'shop-status',
    });
    for (const u of db.prepare("SELECT email FROM users WHERE shop_id = ? AND role = 'shop' AND deleted_at IS NULL").all(shop.id))
      sendMail({
        to: u.email,
        subject: status === 'activo' ? `${shop.name} ya está activo en ${BRAND}` : `${shop.name} fue suspendido en ${BRAND}`,
        text:
          status === 'activo'
            ? `¡Listo! ${shop.name} fue aprobado y ya aparece para los estudiantes.\n\nEntra a tu panel: ${mail?.link('/panel')}\n\n${BRAND}`
            : `${shop.name} fue suspendido por la institución y dejó de aparecer para los estudiantes. Contacta a su administración para más información.\n\n${BRAND}`,
      });
    res.json({ ok: true, status });
  });

  const operatorOf = (v, city) => {
    if (v === undefined || v === null || v === '') return operatorForCity(city);
    if (!OPERATORS.includes(v)) fail(400, 'El operador de la beca Junaeb no es válido.');
    return v;
  };

  app.post('/api/admin/campuses', adminOnly, (req, res) => {
    const name = str(req.body?.name, 60, 'El nombre de la sede');
    const city = str(req.body?.city, 60, 'La ciudad');
    const operator = operatorOf(req.body?.baes_operator, city);
    const dup = db
      .prepare('SELECT 1 FROM campuses WHERE institution_id = ? AND lower(name) = lower(?)')
      .get(req.user.institution_id, name);
    if (dup) fail(409, 'Ya existe una sede con ese nombre.');
    const id = db
      .prepare('INSERT INTO campuses (institution_id, name, city, baes_operator) VALUES (?,?,?,?)')
      .run(req.user.institution_id, name, city, operator).lastInsertRowid;
    res.status(201).json({ id, name, city, baes_operator: operator });
  });

  // Junaeb puede cambiar de operador en una región (pasó en la Región Metropolitana en 2025).
  app.patch('/api/admin/campuses/:id', adminOnly, (req, res) => {
    const c = db
      .prepare('SELECT * FROM campuses WHERE id = ? AND institution_id = ?')
      .get(Number(req.params.id), req.user.institution_id);
    if (!c) fail(404, 'No encontramos esa sede.');
    const operator = operatorOf(req.body?.baes_operator, c.city);
    db.prepare('UPDATE campuses SET baes_operator = ? WHERE id = ?').run(operator, c.id);
    res.json({ id: c.id, name: c.name, city: c.city, baes_operator: operator });
  });

  // ---------- liquidaciones: lo que la plataforma le transfiere a cada local ----------
  // Pagado en la app: se liquida lo entregado y lo no retirado (el local lo preparó), al precio completo menos la
  // comisión; lo cancelado ya fue reembolsado. Pagado al retirar con descuento de la plataforma: el estudiante pagó
  // menos en el mesón, así que la plataforma le abona al local la diferencia.
  const SETTLED = `((o.payment_method = 'app' AND o.payment_status = 'aprobado' AND o.status IN ('entregado','no_retirado'))
                    OR (o.payment_method != 'app' AND o.status = 'entregado' AND o.funded_discount > 0))`;
  const PAYABLE = `${SETTLED} AND o.settlement_id IS NULL`;
  const PAYOUT = `CASE WHEN o.payment_method = 'app' THEN o.total + o.funded_discount - o.fee ELSE o.funded_discount END`;
  const pendingFor = (shopId) =>
    db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.payment_method = 'app' THEN o.total ELSE 0 END), 0) AS gross,
                COALESCE(SUM(o.fee), 0) AS fee,
                COALESCE(SUM(o.funded_discount), 0) AS discounts,
                COALESCE(SUM(${PAYOUT}), 0) AS amount
         FROM orders o WHERE o.shop_id = ? AND ${PAYABLE}`,
      )
      .get(shopId);
  const SETTLEMENT_SELECT = `SELECT st.*, s.name AS shop_name FROM settlements st JOIN shops s ON s.id = st.shop_id`;
  /** Pedidos pagados en la app que todavía no se entregan: se liquidan cuando se cierren. */
  const inProgressFor = (shopId) =>
    db
      .prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS gross FROM orders WHERE shop_id = ? AND payment_status = 'aprobado' AND status IN ${ACTIVE}`)
      .get(shopId);

  app.get('/api/shop/payouts', shopOnly, (req, res) => {
    res.json({
      enabled: !!payments,
      commission_bps: commissionBps(),
      pending: pendingFor(req.user.shop_id),
      in_progress: inProgressFor(req.user.shop_id),
      settlements: db.prepare(`${SETTLEMENT_SELECT} WHERE st.shop_id = ? ORDER BY st.id DESC LIMIT 24`).all(req.user.shop_id),
    });
  });

  app.get('/api/owner/payments', ownerOnly, (_req, res) => {
    const shops = db
      .prepare(
        `SELECT s.id, s.name, s.emoji, s.status, c.name AS campus_name, i.name AS institution
         FROM shops s JOIN campuses c ON c.id = s.campus_id JOIN institutions i ON i.id = c.institution_id
         ORDER BY i.name, s.name`,
      )
      .all()
      .map((s) => ({ ...s, pending: pendingFor(s.id), in_progress: inProgressFor(s.id) }));
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN o.payment_method = 'app' THEN o.total ELSE 0 END), 0) AS gross,
                COALESCE(SUM(o.fee), 0) AS fee,
                COALESCE(SUM(o.payment_method = 'app'), 0) AS orders,
                COALESCE(SUM(o.funded_discount), 0) AS discounts
         FROM orders o WHERE ${SETTLED}`,
      )
      .get();
    totals.net = totals.fee - totals.discounts;
    res.json({
      mode: payments?.mode ?? null,
      commission_bps: commissionBps(),
      totals,
      shops,
      settlements: db.prepare(`${SETTLEMENT_SELECT} ORDER BY st.id DESC LIMIT 30`).all(),
      failed_refunds: db.prepare(`${ORDER_SELECT} WHERE o.payment_status = 'reembolso_fallido' ORDER BY o.id DESC`).all().map(orderOut),
    });
  });

  app.patch('/api/owner/settings', ownerOnly, (req, res) => {
    const bps = int(req.body?.commission_bps, 0, 5000, 'La comisión');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('commission_bps', ?)").run(String(bps));
    // La comisión nueva se aplica a los pedidos que se paguen desde ahora; los ya pagados conservan la suya.
    res.json({ commission_bps: bps });
  });

  app.post('/api/owner/settlements', ownerOnly, (req, res) => {
    const shop = getShop(int(req.body?.shopId, 1, 1e9, 'El local'));
    const reference = str(req.body?.reference, 80, 'La referencia', { required: false });
    db.exec('BEGIN IMMEDIATE');
    let id;
    try {
      const p = pendingFor(shop.id);
      if (p.orders === 0) fail(409, `${shop.name} no tiene montos por liquidar.`);
      id = db
        .prepare('INSERT INTO settlements (shop_id, orders, gross, fee, discounts, amount, reference, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(shop.id, p.orders, p.gross, p.fee, p.discounts, p.amount, reference, now().toISOString()).lastInsertRowid;
      db.prepare(`UPDATE orders AS o SET settlement_id = ? WHERE o.shop_id = ? AND ${PAYABLE}`).run(id, shop.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json(db.prepare(`${SETTLEMENT_SELECT} WHERE st.id = ?`).get(id));
  });

  // Detalle de una liquidación, para enviarlo al local junto con la transferencia.
  const settlementCsv = (st) => {
    const rows = db.prepare(`${ORDER_SELECT} WHERE o.settlement_id = ? ORDER BY o.slot`).all(st.id);
    const cell = (v) => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
    const PAID = { app: 'En la app', local: 'En el local', junaeb: 'Junaeb en el local' };
    const lines = [
      ['Fecha', 'Código', 'Estado', 'Pago', 'Cobrado en la app (CLP)', 'Comisión (CLP)', `Descuento ${BRAND} (CLP)`, 'Para el local (CLP)'],
      ...rows.map((o) => {
        const app = o.payment_method === 'app';
        return [
          o.slot.slice(0, 10),
          o.code,
          o.status === 'entregado' ? 'Entregado' : 'No retirado',
          PAID[o.payment_method] ?? o.payment_method,
          app ? o.total : 0,
          o.fee,
          o.funded_discount,
          app ? o.total + o.funded_discount - o.fee : o.funded_discount,
        ];
      }),
      ['Total', '', '', '', st.gross, st.fee, st.discounts, st.amount],
    ];
    return '\ufeff' + lines.map((l) => l.map(cell).join(';')).join('\r\n');
  };
  const sendSettlement = (res, st) => {
    if (!st) fail(404, 'No encontramos esa liquidación.');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${SLUG}-liquidacion-${st.id}-${st.created_at.slice(0, 10)}.csv"`,
    });
    res.send(settlementCsv(st));
  };
  app.get('/api/owner/settlements/:id.csv', ownerOnly, (req, res) => {
    sendSettlement(res, db.prepare('SELECT * FROM settlements WHERE id = ?').get(Number(req.params.id)));
  });
  app.get('/api/shop/settlements/:id.csv', shopOnly, (req, res) => {
    sendSettlement(res, db.prepare('SELECT * FROM settlements WHERE id = ? AND shop_id = ?').get(Number(req.params.id), req.user.shop_id));
  });

  // Reembolsos que el proveedor rechazó: reintentar, o marcarlos resueltos si se devolvió por otra vía.
  app.post('/api/owner/orders/:id/refund', ownerOnly, async (req, res) => {
    const o = getOrder(Number(req.params.id));
    if (!o || o.payment_status !== 'reembolso_fallido') fail(404, 'Ese pedido no tiene un reembolso pendiente.');
    if (req.body?.manual) {
      db.prepare("UPDATE orders SET payment_status = 'reembolsado' WHERE id = ?").run(o.id);
      return res.json(getOrder(o.id));
    }
    db.prepare("UPDATE orders SET payment_status = 'aprobado' WHERE id = ?").run(o.id);
    const after = await refund(getOrder(o.id));
    if (after.payment_status !== 'reembolsado') fail(502, 'El servicio de pago volvió a rechazar el reembolso.');
    res.json(after);
  });

  // ---------- plataforma: descuentos y calidad de cada local ----------
  // Las promociones y la tarjeta de sellos son decisiones comerciales de la plataforma, y las paga ella con su
  // comisión. El local sigue a cargo de su operación: menú, horarios, cupos y aceptar pedidos.
  app.get('/api/owner/shops', ownerOnly, (_req, res) => {
    const from = addDays(chileNow(now()).date, -29);
    const shops = db
      .prepare(
        `SELECT s.id, s.name, s.emoji, s.status, s.paused, s.promos, s.loyalty_every, s.loyalty_max, c.name AS campus_name, i.name AS institution
         FROM shops s JOIN campuses c ON c.id = s.campus_id JOIN institutions i ON i.id = c.institution_id
         ORDER BY i.name, s.name`,
      )
      .all()
      .map((s) => {
        const money30 = db
          .prepare(
            `SELECT COALESCE(SUM(o.fee), 0) AS fee, COALESCE(SUM(o.funded_discount), 0) AS discounts
             FROM orders o WHERE o.shop_id = ? AND ${SETTLED} AND substr(o.slot, 1, 10) >= ?`,
          )
          .get(s.id, from);
        return { ...s, paused: !!s.paused, promos: parseJson(s.promos), totals: stats([s.id], 30).totals, ...money30 };
      });
    res.json({ commission_bps: commissionBps(), shops });
  });

  app.patch('/api/owner/shops/:id', ownerOnly, (req, res) => {
    const s = getShop(Number(req.params.id));
    const b = req.body ?? {};
    const promos = b.promos !== undefined ? JSON.stringify(promosOf(b.promos)) : s.promos;
    const every = b.loyalty_every !== undefined ? (b.loyalty_every ? int(b.loyalty_every, 2, 30, 'Los sellos para un premio') : 0) : s.loyalty_every;
    const max = b.loyalty_max !== undefined ? int(b.loyalty_max, 0, 100_000, 'El valor máximo del premio') : s.loyalty_max;
    if (every && max < 1) fail(400, 'Indica el valor máximo del producto de regalo.');
    db.prepare('UPDATE shops SET promos = ?, loyalty_every = ?, loyalty_max = ? WHERE id = ?').run(promos, every, max, s.id);
    const fresh = getShop(s.id);
    res.json({ id: fresh.id, promos: parseJson(fresh.promos), loyalty_every: fresh.loyalty_every, loyalty_max: fresh.loyalty_max });
  });

  // ---------- plataforma: quien opera la app crea instituciones y sus cuentas de administración ----------
  const tempPassword = () => crypto.randomBytes(9).toString('base64url');

  app.get('/api/owner/overview', ownerOnly, (_req, res) => {
    const institutions = db.prepare('SELECT id, name FROM institutions ORDER BY name').all().map((i) => ({
      ...i,
      campuses: db.prepare('SELECT id, name, city FROM campuses WHERE institution_id = ? ORDER BY name').all(i.id),
      admins: db
        .prepare("SELECT id, name, email FROM users WHERE role = 'admin' AND institution_id = ? AND deleted_at IS NULL ORDER BY id")
        .all(i.id),
      shops: db
        .prepare("SELECT COUNT(*) AS c FROM shops s JOIN campuses c ON c.id = s.campus_id WHERE c.institution_id = ? AND s.status = 'activo'")
        .get(i.id).c,
      students: db
        .prepare("SELECT COUNT(*) AS c FROM users u JOIN campuses c ON c.id = u.campus_id WHERE c.institution_id = ? AND u.role = 'student' AND u.deleted_at IS NULL")
        .get(i.id).c,
      orders: db
        .prepare('SELECT COUNT(*) AS c FROM orders o JOIN shops s ON s.id = o.shop_id JOIN campuses c ON c.id = s.campus_id WHERE c.institution_id = ?')
        .get(i.id).c,
    }));
    res.json({ institutions });
  });

  const createAdmin = (institutionId, institutionName, rawEmail) => {
    const email = emailOf(rawEmail);
    emailFree(email);
    const password = tempPassword();
    db.prepare(
      `INSERT INTO users (name, email, pass_hash, role, institution_id, created_at) VALUES (?,?,?,'admin',?,?)`,
    ).run(`Administración ${institutionName}`, email, hashPassword(password), institutionId, now().toISOString());
    return { email, password };
  };

  app.post('/api/owner/institutions', ownerOnly, (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 80, 'El nombre de la institución');
    const campus = str(b.campus, 60, 'El nombre de la sede');
    const city = str(b.city, 60, 'La ciudad');
    if (db.prepare('SELECT 1 FROM institutions WHERE lower(name) = lower(?)').get(name))
      fail(409, 'Ya existe una institución con ese nombre.');
    db.exec('BEGIN');
    let out;
    try {
      const id = db.prepare('INSERT INTO institutions (name) VALUES (?)').run(name).lastInsertRowid;
      db.prepare('INSERT INTO campuses (institution_id, name, city, baes_operator) VALUES (?,?,?,?)').run(id, campus, city, operatorForCity(city));
      out = { id, name, admin: createAdmin(id, name, b.adminEmail) };
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    // La contraseña temporal se muestra una sola vez: quien la recibe debe cambiarla al entrar.
    res.status(201).json(out);
  });

  app.post('/api/owner/institutions/:id/admins', ownerOnly, (req, res) => {
    const inst = db.prepare('SELECT id, name FROM institutions WHERE id = ?').get(Number(req.params.id));
    if (!inst) fail(404, 'No encontramos esa institución.');
    res.status(201).json(createAdmin(inst.id, inst.name, req.body?.email));
  });

  // Mientras no haya envío de correos, así se recupera el acceso de alguien que olvidó su contraseña.
  app.post('/api/owner/reset-password', ownerOnly, (req, res) => {
    const email = emailOf(req.body?.email);
    const u = db.prepare("SELECT id, role FROM users WHERE email = ? AND deleted_at IS NULL").get(email);
    if (!u) fail(404, 'No hay una cuenta con ese correo.');
    if (u.role === 'owner') fail(403, 'La contraseña de la plataforma se cambia desde su propia cuenta.');
    const password = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
    destroyUserSessions(db, u.id);
    limiter.clear(`login|${email}`);
    res.json({ email, password });
  });

  // ---------- app web compilada ----------
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, file) {
          // Los archivos con hash en el nombre no cambian nunca; el resto se revalida siempre.
          res.setHeader(
            'Cache-Control',
            file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Algo falló en el servidor. Intenta de nuevo.' : err.message, ...(status < 500 && err.data) });
  });

  return app;
}
