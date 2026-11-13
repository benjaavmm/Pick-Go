import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { hashPassword, passwordProblem, purgeExpiredSessions } from './auth.js';
import { openDb } from './db.js';
import { createPush } from './push.js';
import { seedIfEmpty } from './seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.PICKGO_DB ?? path.join(root, 'data', 'pickgo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

function open() {
  try {
    return openDb(dbFile);
  } catch (e) {
    if (e.code !== 'PICKGO_OLD_DB') throw e;
    // Nunca se borra una base anterior: se aparta con otro nombre y se crea una nueva.
    const suffix = `.anterior-${Date.now()}`;
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(dbFile + ext)) fs.renameSync(dbFile + ext, dbFile + suffix + ext);
    console.warn(`La base de datos era de una versión anterior. Quedó guardada como ${path.basename(dbFile + suffix)} y se creó una nueva.`);
    return openDb(dbFile);
  }
}

// PICKGO_DEMO=0 arranca sin datos ni cuentas de demostración.
const demo = process.env.PICKGO_DEMO !== '0';
const db = open();
if (demo && seedIfEmpty(db)) console.log('Base de datos creada con datos de demostración.');

// Cuenta de quien opera la plataforma: se crea al arrancar a partir de dos variables de entorno.
const ownerEmail = process.env.PICKGO_OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.PICKGO_OWNER_PASSWORD;
if (ownerEmail && ownerPassword) {
  const problem = passwordProblem(ownerPassword, ownerEmail);
  if (problem) console.warn(`No se creó la cuenta de plataforma: ${problem}`);
  else if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(ownerEmail)) {
    db.prepare("INSERT INTO users (name, email, pass_hash, role, created_at) VALUES (?,?,?,'owner',?)").run(
      'Equipo Pick&Go',
      ownerEmail,
      hashPassword(ownerPassword),
      new Date().toISOString(),
    );
    console.log(`Cuenta de plataforma creada: ${ownerEmail}`);
  }
}

// Respaldo diario de la base, junto a ella. Se conservan los últimos 7.
const backupDir = path.join(path.dirname(dbFile), 'respaldos');
function backup() {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const target = path.join(backupDir, `pickgo-${new Date().toISOString().slice(0, 10)}.db`);
    if (fs.existsSync(target)) return;
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(backupDir).filter((f) => /^pickgo-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7);
    for (const f of old) fs.rmSync(path.join(backupDir, f));
  } catch (e) {
    console.warn('No se pudo respaldar la base de datos:', e.message);
  }
}
backup();
setInterval(backup, 6 * 3600_000).unref();

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 3600_000).unref();

const port = Number(process.env.PORT ?? 3001);
createApp(db, { demo, distDir: path.join(root, 'dist'), push: createPush(db) }).listen(port, () => {
  console.log(`Pick&Go escuchando en http://localhost:${port}`);
});
