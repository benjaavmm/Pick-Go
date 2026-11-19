import type { CSSProperties } from 'react';
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
  /** Solo estudiantes: tiene beca Junaeb, y el operador de la beca en su sede. */
  baes?: boolean;
  baes_operator?: BaesOperator | null;
  /** Solo estudiantes: sus recreos, para proponerle la hora de retiro. */
  breaks?: Break[];
  /** Solo estudiantes: por qué no puede pagar al retirar ahora (null si puede). */
  pay_later_problem?: string | null;
}
export type BaesOperator = 'edenred' | 'pluxee';
/** Un recreo: días (dígitos de 0 = domingo a 6 = sábado) y rango en minutos desde medianoche. */
export interface Break {
  days: string;
  from: number;
  to: number;
}
export interface Campus {
  id: number;
  name: string;
  city: string;
  institution: string;
  shops_count: number;
  baes_operator: BaesOperator;
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
  /** Acepta la beca Junaeb al retirar (está adherido al operador de su sede). */
  accepts_baes: boolean;
  baes_operator: BaesOperator;
  /** Descuentos por hora de retiro, en minutos desde medianoche. */
  promos: Promo[];
  loyalty_every: number;
  loyalty_max: number;
  /** Color principal del local (#rrggbb), o vacío para usar los de la app. Pinta su tarjeta de sellos. */
  color: string;
  /** Color de los sellos ganados (#rrggbb), o vacío. */
  color_2: string;
  /** Dirección del logo del local, si subió uno. */
  logo: string | null;
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
  baes_orders: number;
  baes_sales: number;
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
export type PaymentStatus = '' | 'pendiente' | 'aprobado' | 'expirado' | 'reembolsado' | 'reembolso_fallido' | 'otro_medio';
export type PaymentMethod = 'app' | 'local' | 'junaeb';
export interface Order {
  id: number;
  code: string;
  user_id: number;
  shop_id: number;
  slot: string;
  status: Status;
  paid: boolean;
  /** 'app': pagado en la app; 'local': se paga al retirar; 'junaeb': beca Junaeb, al retirar. */
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  /** Operador de la beca Junaeb en la sede del local. */
  baes_operator: BaesOperator;
  fee: number;
  subtotal: number;
  promo_discount: number;
  reward_discount: number;
  /** Descuento que paga la plataforma (el local recibe el precio completo). */
  funded_discount: number;
  /** Pedidos que se pagan al retirar: historial del cliente en la plataforma. */
  customer_history: { delivered: number; no_shows: number } | null;
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
  discounts: number;
  amount: number;
  reference: string;
  created_at: string;
}
export interface PayoutSummary {
  orders: number;
  gross: number;
  fee: number;
  discounts: number;
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
  campuses: { id: number; name: string; city: string; students: number; baes_operator: BaesOperator; baes_shops: number }[];
  shops: AdminShop[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Datos extra que el servidor manda junto al error (por ejemplo, el cobro Junaeb pendiente). */
    public data: Record<string, unknown> = {},
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
  if (!res.ok) {
    const { error, ...rest } = data ?? {};
    throw new ApiError(res.status, error ?? 'Algo falló. Intenta de nuevo.', rest);
  }
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
  if (o.payment_method === 'junaeb') {
    if (o.payment_status === 'aprobado') return 'Pagado con tu beca Junaeb';
    if (o.payment_status === 'otro_medio') return 'Pagado en el local (la beca no pasó)';
    return 'Pagas con tu beca Junaeb al retirar';
  }
  return o.paid ? 'Pagado en el local' : 'Se paga en el local al retirar';
}

// ---------- Beca Junaeb (BAES) ----------
// No hay forma pública de cobrar la beca dentro de la app: se paga en el mesón, con la app del operador.
// Para que eso tome segundos, el estudiante llega con el monto exacto y la app del operador lista.
export const BAES: Record<BaesOperator, { name: string; app: string; student: string[]; shop: (total: string) => string }> = {
  edenred: {
    name: 'Edenred',
    app: 'Ticket Junaeb',
    student: [
      'Antes de llegar, abre la app Ticket Junaeb y ten a mano tu clave de pago.',
      'En el mesón toca «Pagar», ingresa tu clave y muestra el código QR (o el código dinámico, si el local usa POS).',
      'Te entregan tu pedido apenas se apruebe el pago.',
    ],
    shop: (total) => `Cobra ${total} con Ticket Junaeb: lee el QR del estudiante o ingresa su código dinámico en tu POS.`,
  },
  pluxee: {
    name: 'Pluxee',
    app: 'Pluxee Chile',
    student: [
      'Antes de llegar, abre la app Pluxee Chile y deja lista la opción «Pago QR».',
      'En el mesón, el local genera un QR con el monto exacto: escanéalo y confirma con tu PIN.',
      'Te entregan tu pedido apenas se apruebe el pago.',
    ],
    shop: (total) => `Cobra ${total} con Pluxee: en la app Pluxee comercios toca «Cobrar», ingresa el monto y muestra el QR.`,
  },
};
export const baesName = (op: BaesOperator | null | undefined) => (op ? `${BAES[op].app} (${BAES[op].name})` : 'la app de tu beca');

// ---------- Recreos ----------
const WEEKDAY_OF = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** ¿La hora de retiro cae dentro de alguno de los recreos del estudiante? */
export function breakFor(breaks: Break[] | undefined, slot: string) {
  if (!breaks?.length) return null;
  const day = String(WEEKDAY_OF(slot.slice(0, 10)));
  const m = toMinutes(slot.slice(11));
  return breaks.find((b) => b.days.includes(day) && m >= b.from && m < b.to) ?? null;
}
/** El próximo recreo (hoy o en los próximos días), con la fecha en que cae. */
export function nextBreak(breaks: Break[] | undefined, now = chileNow()) {
  if (!breaks?.length) return null;
  for (let d = 0; d < 7; d++) {
    const date = addDaysTo(now.date, d);
    const day = String(WEEKDAY_OF(date));
    const found = breaks
      .filter((b) => b.days.includes(day) && (d > 0 || b.to > now.minutes))
      .sort((a, b) => a.from - b.from)[0];
    if (found) return { ...found, date, today: d === 0, ongoing: d === 0 && found.from <= now.minutes };
  }
  return null;
}
const addDaysTo = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const WEEK: [string, string][] = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']];
/** "Lun a Vie", "Lun, Mié y Vie"… */
export function daysText(days: string) {
  if (days === '12345') return 'Lun a Vie';
  if (days === '123456') return 'Lun a Sáb';
  if (days === '0123456') return 'Todos los días';
  const names = WEEK.filter(([d]) => days.includes(d)).map(([, n]) => n);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0] ?? '';
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** "15 % menos retirando entre 15:00 y 16:30" */
export const promoText = (p: Promo) => `${p.percent} % menos retirando entre ${hhmm(p.from)} y ${hhmm(p.to)}`;

/** Colores de la app para las tarjetas de sellos de los locales que no eligieron los suyos. */
export const CARD_DEFAULT = { color: '#005bc1', color2: '#d3c995' };

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Texto legible sobre un color: blanco o casi negro, el que contraste más. */
export function inkOn(hex: string) {
  const l = luminance(hex);
  return contrast(l, 1) >= contrast(l, luminance('#14171a')) ? '#ffffff' : '#14171a';
}

/** Variables CSS de la tarjeta de sellos de un local, con texto que siempre se lee sobre sus colores. */
export function cardStyle(color?: string, color2?: string) {
  const ok = (c?: string) => !!c && /^#[0-9a-f]{6}$/i.test(c);
  const bg = ok(color) ? color! : CARD_DEFAULT.color;
  const stamp = ok(color2) ? color2! : ok(color) ? inkOn(bg) : CARD_DEFAULT.color2;
  const ink = inkOn(bg);
  return {
    '--card': bg,
    '--card-ink': ink,
    '--card-line': ink === '#ffffff' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(20, 23, 26, 0.38)',
    '--card-stamp': stamp,
    '--card-stamp-ink': inkOn(stamp),
  } as CSSProperties;
}
