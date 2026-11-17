import {
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  MapPin,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  TriangleAlert,
  User as UserIcon,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  isOpenOrder,
  optionsText,
  paymentText,
  relativeTime,
  slotDay,
  slotLabel,
  STATUS_LABEL,
  type Order,
  type OptionGroup,
  type Product,
  type Shop,
  type Slot,
  type Status,
  type User,
} from '../lib';
import { useApp, useLoad, useOrderEvents, useTick } from '../state';
import { Empty, ErrorBox, Loading, Logo, ProductTile, Rating, Sheet, StarsInput, StatusPill, TopBar } from '../ui';
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
  pago_pendiente: 'Falta pagar',
  recibido: 'Esperando al local',
  preparando: 'Aceptado, en preparación',
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
          {o.status === 'listo'
            ? `Muestra el código ${o.code}`
            : o.status === 'pago_pendiente'
              ? `Paga ${money(o.total)} para enviarlo`
              : `Retiro ${relativeTime(o.slot)}`}
        </span>
      </div>
      <div className="ticket-stub">
        <span>{slotDay(o.slot)}</span>
        <b>{o.slot.slice(11)}</b>
      </div>
    </Link>
  );
}

interface SearchHit {
  id: number;
  name: string;
  price: number;
  emoji: string;
  image: string | null;
  shop_id: number;
  shop_name: string;
}

