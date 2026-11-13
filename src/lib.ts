export type ShopStatus = 'pendiente' | 'activo' | 'suspendido';
export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'shop' | 'admin';
  campus_id: number | null;
  shop_id: number | null;
  institution_id: number | null;
  campus_name: string | null;
  institution: string | null;
  shop_name: string | null;
  shop_status: ShopStatus | null;
  /** false cuando el estudiante acumula pedidos sin retirar y debe pagar al pedir. */
  cash_allowed?: boolean;
}
export interface Campus {
  id: number;
  name: string;
  city: string;
  institution: string;
  shops_count: number;
}
export interface Shop {
  id: number;
  campus_id: number;
  name: string;
  description: string;
  emoji: string;
  location: string;
  opens: number;
  closes: number;
  prep_minutes: number;
  slot_capacity: number;
  paused: boolean;
  status: ShopStatus;
  rating: number | null;
  ratings: number;
  is_open: boolean;
  next_slot: { slot: string; day: 'hoy' | 'manana'; time: string } | null;
}
export interface Product {
  id: number;
  shop_id: number;
  category: string;
  name: string;
  description: string;
  price: number;
  emoji: string;
  available: boolean;
}
export interface Slot {
  slot: string;
  day: 'hoy' | 'manana';
  time: string;
  remaining: number;
}
export type Status = 'recibido' | 'preparando' | 'listo' | 'entregado' | 'cancelado' | 'no_retirado';
export type Payment = 'tarjeta' | 'junaeb' | 'efectivo';
export interface Order {
  id: number;
  code: string;
  user_id: number;
  shop_id: number;
  slot: string;
  status: Status;
  payment_method: Payment;
  paid: boolean;
  total: number;
  note: string;
  rating: number | null;
  rating_comment: string;
  on_time: boolean | null;
  created_at: string;
  shop_name: string;
  shop_emoji: string;
  shop_location: string;
  customer_name: string;
  items: { product_id: number; name: string; emoji: string; price: number; qty: number }[];
  events: { status: Status; at: string }[];
}
export interface Totals {
  orders: number;
  delivered: number;
  sales: number;
  cancelled: number;
  no_show: number;
  on_time_pct: number | null;
  rating: number | null;
  ratings: number;
  customers: number;
  avg_ticket: number;
}
export interface Stats {
  from: string;
  to: string;
  totals: Totals;
  by_day: { date: string; orders: number; sales: number }[];
  by_hour: { hour: number; orders: number }[];
  top: { name: string; emoji: string; qty: number; sales: number }[];
}
export interface ShopStats extends Stats {
  comments: { rating: number; comment: string; date: string }[];
}
export interface AdminShop {
  id: number;
  name: string;
  emoji: string;
  campus_name: string;
  description: string;
  location: string;
  status: ShopStatus;
  paused: boolean;
  products: number;
  contact: string | null;
  totals: Totals;
}
export interface Overview extends Stats {
  institution: string;
  days: number;
  students: number;
  campuses: { id: number; name: string; city: string; students: number }[];
  shops: AdminShop[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Sin conexión. Revisa tu internet e intenta de nuevo.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Algo falló. Intenta de nuevo.');
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.');

const clp = new Intl.NumberFormat('es-CL');
export const money = (n: number) => `$${clp.format(n)}`;
export const moneyShort = (n: number) =>
  n >= 1_000_000 ? `$${clp.format(Math.round(n / 100_000) / 10)} M` : money(n);

export const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Las horas de retiro están en hora de Chile, igual que en el servidor.
const chileFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function chileNow(now = new Date()) {
  const p = Object.fromEntries(chileFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00Z`) - Date.parse(`${b}T00:00Z`)) / 864e5);

/** Minutos que faltan para la hora de retiro (negativo si ya pasó). */
export function minutesUntil(slot: string) {
  const now = chileNow();
  return dayDiff(slot.slice(0, 10), now.date) * 1440 + toMinutes(slot.slice(11)) - now.minutes;
}

/** "en 12 min", "en 1 h 5 min" o "hace 3 min". */
export function relativeTime(slot: string) {
  const m = minutesUntil(slot);
  const abs = Math.abs(m);
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ''}`;
  if (m === 0) return 'ahora';
  return m > 0 ? `en ${text}` : `hace ${text}`;
}

export function slotDay(slot: string) {
  const diff = dayDiff(slot.slice(0, 10), chileNow().date);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  if (diff === -1) return 'Ayer';
  const [, m, d] = slot.slice(0, 10).split('-');
  return `${d}/${m}`;
}
export const slotLabel = (slot: string) => `${slotDay(slot)}, ${slot.slice(11)}`;

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** 'AAAA-MM-DD' -> 'lun 9' */
export const shortDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
};

export const clockTime = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );

export const STATUS_LABEL: Record<Status, string> = {
  recibido: 'Recibido',
  preparando: 'En preparación',
  listo: 'Listo para retirar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  no_retirado: 'No retirado',
};
export const PAYMENT_LABEL: Record<Payment, string> = {
  tarjeta: 'Débito o crédito',
  junaeb: 'Tarjeta JUNAEB',
  efectivo: 'Efectivo al retirar',
};
export const isActive = (s: Status) => s === 'recibido' || s === 'preparando' || s === 'listo';
export const firstName = (name: string) => name.trim().split(/\s+/)[0];
