import crypto from 'node:crypto';

const SESSION_DAYS = 30;
export const COOKIE = 'pg_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// En la base solo se guarda el hash del token: una copia de la base no sirve para suplantar sesiones.
export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

export function destroyUserSessions(db, userId, exceptToken = null) {
  if (exceptToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha(exceptToken));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

export function userFromToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.campus_id, u.shop_id, u.institution_id, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.deleted_at IS NULL`,
    )
    .get(sha(token));
  if (!row || row.expires_at < new Date().toISOString()) return null;
  delete row.expires_at;
  return row;
}

// Contraseñas que aparecen en todas las listas de filtraciones: no se aceptan aunque cumplan el largo.
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña', 'contrasena', 'qwertyuiop',
  'qwerty123', '11111111', '00000000', 'abcd1234', 'iloveyou', 'pickgo123', 'altiro123', 'duocuc123', 'estudiante',
]);

/** Devuelve el motivo por el que la contraseña no sirve, o null si es aceptable. */
export function passwordProblem(password, email = '') {
  if (typeof password !== 'string' || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  if (COMMON.has(password.toLowerCase())) return 'Esa contraseña es muy común. Elige una más difícil de adivinar.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'La contraseña no puede ser igual a tu correo.';
  if (/^(.)\1+$/.test(password)) return 'La contraseña no puede ser un solo carácter repetido.';
  return null;
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
