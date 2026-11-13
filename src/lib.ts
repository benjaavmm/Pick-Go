export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'shop';
  campus_id: number | null;
  shop_id: number | null;
  campus_name: string | null;
  institution: string | null;
  shop_name: string | null;
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
export type Status = 'recibido' | 'preparando' | 'listo' | 'entregado' | 'cancelado';
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
  created_at: string;
  shop_name: string;
  shop_emoji: string;
  shop_location: string;
  customer_name: string;
  items: { product_id: number; name: string; emoji: string; price: number; qty: number }[];
  events: { status: Status; at: string }[];
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
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00Z`) - Date.parse(`${b}T00:00Z`)) / 864e5);

/** Minutos que faltan para la hora de retiro (negativo si ya pasó). */
export function minutesUntil(slot: string) {
  const now = chileNow();
  return dayDiff(slot.slice(0, 10), now.date) * 1440 + toMinutes(slot.slice(11)) - now.minutes;
}

export function slotLabel(slot: string) {
  const diff = dayDiff(slot.slice(0, 10), chileNow().date);
  const time = slot.slice(11);
  if (diff === 0) return `Hoy, ${time}`;
  if (diff === 1) return `Mañana, ${time}`;
  if (diff === -1) return `Ayer, ${time}`;
  const [, m, d] = slot.slice(0, 10).split('-');
  return `${d}/${m}, ${time}`;
}

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
};
export const PAYMENT_LABEL: Record<Payment, string> = {
  tarjeta: 'Tarjeta de débito o crédito',
  junaeb: 'Tarjeta JUNAEB',
  efectivo: 'Efectivo al retirar',
};
export const isActive = (s: Status) => s === 'recibido' || s === 'preparando' || s === 'listo';
