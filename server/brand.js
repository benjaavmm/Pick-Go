/**
 * Nombre de la app en un solo lugar: correos, avisos, archivos descargados y registros del servidor.
 * La app web tiene su propia copia en src/brand.ts.
 */
export const BRAND = 'GoBite';
/** Prefijo de los códigos de retiro (seguido de 4 caracteres). */
export const CODE_PREFIX = 'GB';
/** Para nombres de archivo: minúsculas y sin espacios. */
export const SLUG = 'gobite';

/**
 * Las variables de entorno se llaman GOBITE_*. Las antiguas PICKGO_* se siguen aceptando para no romper
 * instalaciones existentes: si falta GOBITE_X y existe PICKGO_X, se usa esa y se avisa una vez en el registro.
 */
export function migrateEnv(env = process.env, warn = console.warn) {
  const old = Object.keys(env).filter((k) => k.startsWith('PICKGO_'));
  for (const key of old) {
    const next = `GOBITE_${key.slice('PICKGO_'.length)}`;
    if (env[next] === undefined) {
      env[next] = env[key];
      warn(`La variable ${key} está obsoleta: renómbrala a ${next}.`);
    }
  }
  return env;
}
