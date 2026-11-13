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
import { addDays, buildSlots, chileNow, chileStamp, isOpenNow } from './time.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

const RANK = { recibido: 0, preparando: 1, listo: 2, entregado: 3 };
const ACTIVE = "('recibido','preparando','listo')";
const PAYMENTS = ['tarjeta', 'junaeb', 'efectivo'];
const MAX_ACTIVE_ORDERS = 5;
const NO_SHOW_LIMIT = 2; // con este número de pedidos no retirados en 30 días se exige pago anticipado
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
  { demo = true, now = () => new Date(), distDir = null, push = null, ipLimit = 6000, authIpLimit = 300 } = {},
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

  const startSession = (req, res, userId) => {
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, userId), isSecure(req)));
  };

  const cashAllowed = (userId) => {
    const from = addDays(chileNow(now()).date, -30);
    const n = db
      .prepare("SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'no_retirado' AND slot >= ?")
      .get(userId, from).c;
    return n < NO_SHOW_LIMIT;
  };

  const userOut = (id) => {
    const u = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.campus_id, u.shop_id, u.institution_id,
                c.name AS campus_name, COALESCE(i.name, ai.name) AS institution,
                s.name AS shop_name, s.status AS shop_status
         FROM users u
         LEFT JOIN campuses c ON c.id = u.campus_id
         LEFT JOIN institutions i ON i.id = c.institution_id
         LEFT JOIN institutions ai ON ai.id = u.institution_id
         LEFT JOIN shops s ON s.id = u.shop_id
         WHERE u.id = ?`,
      )
      .get(id);
    if (u.role === 'student') u.cash_allowed = cashAllowed(id);
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
      is_open: isOpenNow(s, now()),
      next_slot: next ? { slot: next.slot, day: next.day, time: next.time } : null,
      rating: r.n ? Math.round(r.avg * 10) / 10 : null,
      ratings: r.n,
    };
  };

  const getShop = (id) => db.prepare('SELECT * FROM shops WHERE id = ?').get(id) ?? fail(404, 'No encontramos ese local.');
  /** Local visible para quien consulta: activo, o el propio aunque esté pendiente. */
  const visibleShop = (req, id) => {
    const shop = getShop(id);
    if (shop.status !== 'activo' && req.user.shop_id !== shop.id) fail(404, 'No encontramos ese local.');
    return shop;
  };

  const ORDER_SELECT = `
    SELECT o.*, s.name AS shop_name, s.emoji AS shop_emoji, s.location AS shop_location, u.name AS customer_name
    FROM orders o JOIN shops s ON s.id = o.shop_id JOIN users u ON u.id = o.user_id`;

  const orderOut = (o) => ({
    ...o,
    paid: !!o.paid,
    on_time: o.on_time === null ? null : !!o.on_time,
    items: db
      .prepare('SELECT product_id, name, emoji, price, qty FROM order_items WHERE order_id = ? ORDER BY id')
      .all(o.id),
    events: db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id),
  });

  const getOrder = (id) => {
    const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
    return o ? orderOut(o) : null;
  };

  const STUDENT_PUSH = {
    preparando: (o) => `${o.shop_name} está preparando tu pedido.`,
    listo: (o) => `Tu pedido ${o.code} está listo. Pasa a retirarlo en ${o.shop_name}.`,
    cancelado: (o) => `Tu pedido ${o.code} en ${o.shop_name} fue cancelado.`,
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
    hub.send(`shop:${fresh.shop_id}`, 'order', { type: 'update', order: fresh });
    if (push) {
      if (by === 'shop' && STUDENT_PUSH[status])
        push.toUser(fresh.user_id, {
          title: status === 'listo' ? '¡Tu pedido está listo!' : 'Pick&Go',
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
      let code = 'PG';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) return code;
    }
    return `PG${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
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
    const where = `o.shop_id IN (${marks}) AND substr(o.slot, 1, 10) BETWEEN ? AND ?`;
    const args = [...shopIds, from, today];
    const t = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(o.status = 'entregado'), 0) AS delivered,
                COALESCE(SUM(CASE WHEN o.status = 'entregado' THEN o.total ELSE 0 END), 0) AS sales,
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
                  COALESCE(SUM(CASE WHEN o.status = 'entregado' THEN o.total ELSE 0 END), 0) AS sales
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
    res.json({ demo, push_key: push?.publicKey ?? null });
  });

  app.get('/api/campuses', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT c.id, c.name, c.city, i.name AS institution,
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
    res.json(userOut(req.user.id));
  });

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
    res.setHeader('Content-Disposition', 'attachment; filename="mis-datos-pickgo.json"');
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
    if (req.user.role === 'admin') fail(403, 'Tu cuenta no tiene acceso a esta sección.');
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
      .prepare(
        `SELECT id, shop_id, category, name, description, price, emoji, available
         FROM products WHERE shop_id = ? AND deleted = 0 ORDER BY id`,
      )
      .all(shop.id)
      .map((p) => ({ ...p, available: !!p.available }));
    res.json({ shop: shopOut(shop), products });
  });

  app.get('/api/shops/:id/slots', auth, (req, res) => {
    const shop = visibleShop(req, Number(req.params.id));
    res.json(shop.status === 'activo' ? buildSlots(shop, now(), slotCounts(shop.id)) : []);
  });

  // Búsqueda de productos en los locales activos de una sede, sin distinguir tildes ni mayúsculas.
  const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  app.get('/api/campuses/:id/search', auth, (req, res) => {
    const q = plain(String(req.query.q ?? '').trim().slice(0, 40));
    if (q.length < 2) return res.json([]);
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.description, p.price, p.emoji, p.category, s.id AS shop_id, s.name AS shop_name
         FROM products p JOIN shops s ON s.id = p.shop_id
         WHERE s.campus_id = ? AND s.status = 'activo' AND p.deleted = 0 AND p.available = 1`,
      )
      .all(Number(req.params.id));
    res.json(rows.filter((r) => plain(`${r.name} ${r.category} ${r.description}`).includes(q)).slice(0, 20));
  });

  // ---------- estudiante: pedidos ----------
  app.post('/api/orders', student, (req, res) => {
    const b = req.body ?? {};
    const shop = getShop(int(b.shopId, 1, 1e9, 'El local'));
    if (shop.status !== 'activo') fail(404, 'No encontramos ese local.');
    if (shop.paused) fail(409, `${shop.name} no está recibiendo pedidos en este momento.`);
    if (!PAYMENTS.includes(b.paymentMethod)) fail(400, 'Elige un método de pago.');
    if (b.paymentMethod === 'efectivo' && !cashAllowed(req.user.id))
      fail(409, 'Tienes pedidos anteriores sin retirar, así que por ahora debes pagar al pedir. Elige tarjeta o JUNAEB.');
    const note = str(b.note, 200, 'La nota', { required: false });
    if (!Array.isArray(b.items) || b.items.length === 0) fail(400, 'Tu carrito está vacío.');
    if (b.items.length > 30) fail(400, 'El pedido tiene demasiados productos distintos.');

    // Los precios siempre se leen de la base: lo que mande el navegador no se usa para cobrar.
    const seen = new Set();
    const lines = b.items.map((it) => {
      const qty = int(it?.qty, 1, 20, 'La cantidad');
      const p = db
        .prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted = 0')
        .get(Number(it?.productId), shop.id);
      if (!p) fail(409, 'Un producto de tu carrito ya no existe. Revisa el menú.');
      if (seen.has(p.id)) fail(400, 'Hay un producto repetido en el pedido.');
      seen.add(p.id);
      if (!p.available) fail(409, `"${p.name}" se agotó. Quítalo del carrito para continuar.`);
      return { p, qty };
    });
    const total = lines.reduce((sum, l) => sum + l.p.price * l.qty, 0);

    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status IN ${ACTIVE}`)
      .get(req.user.id).c;
    if (active >= MAX_ACTIVE_ORDERS)
      fail(409, `Tienes ${active} pedidos en curso. Retira alguno antes de hacer otro.`);

    db.exec('BEGIN IMMEDIATE');
    let orderId;
    try {
      // El cupo se revisa dentro de la transacción para que dos pedidos no tomen el último lugar.
      const slot = buildSlots(shop, now(), slotCounts(shop.id)).find((s) => s.slot === b.slot);
      if (!slot) fail(409, 'Esa hora de retiro ya no está disponible. Elige otra.');
      if (slot.remaining <= 0) fail(409, `El retiro de las ${slot.time} se llenó. Elige otra hora.`);
      const at = now().toISOString();
      orderId = db
        .prepare(
          `INSERT INTO orders (code, user_id, shop_id, slot, status, payment_method, paid, total, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          newCode(),
          req.user.id,
          shop.id,
          slot.slot,
          'recibido',
          b.paymentMethod,
          b.paymentMethod === 'efectivo' ? 0 : 1, // pago simulado: tarjeta y JUNAEB quedan pagados al confirmar
          total,
          note,
          at,
        ).lastInsertRowid;
      const ins = db.prepare(
        'INSERT INTO order_items (order_id, product_id, name, emoji, price, qty) VALUES (?,?,?,?,?,?)',
      );
      for (const l of lines) ins.run(orderId, l.p.id, l.p.name, l.p.emoji, l.p.price, l.qty);
      db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?,?,?)').run(orderId, 'recibido', at);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    const order = getOrder(orderId);
    hub.send(`shop:${shop.id}`, 'order', { type: 'new', order });
    push?.toShop(shop.id, {
      title: `Nuevo pedido para las ${order.slot.slice(11)}`,
      body: `${order.customer_name}: ${order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`,
      url: '/panel',
      tag: `order-${order.id}`,
    });
    res.status(201).json(order);
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

  app.post('/api/orders/:id/cancel', student, (req, res) => {
    const o = myOrder(req);
    if (o.status !== 'recibido') fail(409, 'El local ya empezó a preparar tu pedido, así que no se puede cancelar.');
    res.json(setStatus(o, 'cancelado', { paid: false, by: 'student' }));
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

  app.patch('/api/shop/me', shopOnly, (req, res) => {
    const s = myShop(req);
    const b = req.body ?? {};
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
    };
    if (next.closes <= next.opens) fail(400, 'La hora de cierre debe ser posterior a la de apertura.');
    db.prepare(
      `UPDATE shops SET name=?, description=?, location=?, emoji=?, opens=?, closes=?, prep_minutes=?, slot_capacity=?, paused=?
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
      s.id,
    );
    res.json(shopOut(getShop(s.id)));
  });

  app.get('/api/shop/orders', shopOnly, (req, res) => {
    const today = chileNow(now()).date;
    const rows = db
      .prepare(
        `${ORDER_SELECT} WHERE o.shop_id = ? AND (o.slot >= ? OR o.status IN ${ACTIVE})
         ORDER BY o.slot, o.id`,
      )
      .all(req.user.shop_id, today);
    res.json({ today, orders: rows.map(orderOut) });
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
    if (!o || o.shop_id !== req.user.shop_id) fail(404, 'No encontramos ese pedido.');
    return o;
  };

  app.post('/api/shop/orders/:id/status', shopOnly, (req, res) => {
    const o = shopOrder(req, Number(req.params.id));
    const status = req.body?.status;
    if (!(o.status in RANK) || o.status === 'entregado') fail(409, 'Ese pedido ya está cerrado.');
    if (status === 'cancelado') return res.json(setStatus(o, 'cancelado', { paid: false }));
    if (status === 'no_retirado') {
      if (o.status !== 'listo') fail(409, 'Solo un pedido listo se puede marcar como no retirado.');
      if (chileStamp(now()) <= o.slot) fail(409, 'Todavía no pasa la hora de retiro de este pedido.');
      return res.json(setStatus(o, 'no_retirado'));
    }
    if (!(status in RANK) || RANK[status] <= RANK[o.status]) fail(400, 'Ese cambio de estado no es válido.');
    // Al entregar, el efectivo queda cobrado en caja.
    res.json(setStatus(o, status, status === 'entregado' ? { paid: true } : {}));
  });

  app.post('/api/shop/pickup', shopOnly, (req, res) => {
    const code = str(req.body?.code, 12, 'El código').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Tope de intentos: nadie puede probar códigos al azar desde una cuenta de local.
    if (limiter.hit(`pickup|${req.user.shop_id}`, 40, 60000)) fail(429, 'Demasiados intentos. Espera un momento.');
    const row = db.prepare('SELECT id FROM orders WHERE code = ? AND shop_id = ?').get(code, req.user.shop_id);
    if (!row) fail(404, `No hay un pedido con el código ${code} en este local.`);
    const o = getOrder(row.id);
    if (o.status === 'entregado') fail(409, `El pedido ${code} ya fue entregado.`);
    if (!(o.status in RANK)) fail(409, `El pedido ${code} está cerrado y no se puede entregar.`);
    res.json(setStatus(o, 'entregado', { paid: true }));
  });

  // menú del local
  const productBody = (b, base = {}) => {
    const p = {
      category: b.category !== undefined ? str(b.category, 30, 'La categoría') : base.category,
      name: b.name !== undefined ? str(b.name, 60, 'El nombre') : base.name,
      description:
        b.description !== undefined ? str(b.description, 120, 'La descripción', { required: false }) : base.description ?? '',
      price: b.price !== undefined ? int(b.price, 0, 1_000_000, 'El precio') : base.price,
      emoji: b.emoji !== undefined ? str(b.emoji, 8, 'El ícono') : base.emoji ?? '🍽️',
      available: b.available !== undefined ? (b.available ? 1 : 0) : base.available ?? 1,
    };
    if (p.category === undefined || p.name === undefined || p.price === undefined)
      fail(400, 'El producto necesita categoría, nombre y precio.');
    return p;
  };
  const productOut = (id) => {
    const p = db
      .prepare('SELECT id, shop_id, category, name, description, price, emoji, available FROM products WHERE id = ?')
      .get(id);
    return { ...p, available: !!p.available };
  };
  const myProduct = (req) =>
    db
      .prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted = 0')
      .get(Number(req.params.id), req.user.shop_id) ?? fail(404, 'No encontramos ese producto.');

  app.post('/api/shop/products', shopOnly, (req, res) => {
    const p = productBody(req.body ?? {});
    const count = db.prepare('SELECT COUNT(*) AS c FROM products WHERE shop_id = ? AND deleted = 0').get(req.user.shop_id).c;
    if (count >= 300) fail(409, 'Llegaste al máximo de 300 productos en el menú.');
    const id = db
      .prepare('INSERT INTO products (shop_id, category, name, description, price, emoji, available) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.shop_id, p.category, p.name, p.description, p.price, p.emoji, p.available).lastInsertRowid;
    res.status(201).json(productOut(id));
  });

  app.patch('/api/shop/products/:id', shopOnly, (req, res) => {
    const current = myProduct(req);
    const p = productBody(req.body ?? {}, current);
    db.prepare('UPDATE products SET category=?, name=?, description=?, price=?, emoji=?, available=? WHERE id=?').run(
      p.category,
      p.name,
      p.description,
      p.price,
      p.emoji,
      p.available,
      current.id,
    );
    res.json(productOut(current.id));
  });

  app.delete('/api/shop/products/:id', shopOnly, (req, res) => {
    // Borrado lógico: los pedidos antiguos siguen apuntando al producto.
    db.prepare('UPDATE products SET deleted = 1 WHERE id = ?').run(myProduct(req).id);
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
        `SELECT c.id, c.name, c.city,
                (SELECT COUNT(*) FROM users u WHERE u.campus_id = c.id AND u.role = 'student' AND u.deleted_at IS NULL) AS students
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
      title: 'Pick&Go',
      body: status === 'activo' ? `${shop.name} fue aprobado y ya aparece para los estudiantes.` : `${shop.name} fue suspendido por la institución.`,
      url: '/panel',
      tag: 'shop-status',
    });
    res.json({ ok: true, status });
  });

  app.post('/api/admin/campuses', adminOnly, (req, res) => {
    const name = str(req.body?.name, 60, 'El nombre de la sede');
    const city = str(req.body?.city, 60, 'La ciudad');
    const dup = db
      .prepare('SELECT 1 FROM campuses WHERE institution_id = ? AND lower(name) = lower(?)')
      .get(req.user.institution_id, name);
    if (dup) fail(409, 'Ya existe una sede con ese nombre.');
    const id = db
      .prepare('INSERT INTO campuses (institution_id, name, city) VALUES (?,?,?)')
      .run(req.user.institution_id, name, city).lastInsertRowid;
    res.status(201).json({ id, name, city });
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
    res.status(status).json({ error: status >= 500 ? 'Algo falló en el servidor. Intenta de nuevo.' : err.message });
  });

  return app;
}
