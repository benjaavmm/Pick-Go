import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedIfEmpty } from './seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.PICKGO_DB ?? path.join(root, 'data', 'pickgo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

// PICKGO_DEMO=0 arranca sin datos ni cuentas de demostración.
const demo = process.env.PICKGO_DEMO !== '0';
const db = openDb(dbFile);
if (demo && seedIfEmpty(db)) console.log('Base de datos creada con datos de demostración.');

const port = Number(process.env.PORT ?? 3001);
createApp(db, { demo, distDir: path.join(root, 'dist') }).listen(port, () => {
  console.log(`Pick&Go escuchando en http://localhost:${port}`);
});
