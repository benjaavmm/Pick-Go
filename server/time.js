// Todas las horas de retiro se manejan en hora de Chile, sin importar dónde corra el servidor.
const TZ = 'America/Santiago';
export const SLOT_STEP = 10; // minutos por franja de retiro

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Fecha ('AAAA-MM-DD') y minutos desde medianoche en Chile. */
export function chileNow(now = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const ceilStep = (m) => Math.ceil(m / SLOT_STEP) * SLOT_STEP;

/**
 * Franjas de retiro de hoy para un local. Solo se pide para el mismo día: la app es para el recreo que viene, y
 * pedir de un día para otro sube los pedidos que nadie retira y deja el pago retenido toda la noche.
 * `counts` es un Map franja -> pedidos ya tomados; cada franja admite `slot_capacity` pedidos,
 * así la demanda del horario peak se reparte en vez de llegar toda junta.
 */
export function buildSlots(shop, now, counts = new Map()) {
  if (shop.paused) return [];
  const { date, minutes } = chileNow(now);
  const out = [];
  const days = shop.days ?? '0123456';
  const push = (day, dayLabel, from) => {
    // El local no atiende ese día de la semana.
    if (!days.includes(String(weekday(day)))) return;
    for (let m = ceilStep(from); m <= shop.closes; m += SLOT_STEP) {
      const slot = `${day}T${hhmm(m)}`;
      out.push({
        slot,
        day: dayLabel,
        time: hhmm(m),
        remaining: Math.max(0, shop.slot_capacity - (counts.get(slot) ?? 0)),
      });
    }
  };
  push(date, 'hoy', Math.max(shop.opens, minutes) + shop.prep_minutes);
  return out;
}

/**
 * Cuándo vuelve a recibir pedidos un local que hoy ya no tiene horas: el próximo día que atiende, a la hora en que
 * abre. Devuelve { date, time } o null si está en pausa (no se sabe cuándo vuelve).
 */
export function nextOpening(shop, now) {
  if (shop.paused) return null;
  const { date, minutes } = chileNow(now);
  const days = shop.days ?? '0123456';
  // Hoy, si todavía no abre (antes de la hora de apertura ya se puede pedir, así que esto es raro).
  if (days.includes(String(weekday(date))) && minutes < shop.opens) return { date, time: hhmm(shop.opens) };
  for (let i = 1; i <= 7; i++) {
    const day = addDays(date, i);
    if (days.includes(String(weekday(day)))) return { date: day, time: hhmm(shop.opens) };
  }
  return null;
}

/** Día de la semana de una fecha 'AAAA-MM-DD': 0 = domingo … 6 = sábado. */
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function isOpenNow(shop, now) {
  const { date, minutes } = chileNow(now);
  const days = shop.days ?? '0123456';
  return !shop.paused && days.includes(String(weekday(date))) && minutes >= shop.opens && minutes < shop.closes;
}

/** Instante real convertido a 'AAAA-MM-DDTHH:MM' en hora de Chile, comparable con una franja. */
export function chileStamp(now = new Date()) {
  const { date, minutes } = chileNow(now);
  return `${date}T${hhmm(minutes)}`;
}

/** 'HH:MM' -> minutos desde medianoche. */
export function toMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}
