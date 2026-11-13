import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COOKIE,
  createSession,
  destroySession,
  hashPassword,
  readCookie,
  sessionCookie,
  userFromToken,
  verifyPassword,
} from './auth.js';
import { buildSlots, chileNow, isOpenNow } from './time.js';

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
const PAYMENTS = ['tarjeta', 'junaeb', 'efectivo'];
const MAX_ACTIVE_ORDERS = 5;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

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
      channels.get(key).add(res);
    },
    remove(key, res) {
      channels.get(key)?.delete(res);
    },
    send(key, event, data) {
      for (const res of channels.get(key) ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}

export function createApp(db, { demo = true, now = () => new Date(), distDir = null } = {}) {
  const app = express();
  const hub = createHub();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(express.json({ limit: '50kb' }));

  // ---------- helpers ----------
  const attempts = new Map();
  const limit = (max, windowMs) => (req, _res, next) => {
    const key = `${req.ip}|${req.path}`;
    const t = Date.now();
    const recent = (attempts.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) return next(new HttpError(429, 'Demasiados intentos. Espera unos minutos.'));
    recent.push(t);
    attempts.set(key, recent);
    next();
  };

  const auth = (req, _res, next) => {
    req.user = userFromToken(db, readCookie(req, COOKIE));
    if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar.'));
    next();
  };
  const role = (r) => (req, _res, next) => {
    if (req.user.role !== r) return next(new HttpError(403, 'Tu cuenta no tiene acceso a esta sección.'));
    next();
  };
  const student = [auth, role('student')];
  const shopOnly = [auth, role('shop')];

  const startSession = (req, res, userId) => {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', sessionCookie(createSession(db, userId), secure));
  };

  const userOut = (id) => {
    const u = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.campus_id, u.shop_id,
                c.name AS campus_name, i.name AS institution, s.name AS shop_name
         FROM users u
         LEFT JOIN campuses c ON c.id = u.campus_id
         LEFT JOIN institutions i ON i.id = c.institution_id
         LEFT JOIN shops s ON s.id = u.shop_id
         WHERE u.id = ?`,
      )
      .get(id);
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
    const next = buildSlots(s, now(), slotCounts(s.id)).find((x) => x.remaining > 0);
    return {
      ...s,
      paused: !!s.paused,
      is_open: isOpenNow(s, now()),
      next_slot: next ? { slot: next.slot, day: next.day, time: next.time } : null,
    };
  };

  const getShop = (id) => db.prepare('SELECT * FROM shops WHERE id = ?').get(id) ?? fail(404, 'No encontramos ese local.');

  const ORDER_SELECT = `
    SELECT o.*, s.name AS shop_name, s.emoji AS shop_emoji, s.location AS shop_location, u.name AS customer_name
    FROM orders o JOIN shops s ON s.id = o.shop_id JOIN users u ON u.id = o.user_id`;

  const orderOut = (o) => ({
    ...o,
    paid: !!o.paid,
    items: db
      .prepare('SELECT product_id, name, emoji, price, qty FROM order_items WHERE order_id = ? ORDER BY id')
      .all(o.id),
    events: db.prepare('SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id').all(o.id),
  });

  const getOrder = (id) => {
    const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
    return o ? orderOut(o) : null;
  };

  const setStatus = (order, status, extra = {}) => {
    const paid = extra.paid ?? order.paid;
    db.prepare('UPDATE orders SET status = ?, paid = ? WHERE id = ?').run(status, paid ? 1 : 0, order.id);
    db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?,?,?)').run(
      order.id,
      status,
      now().toISOString(),
    );
    const fresh = getOrder(order.id);
    hub.send(`user:${fresh.user_id}`, 'order', { type: 'update', order: fresh });
    hub.send(`shop:${fresh.shop_id}`, 'order', { type: 'update', order: fresh });
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
  const passwordOf = (v) => {
    if (typeof v !== 'string' || v.length < 8) fail(400, 'La contraseña debe tener al menos 8 caracteres.');
    if (v.length > 200) fail(400, 'La contraseña es demasiado larga.');
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

  // ---------- público ----------
  app.get('/api/config', (_req, res) => {
    res.json({ demo });
  });

  app.get('/api/campuses', (_req, res) => {
    res.json(
      db
        .prepare(
          `SELECT c.id, c.name, c.city, i.name AS institution,
                  (SELECT COUNT(*) FROM shops s WHERE s.campus_id = c.id) AS shops_count
           FROM campuses c JOIN institutions i ON i.id = c.institution_id
           ORDER BY i.name, c.name`,
        )
        .all(),
    );
  });

  // ---------- cuentas ----------
  const authLimit = limit(30, 10 * 60 * 1000);

  app.post('/api/auth/register', authLimit, (req, res) => {
    const b = req.body ?? {};
    const name = str(b.name, 60, 'Tu nombre');
    const email = emailOf(b.email);
    const password = passwordOf(b.password);
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
    const password = passwordOf(b.password);
    const campusId = campusOf(b.campusId);
    const shopName = str(b.shopName, 60, 'El nombre del local');
    const description = str(b.description, 120, 'La descripción', { required: false });
    const location = str(b.location, 80, 'La ubicación', { required: false });
    emailFree(email);
    db.exec('BEGIN');
    let id;
    try {
      const shopId = db
        .prepare('INSERT INTO shops (campus_id, name, description, location) VALUES (?,?,?,?)')
        .run(campusId, shopName, description, location).lastInsertRowid;
      id = db
        .prepare(
          'INSERT INTO users (name, email, pass_hash, role, campus_id, shop_id, created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(name, email, hashPassword(password), 'shop', campusId, shopId, now().toISOString()).lastInsertRowid;
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
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const u = db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email);
    if (!u || typeof b.password !== 'string' || !verifyPassword(b.password, u.pass_hash))
      fail(401, 'Correo o contraseña incorrectos.');
    startSession(req, res, u.id);
    res.json(userOut(u.id));
  });

  app.post('/api/auth/logout', (req, res) => {
    destroySession(db, readCookie(req, COOKIE));
    res.setHeader('Set-Cookie', sessionCookie(null, false));
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

  // ---------- eventos en vivo ----------
  app.get('/api/events', auth, (req, res) => {
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
    const shops = db.prepare('SELECT * FROM shops WHERE campus_id = ? ORDER BY name').all(Number(req.params.id));
    res.json(shops.map(shopOut));
  });

  app.get('/api/shops/:id', auth, (req, res) => {
    const shop = getShop(Number(req.params.id));
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
    const shop = getShop(Number(req.params.id));
    res.json(buildSlots(shop, now(), slotCounts(shop.id)));
  });

  // ---------- estudiante: pedidos ----------
  app.post('/api/orders', student, (req, res) => {
    const b = req.body ?? {};
    const shop = getShop(int(b.shopId, 1, 1e9, 'El local'));
    if (shop.paused) fail(409, `${shop.name} no está recibiendo pedidos en este momento.`);
    if (!PAYMENTS.includes(b.paymentMethod)) fail(400, 'Elige un método de pago.');
    const note = str(b.note, 200, 'La nota', { required: false });
    if (!Array.isArray(b.items) || b.items.length === 0) fail(400, 'Tu carrito está vacío.');
    if (b.items.length > 30) fail(400, 'El pedido tiene demasiados productos distintos.');

    // Los precios siempre se leen de la base: lo que mande el navegador no se usa para cobrar.
    const lines = b.items.map((it) => {
      const qty = int(it?.qty, 1, 20, 'La cantidad');
      const p = db
        .prepare('SELECT * FROM products WHERE id = ? AND shop_id = ? AND deleted = 0')
        .get(Number(it?.productId), shop.id);
      if (!p) fail(409, 'Un producto de tu carrito ya no existe. Revisa el menú.');
      if (!p.available) fail(409, `"${p.name}" se agotó. Quítalo del carrito para continuar.`);
      return { p, qty };
    });
    const total = lines.reduce((sum, l) => sum + l.p.price * l.qty, 0);

    const active = db
      .prepare(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status IN ('recibido','preparando','listo')`)
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
    res.status(201).json(order);
  });

  app.get('/api/orders', student, (req, res) => {
    const rows = db.prepare(`${ORDER_SELECT} WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50`).all(req.user.id);
    res.json(rows.map(orderOut));
  });

  app.get('/api/orders/:id', student, (req, res) => {
    const o = getOrder(Number(req.params.id));
    if (!o || o.user_id !== req.user.id) fail(404, 'No encontramos ese pedido.');
    res.json(o);
  });

  app.post('/api/orders/:id/cancel', student, (req, res) => {
    const o = getOrder(Number(req.params.id));
    if (!o || o.user_id !== req.user.id) fail(404, 'No encontramos ese pedido.');
    if (o.status !== 'recibido') fail(409, 'El local ya empezó a preparar tu pedido, así que no se puede cancelar.');
    res.json(setStatus(o, 'cancelado', { paid: false }));
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
        `${ORDER_SELECT} WHERE o.shop_id = ?
           AND (o.slot >= ? OR o.status IN ('recibido','preparando','listo'))
         ORDER BY o.slot, o.id`,
      )
      .all(req.user.shop_id, today);
    res.json({ today, orders: rows.map(orderOut) });
  });

  const shopOrder = (req, id) => {
    const o = getOrder(id);
    if (!o || o.shop_id !== req.user.shop_id) fail(404, 'No encontramos ese pedido.');
    return o;
  };

  app.post('/api/shop/orders/:id/status', shopOnly, (req, res) => {
    const o = shopOrder(req, Number(req.params.id));
    const status = req.body?.status;
    if (o.status === 'entregado' || o.status === 'cancelado') fail(409, 'Ese pedido ya está cerrado.');
    if (status === 'cancelado') return res.json(setStatus(o, 'cancelado', { paid: false }));
    if (!(status in RANK) || RANK[status] <= RANK[o.status]) fail(400, 'Ese cambio de estado no es válido.');
    // Al entregar, el efectivo queda cobrado en caja.
    res.json(setStatus(o, status, status === 'entregado' ? { paid: true } : {}));
  });

  app.post('/api/shop/pickup', shopOnly, (req, res) => {
    const code = str(req.body?.code, 12, 'El código').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = db.prepare('SELECT id FROM orders WHERE code = ? AND shop_id = ?').get(code, req.user.shop_id);
    if (!row) fail(404, `No hay un pedido con el código ${code} en este local.`);
    const o = getOrder(row.id);
    if (o.status === 'entregado') fail(409, `El pedido ${code} ya fue entregado.`);
    if (o.status === 'cancelado') fail(409, `El pedido ${code} fue cancelado.`);
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

  // ---------- app web compilada ----------
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Algo falló en el servidor. Intenta de nuevo.' : err.message });
  });

  return app;
}
