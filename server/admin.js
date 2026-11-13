// Crea una institución (si no existe) y una cuenta de administración para ella.
// Uso: npm run crear-admin -- "Nombre de la institución" correo@institucion.cl
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';
import { openDb } from './db.js';

const [institution, emailArg] = process.argv.slice(2);
if (!institution || !emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
  console.error('Uso: npm run crear-admin -- "Nombre de la institución" correo@institucion.cl');
  process.exit(1);
}
const email = emailArg.toLowerCase();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.PICKGO_DB ?? path.join(root, 'data', 'pickgo.db');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = openDb(dbFile);

if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
  console.error(`Ya existe una cuenta con el correo ${email}.`);
  process.exit(1);
}
const found = db.prepare('SELECT id FROM institutions WHERE lower(name) = lower(?)').get(institution);
const institutionId = found?.id ?? db.prepare('INSERT INTO institutions (name) VALUES (?)').run(institution).lastInsertRowid;
const password = crypto.randomBytes(12).toString('base64url');
db.prepare(
  `INSERT INTO users (name, email, pass_hash, role, institution_id, created_at) VALUES (?,?,?,'admin',?,?)`,
).run(`Administración ${institution}`, email, hashPassword(password), institutionId, new Date().toISOString());

console.log(`${found ? 'Institución existente' : 'Institución creada'}: ${institution}`);
console.log(`Cuenta de administración: ${email}`);
console.log(`Contraseña temporal: ${password}`);
console.log('Cámbiala al ingresar, en Cuenta > Cambiar contraseña.');
