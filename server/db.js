import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BRAND } from './brand.js';
import { operatorForCity } from './baes.js';

export const SCHEMA_VERSION = 8;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campuses (
  id INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  baes_operator TEXT NOT NULL DEFAULT 'edenred' -- operador de la beca Junaeb en la sede: edenred | pluxee
);
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🍽️',
  location TEXT NOT NULL DEFAULT '',
  opens INTEGER NOT NULL DEFAULT 480,          -- minutos desde medianoche
  closes INTEGER NOT NULL DEFAULT 1200,
  prep_minutes INTEGER NOT NULL DEFAULT 10,    -- anticipación mínima para preparar
  slot_capacity INTEGER NOT NULL DEFAULT 6,    -- pedidos por franja de 10 minutos
  paused INTEGER NOT NULL DEFAULT 0,
  auto_accept INTEGER NOT NULL DEFAULT 0,      -- los pedidos nuevos pasan directo a preparación
  days TEXT NOT NULL DEFAULT '0123456',        -- días que atiende: 0 = domingo … 6 = sábado
  pay_at_shop INTEGER NOT NULL DEFAULT 0,      -- también acepta pedidos que se pagan al retirar
  accepts_baes INTEGER NOT NULL DEFAULT 0,     -- acepta la beca Junaeb (BAES) al retirar: está adherido al operador
  promos TEXT NOT NULL DEFAULT '[]',           -- descuentos por hora de retiro (JSON): [{from, to, percent}]
  loyalty_every INTEGER NOT NULL DEFAULT 0,    -- tarjeta de sellos: un premio cada N pedidos entregados (0 = apagada)
  loyalty_max INTEGER NOT NULL DEFAULT 0,      -- valor máximo del producto de regalo
  -- La institución aprueba cada local antes de que aparezca para los estudiantes.
  status TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL,                          -- student | shop | admin (institución) | owner (plataforma)
  campus_id INTEGER REFERENCES campuses(id),
  shop_id INTEGER REFERENCES shops(id),
  institution_id INTEGER REFERENCES institutions(id),  -- solo para administradores
  baes INTEGER NOT NULL DEFAULT 0,             -- el estudiante tiene beca Junaeb: se le propone pagar con ella
  breaks TEXT NOT NULL DEFAULT '[]',           -- recreos del estudiante (JSON): [{days, from, to}]
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,                      -- pesos chilenos, sin decimales
  emoji TEXT NOT NULL DEFAULT '',              -- ícono opcional
  image_id INTEGER REFERENCES images(id),      -- foto opcional
  options TEXT NOT NULL DEFAULT '[]',          -- grupos de opciones (JSON): tamaños, agregados, etc.
  prep_minutes INTEGER NOT NULL DEFAULT 0,     -- anticipación propia del producto (0 = la del local)
  available INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  orders INTEGER NOT NULL,
  gross INTEGER NOT NULL,                      -- cobrado a los estudiantes
  fee INTEGER NOT NULL,                        -- comisión de la plataforma
  amount INTEGER NOT NULL,                     -- transferido al local
  reference TEXT NOT NULL DEFAULT '',          -- número de transferencia u otra referencia
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  slot TEXT NOT NULL,                          -- hora de retiro, 'AAAA-MM-DDTHH:MM' hora de Chile
  status TEXT NOT NULL,                        -- recibido | preparando | listo | entregado | cancelado | no_retirado
  payment_method TEXT NOT NULL DEFAULT 'local', -- 'app' (pagado en la app), 'local' (se paga al retirar) o 'junaeb' (beca, al retirar)
  -- pago en la app: pendiente | aprobado | expirado | reembolsado | reembolso_fallido
  -- junaeb: '' hasta entregar; aprobado (cobrado con la beca) | otro_medio (la beca no pasó y pagó de otra forma)
  payment_status TEXT NOT NULL DEFAULT '',
  payment_ref TEXT NOT NULL DEFAULT '',        -- identificador del pago en el proveedor
  fee INTEGER NOT NULL DEFAULT 0,              -- comisión de la plataforma sobre este pedido
  settlement_id INTEGER REFERENCES settlements(id), -- liquidación en que se le pagó al local
  paid INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',      -- motivo que da el local al rechazar o cancelar
  subtotal INTEGER NOT NULL DEFAULT 0,         -- suma de los productos antes de descuentos
  promo_discount INTEGER NOT NULL DEFAULT 0,   -- descuento por promoción de horario
  reward_discount INTEGER NOT NULL DEFAULT 0,  -- descuento por premio de la tarjeta de sellos
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  rating_comment TEXT NOT NULL DEFAULT '',
  on_time INTEGER,                             -- 1 si estuvo listo a la hora de retiro o antes
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_shop_slot ON orders(shop_id, slot);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,                      -- precio unitario, con las opciones elegidas incluidas
  qty INTEGER NOT NULL,
  options TEXT NOT NULL DEFAULT '[]'           -- opciones elegidas (JSON), tal como estaban al pedir
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events(order_id);
`;

// Cambios de esquema posteriores a la versión 3, en orden. Cada entrada lleva la base de la versión N a la N+1
// sin perder datos (por ejemplo: 3: 'ALTER TABLE shops ADD COLUMN phone TEXT'), o es una función que recibe la base.
// Nunca se edita una entrada ya publicada.
const MIGRATIONS = {
  3: 'ALTER TABLE shops ADD COLUMN auto_accept INTEGER NOT NULL DEFAULT 0',
  4: `ALTER TABLE shops ADD COLUMN days TEXT NOT NULL DEFAULT '0123456';
      ALTER TABLE orders ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';
      CREATE TABLE password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL
      );`,
  5: `CREATE TABLE settlements (
        id INTEGER PRIMARY KEY,
        shop_id INTEGER NOT NULL REFERENCES shops(id),
        orders INTEGER NOT NULL,
        gross INTEGER NOT NULL,
        fee INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN payment_ref TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN fee INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN settlement_id INTEGER REFERENCES settlements(id);
      ALTER TABLE shops ADD COLUMN pay_at_shop INTEGER NOT NULL DEFAULT 1;`,
  6: `ALTER TABLE shops ADD COLUMN promos TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE shops ADD COLUMN loyalty_every INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shops ADD COLUMN loyalty_max INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE products ADD COLUMN prep_minutes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN promo_discount INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN reward_discount INTEGER NOT NULL DEFAULT 0;
      UPDATE orders SET subtotal = total;
      CREATE TABLE favorites (
        user_id INTEGER NOT NULL REFERENCES users(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, product_id)
      );`,
  7: (db) => {
    const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    db.exec(`ALTER TABLE shops ADD COLUMN accepts_baes INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE users ADD COLUMN baes INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE users ADD COLUMN breaks TEXT NOT NULL DEFAULT '[]';`);
    if (!has('campuses')) return;
    db.exec(`ALTER TABLE campuses ADD COLUMN baes_operator TEXT NOT NULL DEFAULT 'edenred'`);
    // El operador de cada sede existente se deduce de su ciudad; la institución lo puede corregir.
    const set = db.prepare('UPDATE campuses SET baes_operator = ? WHERE id = ?');
    for (const c of db.prepare('SELECT id, city FROM campuses').all()) set.run(operatorForCity(c.city), c.id);
  },
};
const FIRST_MIGRATABLE = 3;

/**
 * Archivo de la base: ALTIRO_DB o data/altiro.db. Si ese archivo todavía no existe pero junto a él está la base
 * de antes del cambio de nombre (pickgo.db), se sigue usando esa para no perder datos.
 */
export function dbFileFrom(env, root) {
  const file = env.ALTIRO_DB ?? path.join(root, 'data', 'altiro.db');
  const legacy = path.join(path.dirname(file), 'pickgo.db');
  if (path.basename(file) === 'altiro.db' && !fs.existsSync(file) && fs.existsSync(legacy)) return legacy;
  return file;
}

/**
 * Abre la base y aplica las migraciones pendientes. Si el archivo es anterior a la primera versión migrable
 * (solo existieron con datos de demostración) lanza un error con code 'OLD_DB'.
 */
export function openDb(file) {
  const db = new DatabaseSync(file);
  let version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasTables && (version < FIRST_MIGRATABLE || version > SCHEMA_VERSION)) {
    db.close();
    throw Object.assign(new Error(`La base de datos es de una versión incompatible de ${BRAND}.`), {
      code: 'OLD_DB',
    });
  }
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  if (!hasTables) {
    db.exec(SCHEMA);
    version = SCHEMA_VERSION;
  }
  for (; version < SCHEMA_VERSION; version++) {
    db.exec('BEGIN');
    try {
      const step = MIGRATIONS[version];
      if (typeof step === 'function') step(db);
      else db.exec(step);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
