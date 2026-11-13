import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

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
  city TEXT NOT NULL
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
  -- La institución aprueba cada local antes de que aparezca para los estudiantes.
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','activo','suspendido')),
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','shop','admin')),
  campus_id INTEGER REFERENCES campuses(id),
  shop_id INTEGER REFERENCES shops(id),
  institution_id INTEGER REFERENCES institutions(id),  -- solo para administradores
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,                      -- pesos chilenos, sin decimales
  emoji TEXT NOT NULL DEFAULT '🍽️',
  available INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  shop_id INTEGER NOT NULL REFERENCES shops(id),
  slot TEXT NOT NULL,                          -- hora de retiro, 'AAAA-MM-DDTHH:MM' hora de Chile
  status TEXT NOT NULL CHECK (status IN ('recibido','preparando','listo','entregado','cancelado','no_retirado')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('tarjeta','junaeb','efectivo')),
  paid INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
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
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
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

/**
 * Abre la base. Si el archivo es de una versión anterior del esquema lanza un error
 * con code 'PICKGO_OLD_DB' para que quien llama decida qué hacer con esos datos.
 */
export function openDb(file) {
  const db = new DatabaseSync(file);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (hasTables && version !== SCHEMA_VERSION) {
    db.close();
    throw Object.assign(new Error('La base de datos es de una versión anterior de Pick&Go.'), {
      code: 'PICKGO_OLD_DB',
    });
  }
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
