import {
  Apple,
  Banknote,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  MapPin,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  ShoppingBag,
  Store,
  TriangleAlert,
  User as UserIcon,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  clockTime,
  errorText,
  firstName,
  hhmm,
  isActive,
  minutesUntil,
  money,
  PAYMENT_LABEL,
  relativeTime,
  slotDay,
  slotLabel,
  STATUS_LABEL,
  type Order,
  type Payment,
  type Product,
  type Shop,
  type Slot,
  type Status,
  type User,
} from '../lib';
import { useApp, useLoad, useOrderEvents, useTick } from '../state';
import { Empty, ErrorBox, Loading, Logo, Rating, StarsInput, StatusPill, TopBar } from '../ui';
import { AccountSettings } from './account';
import { CampusSelect } from './auth';

export function StudentLayout() {
  const { cartCount } = useApp();
  return (
    <div className="app">
      <Outlet />
      <nav className="tabbar" aria-label="Principal">
        <NavLink to="/" end>
          <Store size={22} aria-hidden />
          Locales
        </NavLink>
        <NavLink to="/carrito">
          <span className="tab-icon">
            <ShoppingBag size={22} aria-hidden />
            {cartCount > 0 && <b className="badge">{cartCount}</b>}
          </span>
          Carrito
        </NavLink>
        <NavLink to="/pedidos">
          <Receipt size={22} aria-hidden />
          Pedidos
        </NavLink>
        <NavLink to="/perfil">
          <UserIcon size={22} aria-hidden />
          Perfil
        </NavLink>
      </nav>
    </div>
  );
}

const ACTIVE_TITLE: Partial<Record<Status, string>> = {
  recibido: 'Pedido recibido',
  preparando: 'Lo están preparando',
  listo: '¡Listo para retirar!',
};

/** Ticket del pedido en curso: la hora de retiro es lo primero que se ve. */
function LiveTicket({ o }: { o: Order }) {
  return (
    <Link to={`/pedidos/${o.id}`} className={`ticket ticket-${o.status}`}>
      <div className="ticket-main">
        <span className="ticket-kicker">{o.shop_name}</span>
        <strong>{ACTIVE_TITLE[o.status]}</strong>
        <span className="ticket-sub">
          {o.status === 'listo' ? `Muestra el código ${o.code}` : `Retiro ${relativeTime(o.slot)}`}
        </span>
      </div>
      <div className="ticket-stub">
        <span>{slotDay(o.slot)}</span>
        <b>{o.slot.slice(11)}</b>
      </div>
    </Link>
  );
}

