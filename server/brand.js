/**
 * Nombre de la app en un solo lugar: correos, avisos, archivos descargados y registros del servidor.
 * La app web tiene su propia copia en src/brand.ts.
 */
export const BRAND = 'ToruGo';
/** Prefijo de los códigos de retiro (seguido de 4 caracteres). */
export const CODE_PREFIX = 'TG';
/** Para nombres de archivo: minúsculas y sin espacios. */
export const SLUG = 'torugo';

/** Prefijos de las variables de entorno de los nombres anteriores de la app, del más reciente al más antiguo. */
const LEGACY_PREFIXES = ['GOBITE_', 'PICKGO_'];

/**
 * Las variables de entorno se llaman TORUGO_*. Las de nombres anteriores (GOBITE_*, PICKGO_*) se siguen aceptando
 * para no romper instalaciones existentes: si falta TORUGO_X y existe una antigua, se usa esa y se avisa en el registro.
 */
export function migrateEnv(env = process.env, warn = console.warn) {
  for (const prefix of LEGACY_PREFIXES) {
    for (const key of Object.keys(env).filter((k) => k.startsWith(prefix))) {
      const next = `TORUGO_${key.slice(prefix.length)}`;
      if (env[next] === undefined) {
        env[next] = env[key];
        warn(`La variable ${key} está obsoleta: renómbrala a ${next}.`);
      }
    }
  }
  return env;
}
