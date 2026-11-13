import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
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

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 3600_000).unref();

const port = Number(process.env.PORT ?? 3001);
createApp(db, { demo, distDir: path.join(root, 'dist'), push: createPush(db) }).listen(port, () => {
  console.log(`Pick&Go escuchando en http://localhost:${port}`);
});
