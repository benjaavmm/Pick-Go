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
 * Franjas de retiro de hoy y mañana para un local.
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
  push(addDays(date, 1), 'manana', shop.opens + shop.prep_minutes);
  return out;
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