// ---------- Inicio: locales de la sede ----------
export function Home() {
  const { user } = useApp();
  const campusId = user!.campus_id;
  const shops = useLoad(() => api<Shop[]>(`/campuses/${campusId}/shops`), [campusId]);
  const orders = useLoad(() => api<Order[]>('/orders'), []);
  useOrderEvents(orders.reload);
  useTick();
  const active = (orders.data ?? []).filter((o) => isActive(o.status));
  const last = (orders.data ?? []).find((o) => o.status === 'entregado');

  // Primero los locales donde se puede retirar antes.
  const sorted = useMemo(
    () =>
      [...(shops.data ?? [])].sort((a, b) =>
        (a.next_slot?.slot ?? '9999').localeCompare(b.next_slot?.slot ?? '9999') || a.name.localeCompare(b.name),
      ),
    [shops.data],
  );

  return (
    <main className="page page-home">
      <header className="hero">
        <div className="hero-top">
          <Logo />
          <Link to="/perfil" className="campus-chip">
            <MapPin size={14} aria-hidden />
            {user!.campus_name}
          </Link>
        </div>
        <h1 className="display">
          Hola, {firstName(user!.name)}.
          <br />
          ¿Qué <mark>retiras</mark> hoy?
        </h1>
      </header>

      {active.length > 0 && (
        <section className="stack" aria-label="Pedidos en curso">
          {active.map((o) => (
            <LiveTicket key={o.id} o={o} />
          ))}
        </section>
      )}

      {last && active.length === 0 && (
        <Link to={`/pedidos/${last.id}`} className="card again">
          <RotateCcw size={20} aria-hidden />
          <span className="grow">
            <strong>Pedir lo de siempre</strong>
            <span className="muted">
              {last.items.map((i) => `${i.qty}× ${i.name}`).join(', ')} · {last.shop_name}
            </span>
          </span>
          <ChevronRight size={18} aria-hidden />
        </Link>
      )}

      <h2 className="section">Locales en tu sede</h2>
      {shops.error && <ErrorBox text={shops.error} retry={shops.reload} />}
      {!shops.data && !shops.error && <Loading />}
      {shops.data?.length === 0 && (
        <Empty
          icon={<Store size={28} />}
          title="Todavía no hay locales en esta sede"
          text="Si conoces un local, cuéntale que puede sumarse gratis desde la pantalla de ingreso."
        />
      )}
      <ul className="list">
        {sorted.map((s) => {
          const soon = s.next_slot && s.next_slot.day === 'hoy';
          return (
            <li key={s.id}>
              <Link to={`/local/${s.id}`} className="card shop-card">
                <span className="tile" aria-hidden>
                  {s.emoji}
                </span>
                <span className="grow">
                  <strong>{s.name}</strong>
                  <span className="muted clamp">{s.description}</span>
                  <span className="meta">
                    <Rating value={s.rating} />
                    {s.location && (
                      <span>
                        <MapPin size={13} aria-hidden /> {s.location}
                      </span>
                    )}
                  </span>
                </span>
                {s.paused || !s.next_slot ? (
                  <span className="when when-off">
                    <small>{s.paused ? 'En pausa' : 'Sin horas'}</small>
                  </span>
                ) : (
                  <span className={`when ${soon ? 'when-on' : ''}`}>
                    <small>{soon ? 'Retira' : 'Mañana'}</small>
                    <b>{s.next_slot.time}</b>
                    <small>{soon ? relativeTime(s.next_slot.slot) : s.is_open ? '' : 'Cerrado hoy'}</small>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

// ---------- Menú de un local ----------
function Stepper({ qty, onChange, label }: { qty: number; onChange: (q: number) => void; label: string }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(qty - 1)} aria-label={`Quitar uno de ${label}`}>
        <Minus size={18} />
      </button>
      <span aria-live="polite">{qty}</span>
      <button onClick={() => onChange(qty + 1)} disabled={qty >= 20} aria-label={`Agregar uno de ${label}`}>
        <Plus size={18} />
      </button>
    </div>
  );
}

export function ShopPage() {
  const { id } = useParams();
  const { cart, cartCount, cartTotal, addToCart, setQty } = useApp();
  const { data, error, reload } = useLoad(() => api<{ shop: Shop; products: Product[] }>(`/shops/${id}`), [id]);
  const [category, setCategory] = useState<string | null>(null);
  useTick();

  const categories = useMemo(() => [...new Set((data?.products ?? []).map((p) => p.category))], [data]);
  if (error)
    return (
      <main className="page">
        <TopBar title="Local" back="/" />
        <ErrorBox text={error} retry={reload} />
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <TopBar title="Local" back="/" />
        <Loading />
      </main>
    );

  const { shop, products } = data;
  const current = category && categories.includes(category) ? category : categories[0];
  const inThisShop = cart.shopId === shop.id;
  const qtyOf = (pid: number) => (inThisShop ? (cart.lines.find((l) => l.productId === pid)?.qty ?? 0) : 0);

  return (
    <main className="page has-cartbar">
      <TopBar title={shop.name} back="/" />
      <section className="shop-head">
        <span className="tile tile-lg" aria-hidden>
          {shop.emoji}
        </span>
        <div className="grow">
          <p>{shop.description}</p>
          <p className="meta">
            <Rating value={shop.rating} count={shop.ratings} />
            {shop.location && (
              <span>
                <MapPin size={13} aria-hidden /> {shop.location}
              </span>
            )}
            <span>
              <Clock size={13} aria-hidden /> {hhmm(shop.opens)} a {hhmm(shop.closes)}
            </span>
          </p>
        </div>
      </section>
      {shop.paused ? (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden /> Este local no está recibiendo pedidos en este momento.
        </p>
      ) : shop.next_slot ? (
        <p className="notice">
          <Clock size={18} aria-hidden />
          <span>
            Puedes retirar{' '}
            <strong>
              {shop.next_slot.day === 'manana' ? 'mañana a las ' : 'hoy a las '}
              {shop.next_slot.time}
            </strong>
            {shop.next_slot.day === 'hoy' && ` (${relativeTime(shop.next_slot.slot)})`}
          </span>
        </p>
      ) : (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden /> No quedan horas de retiro disponibles.
        </p>
      )}

      {products.length === 0 && <p className="muted center">Este local todavía no publica su menú.</p>}
      {categories.length > 1 && (
        <div className="chips" role="tablist" aria-label="Categorías">
          {categories.map((c) => (
            <button key={c} role="tab" aria-selected={c === current} className={c === current ? 'on' : ''} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <ul className="list">
        {products
          .filter((p) => p.category === current)
          .map((p) => {
            const qty = qtyOf(p.id);
            return (
              <li key={p.id} className={`card product ${p.available ? '' : 'soldout'}`}>
                <span className="tile" aria-hidden>
                  {p.emoji}
                </span>
                <div className="grow">
                  <strong>{p.name}</strong>
                  {p.description && <span className="muted clamp">{p.description}</span>}
                  <span className="price">{money(p.price)}</span>
                </div>
                {!p.available ? (
                  <span className="tag tag-off">Agotado</span>
                ) : qty > 0 ? (
                  <Stepper qty={qty} onChange={(q) => setQty(p.id, q)} label={p.name} />
                ) : (
                  <button className="add" disabled={shop.paused} onClick={() => addToCart(shop, p)} aria-label={`Agregar ${p.name}`}>
                    <Plus size={22} />
                  </button>
                )}
              </li>
            );
          })}
      </ul>

      {inThisShop && cartCount > 0 && (
        <Link to="/carrito" className="cartbar">
          <span className="cartbar-count">{cartCount}</span>
          <span className="grow">Ver carrito</span>
          <strong>{money(cartTotal)}</strong>
        </Link>
      )}
    </main>
  );
}

// ---------- Carrito, hora de retiro y pago ----------
const PAYMENT_ICON: Record<Payment, ReactNode> = {
  tarjeta: <CreditCard size={22} />,
  junaeb: <Apple size={22} />,
  efectivo: <Banknote size={22} />,
};

function SlotPicker({ slots, value, onChange }: { slots: Slot[]; value: string; onChange: (s: string) => void }) {
  const hasToday = slots.some((s) => s.day === 'hoy');
  const [day, setDay] = useState<'hoy' | 'manana'>(hasToday ? 'hoy' : 'manana');
  const shown = slots.filter((s) => s.day === day);
  return (
    <div>
      <div className="segmented">
        <button className={day === 'hoy' ? 'on' : ''} onClick={() => setDay('hoy')} disabled={!hasToday}>
          Hoy
        </button>
        <button className={day === 'manana' ? 'on' : ''} onClick={() => setDay('manana')}>
          Mañana
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted">No quedan horas para hoy. Puedes dejar tu pedido para mañana.</p>
      ) : (
        <div className="slots" role="radiogroup" aria-label="Hora de retiro">
          {shown.map((s) => (
            <button
              key={s.slot}
              role="radio"
              aria-checked={value === s.slot}
              className={value === s.slot ? 'on' : ''}
              disabled={s.remaining === 0}
              onClick={() => onChange(s.slot)}
            >
              {s.time}
              {s.remaining === 0 ? <small>Lleno</small> : s.remaining <= 2 ? <small>Quedan {s.remaining}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="step-title">
      <span aria-hidden>{n}</span>
      {children}
    </h2>
  );
}

export function Checkout() {
  const { user, cart, cartTotal, setQty, clearCart } = useApp();
  const navigate = useNavigate();
  const shopId = cart.shopId;
  const slots = useLoad(() => (shopId ? api<Slot[]>(`/shops/${shopId}/slots`) : Promise.resolve([])), [shopId]);
  const cashAllowed = user!.cash_allowed !== false;
  const [slot, setSlot] = useState('');
  const [payment, setPayment] = useState<Payment>('tarjeta');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Por defecto se propone la primera hora con cupo: el camino rápido es confirmar y listo.
  useEffect(() => {
    if (!slots.data) return;
    const valid = slots.data.find((s) => s.slot === slot && s.remaining > 0);
    if (!valid) setSlot(slots.data.find((s) => s.remaining > 0)?.slot ?? '');
  }, [slots.data, slot]);

  if (!shopId || cart.lines.length === 0)
    return (
      <main className="page">
        <TopBar title="Carrito" />
        <Empty icon={<ShoppingBag size={28} />} title="Tu carrito está vacío" text="Elige un local y agrega lo que quieras retirar.">
          <Link to="/" className="btn btn-primary">
            Ver locales
          </Link>
        </Empty>
      </main>
    );

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const order = await api<Order>('/orders', 'POST', {
        shopId,
        slot,
        paymentMethod: payment,
        note,
        items: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      clearCart();
      navigate(`/pedidos/${order.id}`, { replace: true });
    } catch (e) {
      setError(errorText(e));
      slots.reload();
      setBusy(false);
    }
  };

  return (
    <main className="page has-paybar">
      <TopBar title="Tu pedido" back={`/local/${shopId}`} />

      <StepTitle n={1}>{cart.shopName}</StepTitle>
      <ul className="list">
        {cart.lines.map((l) => (
          <li key={l.productId} className="card product">
            <span className="tile" aria-hidden>
              {l.emoji}
            </span>
            <div className="grow">
              <strong>{l.name}</strong>
              <span className="price">{money(l.price * l.qty)}</span>
            </div>
            <Stepper qty={l.qty} onChange={(q) => setQty(l.productId, q)} label={l.name} />
          </li>
        ))}
      </ul>
      <label className="field">
        <span>
          Nota para el local <span className="optional">(opcional)</span>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej.: sin mayonesa" />
      </label>

      <StepTitle n={2}>¿A qué hora lo retiras?</StepTitle>
      <div className="card">
        {slots.error ? (
          <ErrorBox text={slots.error} retry={slots.reload} />
        ) : !slots.data ? (
          <Loading />
        ) : slots.data.length === 0 ? (
          <p className="error">Este local no está recibiendo pedidos en este momento.</p>
        ) : (
          <SlotPicker slots={slots.data} value={slot} onChange={setSlot} />
        )}
      </div>

      <StepTitle n={3}>¿Cómo pagas?</StepTitle>
      <div className="options" role="radiogroup" aria-label="Método de pago">
        {(Object.keys(PAYMENT_LABEL) as Payment[]).map((p) => {
          const blocked = p === 'efectivo' && !cashAllowed;
          return (
            <button key={p} role="radio" aria-checked={payment === p} className={payment === p ? 'on' : ''} disabled={blocked} onClick={() => setPayment(p)}>
              <span className="option-icon" aria-hidden>
                {PAYMENT_ICON[p]}
              </span>
              <span className="grow">
                {PAYMENT_LABEL[p]}
                {blocked && <small>No disponible: tienes pedidos anteriores sin retirar</small>}
              </span>
              <span className="radio" aria-hidden>
                {payment === p && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <p className="muted small">
        {payment === 'efectivo' ? 'Pagas en caja al retirar tu pedido.' : 'Demo: el pago es simulado, no se hace ningún cobro real.'}
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="paybar">
        <div>
          <span>{slot ? `Retiro ${slotLabel(slot).toLowerCase()}` : 'Elige una hora de retiro'}</span>
          <strong>{money(cartTotal)}</strong>
        </div>
        <button className="btn btn-primary" disabled={busy || !slot} onClick={confirm}>
          {busy ? 'Enviando…' : 'Confirmar pedido'}
        </button>
      </div>
    </main>
  );
}

// ---------- Mis pedidos ----------
export function Orders() {
  const { data, error, reload } = useLoad(() => api<Order[]>('/orders'), []);
  useOrderEvents(reload);
  useTick();
  const active = (data ?? []).filter((o) => isActive(o.status));
  const past = (data ?? []).filter((o) => !isActive(o.status));
  return (
    <main className="page">
      <TopBar title="Mis pedidos" />
      {error && <ErrorBox text={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && (
        <Empty icon={<Receipt size={28} />} title="Aún no tienes pedidos" text="Cuando hagas uno, aquí vas a ver su estado en vivo.">
          <Link to="/" className="btn btn-primary">
            Hacer mi primer pedido
          </Link>
        </Empty>
      )}
      {active.length > 0 && (
        <section className="stack">
          {active.map((o) => (
            <LiveTicket key={o.id} o={o} />
          ))}
        </section>
      )}
      {past.length > 0 && <h2 className="section">Anteriores</h2>}
      {past.length > 0 && (
        <ul className="list">
          {past.map((o) => (
            <li key={o.id}>
              <Link to={`/pedidos/${o.id}`} className="card order-row">
                <span className="tile" aria-hidden>
                  {o.shop_emoji}
                </span>
                <span className="grow">
                  <strong>{o.shop_name}</strong>
                  <span className="muted clamp">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</span>
                  <span className="muted">
                    {slotLabel(o.slot)} · {money(o.total)}
                  </span>
                </span>
                <StatusPill status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const STEPS: Status[] = ['recibido', 'preparando', 'listo', 'entregado'];
const HEADLINE: Record<Status, string> = {
  recibido: 'El local recibió tu pedido',
  preparando: 'Están preparando tu pedido',
  listo: '¡Listo! Pasa a retirarlo',
  entregado: 'Pedido entregado',
  cancelado: 'Pedido cancelado',
  no_retirado: 'No retiraste este pedido',
};

function RateCard({ o, onRated }: { o: Order; onRated: (o: Order) => void }) {
  const { toast } = useApp();
  const [rating, setRating] = useState(o.rating ?? 0);
  const [comment, setComment] = useState(o.rating_comment);
  const [editing, setEditing] = useState(o.rating === null);
  const send = async () => {
    try {
      onRated(await api<Order>(`/orders/${o.id}/rate`, 'POST', { rating, comment }));
      setEditing(false);
      toast('Gracias por tu opinión', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  if (!editing)
    return (
      <section className="card rate">
        <strong>Tu calificación</strong>
        <StarsInput
          value={rating}
          onChange={(n) => {
            setRating(n);
            setEditing(true);
          }}
        />
        {o.rating_comment && <p className="muted">«{o.rating_comment}»</p>}
      </section>
    );
  return (
    <section className="card rate">
      <strong>¿Cómo estuvo {o.shop_name}?</strong>
      <StarsInput value={rating} onChange={setRating} />
      {rating > 0 && (
        <>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={200}
            placeholder="Cuéntale al local qué te pareció (opcional)"
            aria-label="Comentario"
          />
          <button className="btn btn-primary btn-block" onClick={send}>
            Enviar calificación
          </button>
        </>
      )}
    </section>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const { replaceCart, toast } = useApp();
  const navigate = useNavigate();
  const { data: o, error, reload, setData } = useLoad(() => api<Order>(`/orders/${id}`), [id]);
  const [qr, setQr] = useState('');
  useOrderEvents((e) => {
    if (e.order.id === Number(id)) setData(e.order);
  });
  useTick();
  // Respaldo por si se corta la conexión en vivo.
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    // Siempre negro sobre blanco: así lo lee cualquier cámara, también en modo oscuro.
    if (o?.code) QRCode.toDataURL(o.code, { margin: 2, width: 480, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''));
  }, [o?.code]);

  if (error)
    return (
      <main className="page">
        <TopBar title="Pedido" back="/pedidos" />
        <ErrorBox text={error} retry={reload} />
      </main>
    );
  if (!o)
    return (
      <main className="page">
        <TopBar title="Pedido" back="/pedidos" />
        <Loading />
      </main>
    );

  const at = (s: Status) => o.events.find((e) => e.status === s)?.at;
  const reached = STEPS.indexOf(o.status);
  const active = isActive(o.status);
  const late = active && minutesUntil(o.slot) < 0;
  const cancel = async () => {
    if (!window.confirm('¿Cancelar este pedido?')) return;
    try {
      setData(await api<Order>(`/orders/${o.id}/cancel`, 'POST'));
    } catch (e) {
      toast(errorText(e), 'error');
      reload();
    }
  };
  const repeat = () => {
    replaceCart({
      shopId: o.shop_id,
      shopName: o.shop_name,
      lines: o.items.map((i) => ({ productId: i.product_id, name: i.name, emoji: i.emoji, price: i.price, qty: i.qty })),
    });
    navigate('/carrito');
  };

  return (
    <main className="page">
      <TopBar title="Tu pedido" back="/pedidos" />

      <section className={`pass pass-${o.status}`}>
        <div className="pass-head">
          <StatusPill status={o.status} />
          <h2>{HEADLINE[o.status]}</h2>
          <p>
            {o.shop_name}
            {o.shop_location && ` · ${o.shop_location}`}
          </p>
          {reached >= 0 && (
            <ol className="progress" aria-label={`Estado: ${STATUS_LABEL[o.status]}`}>
              {STEPS.map((s, i) => (
                <li key={s} className={i <= reached ? 'done' : ''} />
              ))}
            </ol>
          )}
        </div>
        <div className="pass-time">
          <div>
            <span>Retiro</span>
            <b>{o.slot.slice(11)}</b>
          </div>
          <div className="right">
            <span>{slotDay(o.slot)}</span>
            <strong className={late ? 'late' : ''}>{active ? relativeTime(o.slot) : STATUS_LABEL[o.status]}</strong>
          </div>
        </div>
        {active && (
          <div className="pass-code">
            {qr && <img src={qr} alt={`Código QR del pedido ${o.code}`} width={200} height={200} />}
            <div>
              <span>Muestra este código al retirar</span>
              <b>{o.code}</b>
            </div>
          </div>
        )}
      </section>

      {o.status === 'no_retirado' && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>El local lo preparó y nadie pasó a buscarlo. Con dos pedidos sin retirar, el pago en efectivo se desactiva por 30 días.</span>
        </p>
      )}
      {o.status === 'entregado' && <RateCard o={o} onRated={setData} />}

      {reached >= 0 && (
        <ol className="card timeline">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= reached ? 'done' : ''}>
              <span className="dot" aria-hidden>
                {i <= reached && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="grow">{STATUS_LABEL[s]}</span>
              {at(s) && <time>{clockTime(at(s)!)}</time>}
            </li>
          ))}
        </ol>
      )}

      <section className="card">
        <ul className="lines">
          {o.items.map((i) => (
            <li key={i.product_id}>
              <span>
                <b>{i.qty}×</b> {i.name}
              </span>
              <span>{money(i.price * i.qty)}</span>
            </li>
          ))}
          <li className="lines-total">
            <span>Total</span>
            <span>{money(o.total)}</span>
          </li>
        </ul>
        {o.note && <p className="muted">Nota: {o.note}</p>}
        <p className="muted">
          {PAYMENT_LABEL[o.payment_method]} ·{' '}
          {o.status === 'cancelado' ? 'Sin cobro' : o.paid ? 'Pagado' : 'Se paga en caja al retirar'}
        </p>
      </section>

      {o.status === 'recibido' && (
        <button className="btn btn-danger btn-block" onClick={cancel}>
          Cancelar pedido
        </button>
      )}
      {!active && (
        <button className="btn btn-dark btn-block" onClick={repeat}>
          <RotateCcw size={18} aria-hidden /> Repetir este pedido
        </button>
      )}
    </main>
  );
}

// ---------- Perfil ----------
export function Profile() {
  const { user, setUser, toast } = useApp();
  const [campusId, setCampusId] = useState(String(user!.campus_id ?? ''));

  const changeCampus = async (v: string) => {
    setCampusId(v);
    if (!v) return;
    try {
      setUser(await api<User>('/me', 'PATCH', { campusId: Number(v) }));
      toast('Sede actualizada', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <main className="page">
      <TopBar title="Perfil" />
      <section className="card profile">
        <span className="avatar" aria-hidden>
          {firstName(user!.name).slice(0, 1).toUpperCase()}
        </span>
        <div className="grow">
          <strong>{user!.name}</strong>
          <span className="muted">{user!.email}</span>
        </div>
      </section>
      <label className="field">
        Tu sede
        <CampusSelect value={campusId} onChange={changeCampus} />
      </label>
      <AccountSettings notifyText="Te avisamos cuando tu pedido esté listo, aunque tengas la app cerrada." />
    </main>
  );
}
