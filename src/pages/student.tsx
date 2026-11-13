import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  clockTime,
  errorText,
  hhmm,
  isActive,
  money,
  PAYMENT_LABEL,
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
import { useApp, useLoad, useOrderEvents } from '../state';
import { CampusSelect } from './auth';

export function StudentLayout() {
  const { cartCount } = useApp();
  return (
    <div className="app">
      <Outlet />
      <nav className="tabbar" aria-label="Principal">
        <NavLink to="/" end>
          <span aria-hidden>🏪</span>Locales
        </NavLink>
        <NavLink to="/carrito">
          <span aria-hidden>🛒</span>Carrito
          {cartCount > 0 && <b className="badge">{cartCount}</b>}
        </NavLink>
        <NavLink to="/pedidos">
          <span aria-hidden>🧾</span>Pedidos
        </NavLink>
        <NavLink to="/perfil">
          <span aria-hidden>👤</span>Perfil
        </NavLink>
      </nav>
    </div>
  );
}

function TopBar({ title, back }: { title: string; back?: string }) {
  return (
    <header className="topbar">
      {back && (
        <Link to={back} className="back" aria-label="Volver">
          ←
        </Link>
      )}
      <h1>{title}</h1>
    </header>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

const Loading = () => <p className="muted center">Cargando…</p>;
const ErrorBox = ({ text, retry }: { text: string; retry: () => void }) => (
  <div className="card center">
    <p className="error">{text}</p>
    <button className="btn btn-soft" onClick={retry}>
      Reintentar
    </button>
  </div>
);

// ---------- Inicio: locales de la sede ----------
export function Home() {
  const { user } = useApp();
  const campusId = user!.campus_id;
  const shops = useLoad(() => api<Shop[]>(`/campuses/${campusId}/shops`), [campusId]);
  const orders = useLoad(() => api<Order[]>('/orders'), []);
  useOrderEvents(orders.reload);
  const active = (orders.data ?? []).filter((o) => isActive(o.status));

  return (
    <main className="page">
      <header className="hero">
        <span className="logo">Pick&amp;Go</span>
        <h1>Hola, {user!.name.split(' ')[0]}</h1>
        <p>
          {user!.institution} · {user!.campus_name} <Link to="/perfil">Cambiar</Link>
        </p>
      </header>

      {active.map((o) => (
        <Link key={o.id} to={`/pedidos/${o.id}`} className={`card active-order active-${o.status}`}>
          <div>
            <strong>
              {o.status === 'listo' ? '¡Tu pedido está listo!' : `Pedido ${STATUS_LABEL[o.status].toLowerCase()}`}
            </strong>
            <span>
              {o.shop_name} · Retiro {slotLabel(o.slot).toLowerCase()}
            </span>
          </div>
          <span className="code-chip">{o.code}</span>
        </Link>
      ))}

      <h2 className="section">Locales en tu sede</h2>
      {shops.error && <ErrorBox text={shops.error} retry={shops.reload} />}
      {!shops.data && !shops.error && <Loading />}
      {shops.data?.length === 0 && (
        <div className="card center">
          <p>
            <strong>Todavía no hay locales en esta sede.</strong>
          </p>
          <p className="muted">Si conoces un local, cuéntale que puede sumarse gratis desde la pantalla de ingreso.</p>
        </div>
      )}
      <ul className="list">
        {shops.data?.map((s) => (
          <li key={s.id}>
            <Link to={`/local/${s.id}`} className="card shop-card">
              <span className="avatar" aria-hidden>
                {s.emoji}
              </span>
              <div className="grow">
                <strong>{s.name}</strong>
                <span className="muted">{s.description}</span>
                <span className="shop-meta">
                  {s.paused ? (
                    <span className="tag tag-off">No recibe pedidos</span>
                  ) : s.is_open ? (
                    <span className="tag tag-on">Abierto</span>
                  ) : (
                    <span className="tag tag-off">Cerrado · abre {hhmm(s.opens)}</span>
                  )}
                  {s.next_slot && (
                    <span>
                      Retira desde {s.next_slot.day === 'manana' ? 'mañana ' : ''}
                      {s.next_slot.time}
                    </span>
                  )}
                </span>
              </div>
              <span className="chev" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

// ---------- Menú de un local ----------
function Stepper({ qty, onChange, label }: { qty: number; onChange: (q: number) => void; label: string }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(qty - 1)} aria-label={`Quitar uno de ${label}`}>
        −
      </button>
      <span aria-live="polite">{qty}</span>
      <button onClick={() => onChange(qty + 1)} disabled={qty >= 20} aria-label={`Agregar uno de ${label}`}>
        +
      </button>
    </div>
  );
}

export function ShopPage() {
  const { id } = useParams();
  const { cart, cartCount, cartTotal, addToCart, setQty } = useApp();
  const { data, error, reload } = useLoad(() => api<{ shop: Shop; products: Product[] }>(`/shops/${id}`), [id]);
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => [...new Set((data?.products ?? []).map((p) => p.category))], [data]);
  if (error) return <main className="page"><TopBar title="Local" back="/" /><ErrorBox text={error} retry={reload} /></main>;
  if (!data) return <main className="page"><TopBar title="Local" back="/" /><Loading /></main>;

  const { shop, products } = data;
  const current = category && categories.includes(category) ? category : categories[0];
  const inThisShop = cart.shopId === shop.id;
  const qtyOf = (pid: number) => (inThisShop ? (cart.lines.find((l) => l.productId === pid)?.qty ?? 0) : 0);

  return (
    <main className="page has-cartbar">
      <TopBar title={shop.name} back="/" />
      <section className="shop-head">
        <span className="avatar avatar-lg" aria-hidden>
          {shop.emoji}
        </span>
        <div>
          <p>{shop.description}</p>
          <p className="muted">
            {shop.location && `${shop.location} · `}
            {hhmm(shop.opens)} a {hhmm(shop.closes)}
          </p>
        </div>
      </section>
      {shop.paused ? (
        <p className="notice notice-warn">Este local no está recibiendo pedidos en este momento.</p>
      ) : shop.next_slot ? (
        <p className="notice">
          Próximo retiro disponible:{' '}
          <strong>
            {shop.next_slot.day === 'manana' ? 'mañana a las ' : 'hoy a las '}
            {shop.next_slot.time}
          </strong>
        </p>
      ) : (
        <p className="notice notice-warn">No quedan horas de retiro disponibles.</p>
      )}

      {products.length === 0 && <p className="muted center">Este local todavía no publica su menú.</p>}
      {categories.length > 1 && (
        <div className="chips" role="tablist">
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
                <span className="avatar" aria-hidden>
                  {p.emoji}
                </span>
                <div className="grow">
                  <strong>{p.name}</strong>
                  {p.description && <span className="muted">{p.description}</span>}
                  <span className="price">{money(p.price)}</span>
                </div>
                {!p.available ? (
                  <span className="tag tag-off">Agotado</span>
                ) : qty > 0 ? (
                  <Stepper qty={qty} onChange={(q) => setQty(p.id, q)} label={p.name} />
                ) : (
                  <button className="btn btn-add" disabled={shop.paused} onClick={() => addToCart(shop, p)}>
                    Agregar
                  </button>
                )}
              </li>
            );
          })}
      </ul>

      {inThisShop && cartCount > 0 && (
        <Link to="/carrito" className="cartbar">
          <span>
            Ver carrito · {cartCount} {cartCount === 1 ? 'producto' : 'productos'}
          </span>
          <strong>{money(cartTotal)}</strong>
        </Link>
      )}
    </main>
  );
}

// ---------- Carrito, hora de retiro y pago ----------
const PAYMENT_ICON: Record<Payment, string> = { tarjeta: '💳', junaeb: '🍏', efectivo: '💵' };

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

export function Checkout() {
  const { cart, cartTotal, setQty, clearCart } = useApp();
  const navigate = useNavigate();
  const shopId = cart.shopId;
  const slots = useLoad(() => (shopId ? api<Slot[]>(`/shops/${shopId}/slots`) : Promise.resolve([])), [shopId]);
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
        <div className="card center empty">
          <span className="big" aria-hidden>
            🛒
          </span>
          <p>
            <strong>Tu carrito está vacío</strong>
          </p>
          <p className="muted">Elige un local y agrega lo que quieras retirar.</p>
          <Link to="/" className="btn btn-primary">
            Ver locales
          </Link>
        </div>
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
    <main className="page">
      <TopBar title="Carrito" back={`/local/${shopId}`} />
      <p className="muted">
        Pedido para <strong>{cart.shopName}</strong>
      </p>
      <ul className="list">
        {cart.lines.map((l) => (
          <li key={l.productId} className="card product">
            <span className="avatar" aria-hidden>
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

      <h2 className="section">¿A qué hora lo retiras?</h2>
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

      <h2 className="section">¿Cómo pagas?</h2>
      <div className="options" role="radiogroup" aria-label="Método de pago">
        {(Object.keys(PAYMENT_LABEL) as Payment[]).map((p) => (
          <button key={p} role="radio" aria-checked={payment === p} className={payment === p ? 'on' : ''} onClick={() => setPayment(p)}>
            <span aria-hidden>{PAYMENT_ICON[p]}</span>
            {PAYMENT_LABEL[p]}
          </button>
        ))}
      </div>
      <p className="muted small">
        {payment === 'efectivo'
          ? 'Pagas en caja al retirar tu pedido.'
          : 'Demo: el pago es simulado, no se hace ningún cobro real.'}
      </p>

      <label className="field">
        Nota para el local <span className="optional">(opcional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ej.: sin mayonesa" />
      </label>

      <div className="card summary">
        <div>
          <span>Retiro</span>
          <strong>{slot ? slotLabel(slot) : 'Elige una hora'}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong className="total">{money(cartTotal)}</strong>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !slot} onClick={confirm}>
        {busy ? 'Enviando…' : `Confirmar pedido · ${money(cartTotal)}`}
      </button>
    </main>
  );
}

// ---------- Mis pedidos ----------
export function Orders() {
  const { data, error, reload } = useLoad(() => api<Order[]>('/orders'), []);
  useOrderEvents(reload);
  const active = (data ?? []).filter((o) => isActive(o.status));
  const past = (data ?? []).filter((o) => !isActive(o.status));
  const row = (o: Order) => (
    <li key={o.id}>
      <Link to={`/pedidos/${o.id}`} className="card order-row">
        <span className="avatar" aria-hidden>
          {o.shop_emoji}
        </span>
        <div className="grow">
          <strong>{o.shop_name}</strong>
          <span className="muted">
            {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
          </span>
          <span className="muted">
            Retiro {slotLabel(o.slot).toLowerCase()} · {money(o.total)}
          </span>
        </div>
        <StatusPill status={o.status} />
      </Link>
    </li>
  );
  return (
    <main className="page">
      <TopBar title="Mis pedidos" />
      {error && <ErrorBox text={error} retry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && (
        <div className="card center empty">
          <span className="big" aria-hidden>
            🧾
          </span>
          <p>
            <strong>Aún no tienes pedidos</strong>
          </p>
          <Link to="/" className="btn btn-primary">
            Hacer mi primer pedido
          </Link>
        </div>
      )}
      {active.length > 0 && <h2 className="section">En curso</h2>}
      {active.length > 0 && <ul className="list">{active.map(row)}</ul>}
      {past.length > 0 && <h2 className="section">Anteriores</h2>}
      {past.length > 0 && <ul className="list">{past.map(row)}</ul>}
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
};

export function OrderDetail() {
  const { id } = useParams();
  const { replaceCart, toast } = useApp();
  const navigate = useNavigate();
  const { data: o, error, reload, setData } = useLoad(() => api<Order>(`/orders/${id}`), [id]);
  const [qr, setQr] = useState('');
  useOrderEvents((e) => {
    if (e.order.id === Number(id)) setData(e.order);
  });
  // Respaldo por si se corta la conexión en vivo.
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (o?.code) QRCode.toDataURL(o.code, { margin: 1, width: 440 }).then(setQr, () => setQr(''));
  }, [o?.code]);

  if (error) return <main className="page"><TopBar title="Pedido" back="/pedidos" /><ErrorBox text={error} retry={reload} /></main>;
  if (!o) return <main className="page"><TopBar title="Pedido" back="/pedidos" /><Loading /></main>;

  const at = (s: Status) => o.events.find((e) => e.status === s)?.at;
  const reached = STEPS.indexOf(o.status);
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
      <TopBar title={`Pedido ${o.code}`} back="/pedidos" />
      <section className={`card status-card status-${o.status}`}>
        <StatusPill status={o.status} />
        <h2>{HEADLINE[o.status]}</h2>
        <p>
          {o.shop_emoji} {o.shop_name}
          {o.shop_location && ` · ${o.shop_location}`}
        </p>
        <p className="pickup">
          Retiro: <strong>{slotLabel(o.slot)}</strong>
        </p>
      </section>

      {isActive(o.status) && (
        <section className="card center ticket">
          <p className="muted">Muestra este código en el local para retirar</p>
          {qr && <img src={qr} alt={`Código QR del pedido ${o.code}`} width={220} height={220} />}
          <p className="code">{o.code}</p>
        </section>
      )}

      {o.status !== 'cancelado' && (
        <ol className="card timeline">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= reached ? 'done' : ''}>
              <span className="dot" aria-hidden>
                {i <= reached ? '✓' : ''}
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
                {i.qty}× {i.name}
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
      {!isActive(o.status) && (
        <button className="btn btn-soft btn-block" onClick={repeat}>
          Repetir este pedido
        </button>
      )}
    </main>
  );
}

// ---------- Perfil ----------
export function Profile() {
  const { user, setUser, logout, toast } = useApp();
  const [campusId, setCampusId] = useState(String(user!.campus_id ?? ''));
  const [perm, setPerm] = useState<string>('Notification' in window ? Notification.permission : 'unsupported');

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
      <section className="card">
        <strong>{user!.name}</strong>
        <p className="muted">{user!.email}</p>
      </section>
      <label className="field">
        Tu sede
        <CampusSelect value={campusId} onChange={changeCampus} />
      </label>
      <NotificationsCard perm={perm} setPerm={setPerm} text="Recibe un aviso cuando tu pedido esté listo." />
      <button className="btn btn-soft btn-block" onClick={logout}>
        Cerrar sesión
      </button>
    </main>
  );
}

export function NotificationsCard({ perm, setPerm, text }: { perm: string; setPerm: (p: string) => void; text: string }) {
  return (
    <section className="card">
      <strong>Avisos</strong>
      <p className="muted">
        {text} Dentro de la app los avisos llegan siempre; las notificaciones del navegador funcionan mientras tengas
        Pick&amp;Go abierto en una pestaña.
      </p>
      {perm === 'default' && (
        <button className="btn btn-soft" onClick={() => Notification.requestPermission().then(setPerm)}>
          Activar notificaciones
        </button>
      )}
      {perm === 'granted' && <span className="tag tag-on">Notificaciones activadas</span>}
      {perm === 'denied' && (
        <span className="tag tag-off">Bloqueadas en este navegador. Actívalas desde los ajustes del sitio.</span>
      )}
      {perm === 'unsupported' && <span className="tag tag-off">Este navegador no admite notificaciones</span>}
    </section>
  );
}
