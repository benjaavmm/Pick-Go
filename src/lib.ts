export type ShopStatus = 'pendiente' | 'activo' | 'suspendido';
export interface User {
  id: number;
  name: string;
  email: string;
  role: 'student' | 'shop' | 'admin' | 'owner';
  campus_id: number | null;
  shop_id: number | null;
  institution_id: number | null;
  campus_name: string | null;
  institution: string | null;
  shop_name: string | null;
  shop_status: ShopStatus | null;
  /** false cuando el estudiante acumula demasiados pedidos sin retirar. */
  can_order?: boolean;
  no_shows?: number;
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
  auto_accept: boolean;
  /** Acepta pedidos que se pagan al retirar. */
  pay_at_shop: boolean;
  /** Descuentos por hora de retiro, en minutos desde medianoche. */
  promos: Promo[];
  loyalty_every: number;
  loyalty_max: number;
  /** Días que atiende: dígitos de 0 (domingo) a 6 (sábado). */
  days: string;
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
  /** Ícono opcional (puede venir vacío). */
  emoji: string;
  /** Foto opcional. */
  image: string | null;
  options: OptionGroup[];
  /** Anticipación propia del producto en minutos (0 = la del local). */
  prep_minutes: number;
  available: boolean;
}
export interface Promo {
  from: number;
  to: number;
  percent: number;
}
export interface Loyalty {
  every: number;
  max: number;
  /** Sellos acumulados hacia el próximo premio. */
  stamps: number;
  /** Premios disponibles para usar. */
  rewards: number;
}
export interface Quote {
  subtotal: number;
  promo_discount: number;
  promo_percent: number;
  reward_discount: number;
  total: number;
  loyalty: Loyalty | null;
}
export interface Impact {
  days: number;
  delivered: number;
  sales: number;
  previous: { delivered: number; sales: number };
  peak_hours: number[];
  peak_orders: number;
  queue_minutes_saved: number;
  queue_minutes_per_order: number;
  customers: number;
  returning: number;
  new_customers: number;
  no_show_paid: number;
  no_show_paid_amount: number;
  promo_orders: number;
  promo_sales: number;
  promo_given: number;
  rewards: number;
}
export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  choices: { id: string; name: string; price: number }[];
}
export interface ChosenOption {
  id: string;
  group: string;
  name: string;
  price: number;
}
export interface Slot {
  slot: string;
  day: 'hoy' | 'manana';
  time: string;
  remaining: number;
  /** Descuento por promoción en esa hora de retiro, si hay. */
  promo?: number;
}
export type Status = 'pago_pendiente' | 'recibido' | 'preparando' | 'listo' | 'entregado' | 'cancelado' | 'no_retirado';
export type PaymentStatus = '' | 'pendiente' | 'aprobado' | 'expirado' | 'reembolsado' | 'reembolso_fallido';
export interface Order {
  id: number;
  code: string;
  user_id: number;
  shop_id: number;
  slot: string;
  status: Status;
  paid: boolean;
  /** 'app': pagado en la app; 'local': se paga al retirar. */
  payment_method: 'app' | 'local';
  payment_status: PaymentStatus;
  fee: number;
  subtotal: number;
  promo_discount: number;
  reward_discount: number;
  /** Solo al crear un pedido que se paga en la app: dónde completar el pago. */
  pay_url?: string;
  total: number;
  note: string;
  rating: number | null;
  rating_comment: string;
  cancel_reason: string;
  on_time: boolean | null;
  created_at: string;
  shop_name: string;
  shop_emoji: string;
  shop_location: string;
  customer_name: string;
  items: { id: number; product_id: number; name: string; emoji: string; price: number; qty: number; options: ChosenOption[] }[];
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
export interface Settlement {
  id: number;
  shop_id: number;
  shop_name: string;
  orders: number;
  gross: number;
  fee: number;
  amount: number;
  reference: string;
  created_at: string;
}
export interface PayoutSummary {
  orders: number;
  gross: number;
  fee: number;
  amount: number;
}
export interface ShopPayouts {
  enabled: boolean;
  commission_bps: number;
  pending: PayoutSummary;
  in_progress: { orders: number; gross: number };
  settlements: Settlement[];
}
export const percent = (bps: number) => `${(bps / 100).toLocaleString('es-CL', { maximumFractionDigits: 2 })} %`;

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
  pago_pendiente: 'Falta pagar',
  recibido: 'Enviado',
  preparando: 'En preparación',
  listo: 'Listo para retirar',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  no_retirado: 'No retirado',
};
export const optionsText = (options: { name: string }[]) => options.map((o) => o.name).join(', ');
export const isActive = (s: Status) => s === 'recibido' || s === 'preparando' || s === 'listo';
/** Pedidos que el estudiante todavía tiene abiertos, incluido el que falta pagar. */
export const isOpenOrder = (s: Status) => isActive(s) || s === 'pago_pendiente';

/** Texto del estado del pago, para el estudiante. */
export function paymentText(o: Pick<Order, 'payment_method' | 'payment_status' | 'status' | 'paid'>) {
  if (o.payment_method === 'app') {
    switch (o.payment_status) {
      case 'aprobado':
        return 'Pagado en la app';
      case 'reembolsado':
        return 'Pago devuelto a tu medio de pago';
      case 'reembolso_fallido':
        return 'Estamos gestionando la devolución de tu pago';
      case 'pendiente':
        return 'Falta completar el pago';
      default:
        return 'Sin cobro';
    }
  }
  if (o.status === 'cancelado' || o.status === 'no_retirado') return 'Sin cobro';
  return o.paid ? 'Pagado en el local' : 'Se paga en el local al retirar';
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** "15 % menos retirando entre 15:00 y 16:30" */
export const promoText = (p: Promo) => `${p.percent} % menos retirando entre ${hhmm(p.from)} y ${hhmm(p.to)}`;
