import {
  Percent,
  Heart,
  Gift,
  Check,
  Coffee,
  Trash2,
  Wallet,
  ChevronRight,
  Clock,
  CreditCard,
  MapPin,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
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
  BAES,
  baesName,
  breakFor,
  daysText,
  nextBreak,
  WEEK,
  toMinutes,
  type Break,
  type PaymentMethod,
  chileNow,
  shortDay,
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
  type Loyalty,
  type OptionGroup,
  type Quote,
  promoText,
  type Product,
  type Shop,
  type Slot,
  type Status,
  type User,
} from '../lib';
import { BRAND } from '../brand';
import { useApp, useLoad, useOrderEvents, useTick } from '../state';
import { Empty, ErrorBox, Loading, Logo, ProductTile, Rating, Sheet, ShopLogo, StampCard, StarsInput, StatusPill, TopBar } from '../ui';
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

/** El próximo recreo del estudiante: la razón de ser de la app es que alcance a comer en él. */
function BreakCard({ breaks }: { breaks: Break[] | undefined }) {
  const next = nextBreak(breaks);
  if (!breaks?.length)
    return (
      <Link to="/perfil#recreos" className="card break-card break-empty">
        <Coffee size={22} aria-hidden />
        <span className="grow">
          <strong>¿Cuándo son tus recreos?</strong>
          <span className="muted">Guárdalos y te proponemos la hora justa para retirar, sin perder ni un minuto.</span>
        </span>
        <ChevronRight size={18} aria-hidden />
      </Link>
    );
  if (!next) return null;
  const range = `${hhmm(next.from)} a ${hhmm(next.to)}`;
  const minutes = next.from - chileNow().minutes;
  const when = slotDay(`${next.date}T00:00`) === 'Mañana' ? 'mañana' : shortDay(next.date);
  return (
    <section className="break-card card" aria-label="Tu próximo recreo">
      <Coffee size={22} aria-hidden />
      <span className="grow">
        <span className="break-kicker">{next.ongoing ? 'Estás en recreo' : next.today ? 'Tu próximo recreo' : `Próximo recreo: ${when}`}</span>
        <strong>
          {range}
          {next.today && !next.ongoing && minutes > 0 && <small> · en {minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}</small>}
        </strong>
        <span className="muted">
          {next.ongoing ? 'Pide ahora: te mostramos la hora más cercana para retirar.' : 'Pide ahora y te proponemos retirar justo al empezar tu recreo.'}
        </span>
      </span>
    </section>
  );
}