/** Abre el pago: la pantalla de prueba dentro de la app, o la página de Mercado Pago. */
export function goToPayment(url: string, navigate: (to: string) => void) {
  if (url.startsWith('/')) navigate(url);
  else if (/^https:\/\/([a-z0-9-]+\.)*mercadopago\.(cl|com)\//i.test(url)) window.location.assign(url);
}

/** Pantalla de pago de prueba (modo simulado): permite recorrer todo el flujo sin mover dinero. */
export function TestPayment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const { data: o, error, reload } = useLoad(() => api<Order>(`/orders/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const r = await api<Order>(`/orders/${id}/simulate-payment`, 'POST', { approve });
      if (!approve) toast('Pago rechazado. Puedes intentarlo de nuevo.', 'error');
      navigate(`/pedidos/${r.id}`, { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
      setBusy(false);
    }
  };
  if (error)
    return (
      <main className="page">
        <TopBar title="Pago" back="/pedidos" />
        <ErrorBox text={error} retry={reload} />
      </main>
    );
  if (!o)
    return (
      <main className="page">
        <TopBar title="Pago" back="/pedidos" />
        <Loading />
      </main>
    );
  return (
    <main className="page">
      <TopBar title="Pago de prueba" back={`/pedidos/${o.id}`} />
      <p className="notice notice-warn">
        <TriangleAlert size={18} aria-hidden />
        <span>Marcha blanca: esta pantalla reemplaza al pago real. No se cobra dinero.</span>
      </p>
      <section className="card stack">
        <span className="muted">
          {o.shop_name} · Pedido {o.code}
        </span>
        <ul className="lines">
          {o.items.map((i) => (
            <li key={i.id}>
              <span>
                <b>{i.qty}×</b> {i.name}
              </span>
              <span>{money(i.price * i.qty)}</span>
            </li>
          ))}
          <li className="lines-total">
            <span>Total a pagar</span>
            <span>{money(o.total)}</span>
          </li>
        </ul>
      </section>
      {o.status === 'pago_pendiente' ? (
        <>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => decide(true)}>
            <CreditCard size={18} aria-hidden /> Aprobar pago de prueba
          </button>
          <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => decide(false)}>
            Simular pago rechazado
          </button>
        </>
      ) : (
        <Link to={`/pedidos/${o.id}`} className="btn btn-dark btn-block">
          Este pedido ya no tiene un pago pendiente
        </Link>
      )}
    </main>
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
  const active = (orders.data ?? []).filter((o) => isOpenOrder(o.status));
  const last = (orders.data ?? []).find((o) => o.status === 'entregado');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const searching = query.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    setResults(null);
    let alive = true;
    // Espera a que la persona deje de escribir antes de consultar.
    const t = setTimeout(() => {
      api<SearchHit[]>(`/campuses/${campusId}/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, searching, campusId]);

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

      <label className="search">
        <Search size={20} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca un producto: café, almuerzo…"
          aria-label="Buscar productos en tu sede"
          maxLength={40}
          enterKeyHint="search"
        />
      </label>
      {searching && (
        <section className="stack" aria-live="polite">
          {results === null ? (
            <Loading />
          ) : results.length === 0 ? (
            <p className="muted center">No encontramos «{query.trim()}» en los locales de tu sede.</p>
          ) : (
            <ul className="list">
              {results.map((r) => (
                <li key={r.id}>
                  <Link to={`/local/${r.shop_id}`} className="card product">
                    <ProductTile image={r.image} emoji={r.emoji} />
                    <span className="grow">
                      <strong>{r.name}</strong>
                      <span className="muted">{r.shop_name}</span>
                      <span className="price">{money(r.price)}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!searching && last && active.length === 0 && (
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

      {!searching && <h2 className="section">Locales en tu sede</h2>}
      {shops.error && <ErrorBox text={shops.error} retry={shops.reload} />}
      {!shops.data && !shops.error && <Loading />}
      {shops.data?.length === 0 && (
        <Empty
          icon={<Store size={28} />}
          title="Todavía no hay locales en esta sede"
          text="Si conoces un local, cuéntale que puede sumarse gratis desde la pantalla de ingreso."
        />
      )}
      <ul className="list" hidden={searching}>
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

/** Elegir las opciones de un producto (tamaño, agregados…) antes de sumarlo al carrito. */
function OptionsSheet({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (choices: string[]) => void }) {
  // Los grupos obligatorios de elección única parten con la primera alternativa marcada.
  const [picked, setPicked] = useState<string[]>(() =>
    product.options.filter((g) => g.required && !g.multiple).map((g) => g.choices[0].id),
  );
  const toggle = (g: OptionGroup, id: string) =>
    setPicked((cur) => {
      if (g.multiple) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      const others = cur.filter((x) => !g.choices.some((c) => c.id === x));
      return cur.includes(id) && !g.required ? others : [...others, id];
    });
  const missing = product.options.find((g) => g.required && !g.choices.some((c) => picked.includes(c.id)));
  const total =
    product.price + product.options.flatMap((g) => g.choices).reduce((n, c) => n + (picked.includes(c.id) ? c.price : 0), 0);
  return (
    <Sheet title={product.name} onClose={onClose}>
      {product.image && <img className="product-photo" src={product.image} alt={product.name} />}
      {product.description && <p className="muted">{product.description}</p>}
      {product.options.map((g) => (
        <section key={g.id} className="opt-group">
          <h3>
            {g.name}
            <small className={g.required ? 'req' : ''}>
              {g.required ? 'Obligatorio' : 'Opcional'}
              {g.multiple ? ' · varias' : ' · elige una'}
            </small>
          </h3>
          {g.choices.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                role={g.multiple ? 'checkbox' : 'radio'}
                aria-checked={on}
                className={`opt-choice ${on ? 'on' : ''}`}
                onClick={() => toggle(g, c.id)}
              >
                <span className="radio" aria-hidden>
                  {on && <Check size={14} strokeWidth={3} />}
                </span>
                <span className="grow">{c.name}</span>
                {c.price > 0 && <span className="muted">+{money(c.price)}</span>}
              </button>
            );
          })}
        </section>
      ))}
      <button className="btn btn-primary btn-block" disabled={!!missing} onClick={() => onAdd(picked)}>
        {missing ? `Elige ${missing.name.toLowerCase()}` : `Agregar · ${money(total)}`}
      </button>
    </Sheet>
  );
}

export function ShopPage() {
  const { id } = useParams();
  const { cart, cartCount, cartTotal, addToCart, setQty } = useApp();
  const { data, error, reload } = useLoad(() => api<{ shop: Shop; products: Product[] }>(`/shops/${id}`), [id]);
  const [category, setCategory] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Product | null>(null);
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
  const qtyOf = (pid: number) =>
    inThisShop ? cart.lines.filter((l) => l.productId === pid).reduce((n, l) => n + l.qty, 0) : 0;

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
            const hasOptions = p.options.length > 0;
            return (
              <li key={p.id} className={`card product ${p.available ? '' : 'soldout'}`}>
                <ProductTile image={p.image} emoji={p.emoji} />
                <div className="grow">
                  <strong>{p.name}</strong>
                  {p.description && <span className="muted clamp">{p.description}</span>}
                  <span className="price">
                    {hasOptions && p.options.some((g) => g.choices.some((c) => c.price > 0)) ? 'Desde ' : ''}
                    {money(p.price)}
                  </span>
                </div>
                {!p.available ? (
                  <span className="tag tag-off">Agotado</span>
                ) : qty > 0 && !hasOptions ? (
                  <Stepper qty={qty} onChange={(q) => setQty(`${p.id}:`, q)} label={p.name} />
                ) : (
                  <button
                    className="add"
                    disabled={shop.paused}
                    onClick={() => (hasOptions ? setChoosing(p) : addToCart(shop, p))}
                    aria-label={`Agregar ${p.name}`}
                  >
                    {qty > 0 ? <b>{qty}</b> : <Plus size={22} />}
                  </button>
                )}
              </li>
            );
          })}
      </ul>

      {choosing && (
        <OptionsSheet
          product={choosing}
          onClose={() => setChoosing(null)}
          onAdd={(choices) => {
            if (addToCart(shop, choosing, choices)) setChoosing(null);
          }}
        />
      )}

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

// ---------- Carrito y hora de retiro ----------
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
  const { payments } = useApp();
  const shopInfo = useLoad(() => (shopId ? api<{ shop: Shop }>(`/shops/${shopId}`) : Promise.resolve(null)), [shopId]);
  const payAtShop = !payments || !!shopInfo.data?.shop.pay_at_shop;
  const [slot, setSlot] = useState('');
  const [method, setMethod] = useState<'app' | 'local'>('app');
  const payMethod = payments ? (payAtShop ? method : 'app') : 'local';
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
        note,
        paymentMethod: payMethod,
        items: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, choices: l.choices })),
      });
      clearCart();
      if (order.pay_url) {
        // El pedido queda guardado: si el pago se interrumpe, se puede retomar desde "Mis pedidos".
        navigate(`/pedidos/${order.id}`, { replace: true });
        goToPayment(order.pay_url, navigate);
        return;
      }
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
          <li key={l.key} className="card product">
            <ProductTile image={l.image} emoji={l.emoji} />
            <div className="grow">
              <strong>{l.name}</strong>
              {l.detail && <span className="muted">{l.detail}</span>}
              <span className="price">{money(l.price * l.qty)}</span>
            </div>
            <Stepper qty={l.qty} onChange={(q) => setQty(l.key, q)} label={l.name} />
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

      <StepTitle n={3}>Pago</StepTitle>
      {payments ? (
        <div className="options" role="radiogroup" aria-label="Cómo pagas">
          <button role="radio" aria-checked={payMethod === 'app'} className={payMethod === 'app' ? 'on' : ''} onClick={() => setMethod('app')}>
            <span className="option-icon" aria-hidden>
              <CreditCard size={22} />
            </span>
            <span className="grow">
              Pagar ahora en la app
              <small>{payments === 'simulado' ? 'Pago de prueba: no se cobra dinero real.' : 'Con Mercado Pago: tarjeta, débito o saldo.'}</small>
            </span>
            <span className="radio" aria-hidden>
              {payMethod === 'app' && <Check size={14} strokeWidth={3} />}
            </span>
          </button>
          {payAtShop && (
            <button role="radio" aria-checked={payMethod === 'local'} className={payMethod === 'local' ? 'on' : ''} onClick={() => setMethod('local')}>
              <span className="option-icon" aria-hidden>
                <Store size={22} />
              </span>
              <span className="grow">
                Pagar en el local al retirar
                <small>Con el medio de pago que acepte el local.</small>
              </span>
              <span className="radio" aria-hidden>
                {payMethod === 'local' && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
          )}
        </div>
      ) : (
        <section className="card pay-note">
          <span className="option-icon" aria-hidden>
            <Store size={22} />
          </span>
          <div className="grow">
            <strong>Pagas en el local al retirar</strong>
            <p className="muted">Al retirar pagas {money(cartTotal)} con el medio que acepte el local.</p>
          </div>
        </section>
      )}
      {user!.can_order === false && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>Tienes varios pedidos sin retirar en los últimos 30 días, así que por ahora no puedes hacer pedidos nuevos.</span>
        </p>
      )}

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
        <button className="btn btn-primary" disabled={busy || !slot || user!.can_order === false} onClick={confirm}>
          {busy ? 'Enviando…' : payMethod === 'app' ? `Pagar ${money(cartTotal)}` : 'Confirmar pedido'}
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
  const active = (data ?? []).filter((o) => isOpenOrder(o.status));
  const past = (data ?? []).filter((o) => !isOpenOrder(o.status));
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
  pago_pendiente: 'Falta pagar tu pedido',
  recibido: 'Esperando que el local acepte',
  preparando: 'Aceptado: lo están preparando',
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
  // Al volver del pago (o al abrir un pedido que falta pagar) se consulta el resultado al servidor.
  const pendingPay = o?.status === 'pago_pendiente';
  useEffect(() => {
    if (!pendingPay) return;
    let tries = 0;
    const check = () =>
      api<Order>(`/orders/${id}/payment/check`, 'POST')
        .then(setData)
        .catch(() => {});
    void check();
    // Mercado Pago puede tardar unos segundos en confirmar.
    const t = setInterval(() => (++tries > 6 ? clearInterval(t) : void check()), 5000);
    return () => clearInterval(t);
  }, [pendingPay, id, setData]);
  const [paying, setPaying] = useState(false);
  const payNow = async () => {
    setPaying(true);
    try {
      const r = await api<{ pay_url: string }>(`/orders/${id}/pay`, 'POST');
      goToPayment(r.pay_url, navigate);
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setPaying(false);
  };
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
      lines: o.items.map((i) => ({
        key: `${i.product_id}:${i.options.map((c) => c.id).sort().join(',')}`,
        productId: i.product_id,
        choices: i.options.map((c) => c.id),
        detail: optionsText(i.options),
        image: null,
        name: i.name,
        emoji: i.emoji,
        price: i.price,
        qty: i.qty,
      })),
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

      {o.status === 'cancelado' && o.cancel_reason && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>
            {o.shop_name} canceló el pedido: {o.cancel_reason}
          </span>
        </p>
      )}
      {o.status === 'no_retirado' && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>El local lo preparó y nadie pasó a buscarlo. Con tres pedidos sin retirar en 30 días, se suspenden los pedidos nuevos de tu cuenta.</span>
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
            <li key={i.id}>
              <span>
                <b>{i.qty}×</b> {i.name}
                {i.options.length > 0 && <small className="item-options">{optionsText(i.options)}</small>}
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
          {paymentText(o)}
        </p>
      </section>

      {o.status === 'pago_pendiente' && (
        <section className="card pay-note">
          <span className="option-icon" aria-hidden>
            <CreditCard size={22} />
          </span>
          <div className="grow stack">
            <strong>Tu hora está reservada mientras pagas</strong>
            <p className="muted">
              El local recibe el pedido apenas se confirme el pago. Si no se paga en unos minutos, la reserva se libera.
            </p>
            <button className="btn btn-primary btn-block" onClick={payNow} disabled={paying}>
              {paying ? 'Abriendo el pago…' : `Pagar ${money(o.total)}`}
            </button>
          </div>
        </section>
      )}
      {(o.status === 'recibido' || o.status === 'pago_pendiente') && (
        <button className="btn btn-danger btn-block" onClick={cancel}>
          Cancelar pedido
        </button>
      )}
      {o.status === 'recibido' && o.payment_method === 'app' && (
        <p className="muted small center">Si cancelas antes de que el local lo acepte, te devolvemos el pago.</p>
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
  const [name, setName] = useState(user!.name);
  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setUser(await api<User>('/me', 'PATCH', { name }));
      toast('Nombre actualizado', 'ok');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

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
      <form className="field" onSubmit={saveName}>
        <label htmlFor="profile-name">Tu nombre (así te ve el local)</label>
        <div className="inline-form">
          <input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" required />
          <button className="btn btn-dark" disabled={name.trim() === user!.name || !name.trim()}>
            Guardar
          </button>
        </div>
      </form>
      <label className="field">
        Tu sede
        <CampusSelect value={campusId} onChange={changeCampus} />
      </label>
      <AccountSettings notifyText="Te avisamos cuando tu pedido esté listo, aunque tengas la app cerrada." />
    </main>
  );
}