// ---------- Inicio: locales de la sede ----------
export function Home() {
  const { user } = useApp();
  const campusId = user!.campus_id;
  const shops = useLoad(() => api<Shop[]>(`/campuses/${campusId}/shops`), [campusId]);
  const orders = useLoad(() => api<Order[]>('/orders'), []);
  const favorites = useLoad(() => api<(Product & { shop_name: string })[]>('/favorites'), [campusId]);
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
      [...(shops.data ?? [])].sort(
        (a, b) => (a.next_slot?.slot ?? '9999').localeCompare(b.next_slot?.slot ?? '9999') || a.name.localeCompare(b.name),
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

      {active.length === 0 && <BreakCard breaks={user!.breaks} />}

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

      {!searching && (favorites.data?.length ?? 0) > 0 && (
        <section aria-label="Tus favoritos">
          <h2 className="section">Tus favoritos</h2>
          <div className="fav-row">
            {favorites.data!.map((f) => (
              <Link key={f.id} to={`/local/${f.shop_id}`} className="fav-card">
                <ProductTile image={f.image} emoji={f.emoji} />
                <strong>{f.name}</strong>
                <span className="muted">{f.shop_name}</span>
                <span className="price">{money(f.price)}</span>
              </Link>
            ))}
          </div>
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
                <ShopLogo shop={s} />
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
  const { data, error, reload } = useLoad(() => api<{ shop: Shop; products: Product[]; loyalty: Loyalty | null }>(`/shops/${id}`), [id]);
  const [category, setCategory] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Product | null>(null);
  const favs = useLoad(() => api<Product[]>('/favorites'), []);
  const favIds = new Set((favs.data ?? []).map((f) => f.id));
  const toggleFav = async (p: Product) => {
    try {
      await api(`/favorites/${p.id}`, favIds.has(p.id) ? 'DELETE' : 'POST');
    } catch {
      /* sin conexión: se reintenta al volver */
    }
    favs.reload();
  };
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
        <ShopLogo shop={shop} large />
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
            {shop.accepts_baes && (
              <span>
                <Wallet size={13} aria-hidden /> Acepta Junaeb
              </span>
            )}
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

      {shop.promos.length > 0 && !shop.paused && (
        <section className="promo-strip" aria-label="Promociones">
          <Percent size={18} aria-hidden />
          <span>{shop.promos.map(promoText).join(' · ')}</span>
        </section>
      )}
      {data.loyalty && <StampCard shop={shop} card={data.loyalty} />}

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
                <button
                  className={`fav ${favIds.has(p.id) ? 'on' : ''}`}
                  aria-pressed={favIds.has(p.id)}
                  aria-label={favIds.has(p.id) ? `Quitar ${p.name} de favoritos` : `Guardar ${p.name} en favoritos`}
                  onClick={() => toggleFav(p)}
                >
                  <Heart size={20} fill={favIds.has(p.id) ? 'currentColor' : 'none'} />
                </button>
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
function SlotPicker({ slots, value, onChange, breaks }: { slots: Slot[]; value: string; onChange: (s: string) => void; breaks?: Break[] }) {
  const hasToday = slots.some((s) => s.day === 'hoy');
  const chosenDay = slots.find((s) => s.slot === value)?.day;
  const [day, setDay] = useState<'hoy' | 'manana'>(chosenDay ?? (hasToday ? 'hoy' : 'manana'));
  // Si la hora propuesta cae mañana, se muestra ese día.
  useEffect(() => {
    if (chosenDay) setDay(chosenDay);
  }, [chosenDay]);
  const shown = slots.filter((s) => s.day === day);
  const anyBreak = shown.some((s) => breakFor(breaks, s.slot));
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
              aria-label={breakFor(breaks, s.slot) ? `${s.time}, en tu recreo` : undefined}
              className={`${value === s.slot ? 'on' : ''} ${breakFor(breaks, s.slot) ? 'in-break' : ''}`}
              disabled={s.remaining === 0}
              onClick={() => onChange(s.slot)}
            >
              {s.time}
              {s.remaining === 0 ? (
                <small>Lleno</small>
              ) : s.promo ? (
                <small className="promo">−{s.promo} %</small>
              ) : s.remaining <= 2 ? (
                <small>Quedan {s.remaining}</small>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {anyBreak && (
        <p className="slots-legend">
          <span className="legend-dot" aria-hidden /> Horas dentro de tus recreos
        </p>
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
  // La anticipación depende de lo que hay en el carrito (cada producto puede necesitar más tiempo).
  const productKey = [...new Set(cart.lines.map((l) => l.productId))].sort((a, b) => a - b).join(',');
  const slots = useLoad(
    () => (shopId ? api<Slot[]>(`/shops/${shopId}/slots?products=${productKey}`) : Promise.resolve([])),
    [shopId, productKey],
  );
  const { payments, demo } = useApp();
  const [reviewing, setReviewing] = useState(false);
  const shopInfo = useLoad(() => (shopId ? api<{ shop: Shop }>(`/shops/${shopId}`) : Promise.resolve(null)), [shopId]);
  const shopData = shopInfo.data?.shop;
  const payAtShop = !payments || !!shopData?.pay_at_shop;
  const acceptsBaes = !!shopData?.accepts_baes;
  const [slot, setSlot] = useState('');
  const [proposed, setProposed] = useState('');
  // Pagar al retirar exige confianza (un pedido sin pagar a la vez y sin pedidos sin retirar recientes).
  const payLater = !user!.pay_later_problem;
  // Medios disponibles en este local, en orden: en la app, Junaeb y en el local.
  const methods: PaymentMethod[] = [
    ...(payments ? (['app'] as const) : []),
    ...(acceptsBaes && payLater ? (['junaeb'] as const) : []),
    ...(payAtShop && payLater ? (['local'] as const) : []),
  ];
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  // Quien tiene beca parte con ella propuesta; si no, el primer medio disponible.
  const payMethod: PaymentMethod = method && methods.includes(method) ? method : user!.baes && methods.includes('junaeb') ? 'junaeb' : methods[0] ?? 'local';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [useReward, setUseReward] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  // El precio final (promociones y premio) lo calcula el servidor; aquí solo se muestra.
  const itemsKey = JSON.stringify(cart.lines.map((l) => [l.productId, l.qty, l.choices]));
  useEffect(() => {
    if (!shopId || cart.lines.length === 0) return;
    let alive = true;
    const t = setTimeout(() => {
      api<Quote>('/orders/quote', 'POST', {
        shopId,
        slot,
        useReward,
        items: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, choices: l.choices })),
      })
        .then((q) => alive && setQuote(q))
        .catch(() => {
          if (!alive) return;
          setQuote(null);
          if (useReward) setUseReward(false);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, slot, useReward, itemsKey]);
  const total = quote?.total ?? cartTotal;

  // Por defecto se propone la primera hora con cupo dentro de un recreo de hoy; si no hay, la primera con cupo.
  // El camino rápido es confirmar y listo.
  useEffect(() => {
    if (!slots.data) return;
    const valid = slots.data.find((s) => s.slot === slot && s.remaining > 0);
    if (valid) return;
    const open = slots.data.filter((s) => s.remaining > 0);
    const inBreak = open.find((s) => s.day === 'hoy' && breakFor(user!.breaks, s.slot));
    const pick = inBreak ?? open[0];
    setSlot(pick?.slot ?? '');
    setProposed(inBreak ? inBreak.slot : '');
  }, [slots.data, slot, user]);

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
        useReward,
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
          <SlotPicker slots={slots.data} value={slot} onChange={setSlot} breaks={user!.breaks} />
        )}
      </div>
      {proposed && slot === proposed && breakFor(user!.breaks, proposed) && (
        <p className="notice notice-break">
          <Coffee size={18} aria-hidden />
          <span>
            Te propusimos las <strong>{proposed.slice(11)}</strong>, dentro de tu recreo de {hhmm(breakFor(user!.breaks, proposed)!.from)} a{' '}
            {hhmm(breakFor(user!.breaks, proposed)!.to)}: llegas, retiras y te queda tiempo para comer.
          </span>
        </p>
      )}

      {quote?.loyalty && quote.loyalty.rewards > 0 && (
        <button className={`reward-toggle ${useReward ? 'on' : ''}`} role="switch" aria-checked={useReward} onClick={() => setUseReward(!useReward)}>
          <Gift size={22} aria-hidden />
          <span className="grow">
            <strong>{useReward ? 'Premio aplicado' : 'Usar mi premio'}</strong>
            <small>Un producto gratis hasta {money(quote.loyalty.max)}</small>
          </span>
          <span className="radio" aria-hidden>
            {useReward && <Check size={14} strokeWidth={3} />}
          </span>
        </button>
      )}

      {quote && (quote.promo_discount > 0 || quote.reward_discount > 0) && (
        <section className="card">
          <ul className="lines">
            <li>
              <span>Subtotal</span>
              <span>{money(quote.subtotal)}</span>
            </li>
            {quote.reward_discount > 0 && (
              <li className="saving">
                <span>Premio de la tarjeta de sellos</span>
                <span>−{money(quote.reward_discount)}</span>
              </li>
            )}
            {quote.promo_discount > 0 && (
              <li className="saving">
                <span>Promoción {quote.promo_percent} % por tu hora de retiro</span>
                <span>−{money(quote.promo_discount)}</span>
              </li>
            )}
            <li className="lines-total">
              <span>Total</span>
              <span>{money(quote.total)}</span>
            </li>
          </ul>
        </section>
      )}

      <StepTitle n={3}>Pago</StepTitle>
      {methods.length > 1 ? (
        <div className="options" role="radiogroup" aria-label="Cómo pagas">
          {methods.includes('app') && (
            <button role="radio" aria-checked={payMethod === 'app'} className={payMethod === 'app' ? 'on' : ''} onClick={() => setMethod('app')}>
              <span className="option-icon" aria-hidden>
                <CreditCard size={22} />
              </span>
              <span className="grow">
                Pagar ahora en la app
                <small>{payments === 'simulado' ? 'Pago de prueba: no se cobra dinero real.' : 'Con Mercado Pago: tarjeta, débito o saldo.'} Llegas y retiras.</small>
              </span>
              <span className="radio" aria-hidden>
                {payMethod === 'app' && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
          )}
          {methods.includes('junaeb') && (
            <button role="radio" aria-checked={payMethod === 'junaeb'} className={`baes-option ${payMethod === 'junaeb' ? 'on' : ''}`} onClick={() => setMethod('junaeb')}>
              <span className="option-icon" aria-hidden>
                <Wallet size={22} />
              </span>
              <span className="grow">
                Junaeb al retirar
                <small>En el mesón, con {baesName(shopData?.baes_operator)}. Tu pedido ya está listo: pagas y te vas.</small>
              </span>
              <span className="radio" aria-hidden>
                {payMethod === 'junaeb' && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
          )}
          {methods.includes('local') && (
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
      ) : payMethod === 'junaeb' ? (
        <section className="card pay-note">
          <span className="option-icon" aria-hidden>
            <Wallet size={22} />
          </span>
          <div className="grow">
            <strong>Pagas con Junaeb al retirar</strong>
            <p className="muted">Pagas {money(total)} en el mesón con {baesName(shopData?.baes_operator)}.</p>
          </div>
        </section>
      ) : (
        <section className="card pay-note">
          <span className="option-icon" aria-hidden>
            <Store size={22} />
          </span>
          <div className="grow">
            <strong>Pagas en el local al retirar</strong>
            <p className="muted">Al retirar pagas {money(total)} con el medio que acepte el local.</p>
          </div>
        </section>
      )}
      {payments && user!.pay_later_problem && (acceptsBaes || shopData?.pay_at_shop) && (
        <p className="muted small">{user!.pay_later_problem}</p>
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
          <strong>{money(total)}</strong>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !slot || user!.can_order === false}
          onClick={() => (payMethod === 'app' ? setReviewing(true) : confirm())}
        >
          {busy ? 'Enviando…' : payMethod === 'app' ? 'Continuar al pago' : 'Confirmar pedido'}
        </button>
      </div>

      {reviewing && (
        <Sheet title="Revisa y paga" onClose={() => !busy && setReviewing(false)}>
          <section className="review">
            <div>
              <span>Local</span>
              <strong>{cart.shopName}</strong>
            </div>
            <div>
              <span>Retiro</span>
              <strong>{slot ? slotLabel(slot) : '—'}</strong>
            </div>
            <div>
              <span>Productos</span>
              <strong>{cart.lines.reduce((n, l) => n + l.qty, 0)}</strong>
            </div>
            {quote && quote.subtotal !== quote.total && (
              <div>
                <span>Descuentos</span>
                <strong>−{money(quote.subtotal - quote.total)}</strong>
              </div>
            )}
            <div className="review-total">
              <span>Total a pagar</span>
              <strong>{money(total)}</strong>
            </div>
          </section>

          <section className="pay-provider">
            <ShieldCheck size={22} aria-hidden />
            <div>
              <strong>{payments === 'simulado' ? `Pago de prueba dentro de ${BRAND}` : 'Pagas con Mercado Pago'}</strong>
              <p className="muted">
                {payments === 'simulado'
                  ? 'Esta versión usa un pago de prueba: no se cobra dinero.'
                  : `Te llevamos a la página segura de Mercado Pago para pagar con tarjeta de crédito, débito o tu saldo. ${BRAND} no ve ni guarda los datos de tu tarjeta.`}
              </p>
            </div>
          </section>

          {demo && payments === 'mercadopago' && (
            <p className="notice notice-warn">
              <TriangleAlert size={18} aria-hidden />
              <span>
                Ambiente de prueba: Mercado Pago no cobra dinero real. Paga con una cuenta compradora de prueba y una tarjeta de
                prueba.
              </span>
            </p>
          )}

          <ul className="policy">
            <li>Tu hora queda reservada 15 minutos mientras pagas. Si no pagas, se libera sola y no se cobra nada.</li>
            <li>El local recibe tu pedido apenas se aprueba el pago.</li>
            <li>Si el local lo rechaza, o lo cancelas antes de que lo acepte, te devolvemos el pago completo.</li>
            <li>
              <strong>Si no lo retiras, no hay devolución:</strong> el local ya lo preparó para ti.
            </li>
          </ul>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy} onClick={confirm}>
            {busy ? 'Abriendo el pago…' : payments === 'simulado' ? `Ir al pago de prueba · ${money(total)}` : `Pagar ${money(total)} con Mercado Pago`}
          </button>
          <p className="muted small center">
            Al pagar aceptas las <Link to="/condiciones">Condiciones de uso</Link>.
          </p>
        </Sheet>
      )}
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

/** Cómo pagar con la beca en el mesón: el estudiante llega con la app del operador abierta y el monto exacto. */
function BaesPay({ o }: { o: Order }) {
  const op = BAES[o.baes_operator] ?? BAES.edenred;
  const ready = o.status === 'listo';
  return (
    <section className={`card baes-pay ${ready ? 'ready' : ''}`} aria-label="Pago con beca Junaeb">
      <header>
        <Wallet size={22} aria-hidden />
        <div className="grow">
          <span className="baes-kicker">Pago con Junaeb · {op.name}</span>
          <strong>{ready ? `Abre ${op.app} y paga ${money(o.total)}` : `Al retirar pagas ${money(o.total)}`}</strong>
        </div>
      </header>
      <ol>
        {op.student.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <p className="muted small">Si no pasa (por ejemplo, sin saldo), pagas con otro medio en el mismo mesón.</p>
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
              <span>Muestra este código en el local: sin él no te pueden entregar el pedido. No lo compartas.</span>
              <b>{o.code}</b>
            </div>
          </div>
        )}
      </section>

      {o.payment_method === 'junaeb' && active && <BaesPay o={o} />}

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
          {o.reward_discount > 0 && (
            <li className="saving">
              <span>Premio de la tarjeta de sellos</span>
              <span>−{money(o.reward_discount)}</span>
            </li>
          )}
          {o.promo_discount > 0 && (
            <li className="saving">
              <span>Promoción por hora de retiro</span>
              <span>−{money(o.promo_discount)}</span>
            </li>
          )}
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
/** Los recreos del estudiante: con ellos la app le propone la hora de retiro que calza con su horario. */
function BreaksEditor() {
  const { user, setUser, toast } = useApp();
  const breaks = user!.breaks ?? [];
  // Desde el aviso de inicio se llega aquí con #recreos: se muestra el formulario, listo para usar.
  const [adding, setAdding] = useState(() => breaks.length === 0 && window.location.hash === '#recreos');
  useEffect(() => {
    if (window.location.hash === '#recreos') document.getElementById('recreos')?.scrollIntoView({ block: 'start' });
  }, []);
  const [days, setDays] = useState('12345');
  const [from, setFrom] = useState('10:20');
  const [to, setTo] = useState('10:40');
  const save = async (next: Break[], ok: string) => {
    try {
      setUser(await api<User>('/me', 'PATCH', { breaks: next }));
      toast(ok, 'ok');
      return true;
    } catch (e) {
      toast(errorText(e), 'error');
      return false;
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await save([...breaks, { days, from: toMinutes(from), to: toMinutes(to) }], 'Recreo guardado')) setAdding(false);
  };
  return (
    <section className="card breaks" id="recreos" aria-labelledby="breaks-title">
      <div className="breaks-head">
        <span className="setting-icon" aria-hidden>
          <Coffee size={20} />
        </span>
        <div className="grow">
          <strong id="breaks-title">Mis recreos</strong>
          <p className="muted">Te proponemos retirar justo al empezar tu recreo, y te mostramos qué horas calzan con tu horario.</p>
        </div>
      </div>
      {breaks.length > 0 && (
        <ul className="break-list">
          {breaks.map((b, i) => (
            <li key={`${b.days}-${b.from}-${i}`}>
              <span className="grow">
                <strong>
                  {hhmm(b.from)} a {hhmm(b.to)}
                </strong>
                <span className="muted">{daysText(b.days)}</span>
              </span>
              <button
                className="icon-btn"
                aria-label={`Quitar el recreo de ${hhmm(b.from)} a ${hhmm(b.to)}`}
                onClick={() => void save(breaks.filter((_, j) => j !== i), 'Recreo eliminado')}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form className="form break-form" onSubmit={add}>
          <fieldset className="days">
            <legend>Días</legend>
            {WEEK.map(([d, label]) => (
              <label key={d} className={`day ${days.includes(d) ? 'on' : ''}`}>
                <input type="checkbox" checked={days.includes(d)} onChange={() => setDays(days.includes(d) ? days.replace(d, '') : [...days, d].sort().join(''))} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="form-row">
            <label className="grow">
              Desde
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label className="grow">
              Hasta
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <button type="button" className="btn btn-ghost grow" onClick={() => setAdding(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary grow" disabled={!days || !from || !to}>
              Guardar recreo
            </button>
          </div>
        </form>
      ) : (
        breaks.length < 12 && (
          <button className="btn btn-soft btn-block" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden /> Agregar recreo
          </button>
        )
      )}
    </section>
  );
}

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

  const toggleBaes = async () => {
    try {
      const u = await api<User>('/me', 'PATCH', { baes: !user!.baes });
      setUser(u);
      toast(u.baes ? 'Te propondremos pagar con tu beca' : 'Listo, no te propondremos la beca', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
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

      <section className="card setting">
        <span className="setting-icon setting-baes" aria-hidden>
          <Wallet size={20} />
        </span>
        <div className="grow">
          <strong>Tengo beca Junaeb (BAES)</strong>
          <p className="muted">
            Te proponemos pagar con ella en los locales que la aceptan. En tu sede se paga con {baesName(user!.baes_operator)}, en el mesón al
            retirar.
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" role="switch" checked={!!user!.baes} aria-label="Tengo beca Junaeb" onChange={() => toggleBaes()} />
          <span aria-hidden />
        </label>
      </section>

      <BreaksEditor />

      <AccountSettings notifyText="Te avisamos cuando tu pedido esté listo, aunque tengas la app cerrada." />
    </main>
  );
}
