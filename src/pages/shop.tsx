import {
  ChartColumn,
  ClipboardList,
  Hourglass,
  Pause,
  Pencil,
  Play,
  Plus,
  ScanLine,
  Settings,
  Star,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  api,
  errorText,
  hhmm,
  minutesUntil,
  money,
  moneyShort,
  PAYMENT_LABEL,
  shortDay,
  slotLabel,
  toMinutes,
  type Order,
  type Product,
  type Shop,
  type ShopStats,
  type Status,
  type User,
} from '../lib';
import { useApp, useLoad, useOrderEvents, useTick } from '../state';
import { BarChart, Empty, Kpi, Loading, Logo, Sheet } from '../ui';
import { AccountSettings } from './account';

export function ShopLayout() {
  const { user, setUser } = useApp();
  // El estado de aprobación puede cambiar mientras el panel está abierto.
  useEffect(() => {
    if (user!.shop_status === 'activo') return;
    const t = setInterval(() => void api<User>('/me').then(setUser, () => {}), 30000);
    return () => clearInterval(t);
  }, [user, setUser]);
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-brand">
          <Logo />
          <span className="panel-name">{user!.shop_name}</span>
        </div>
        <nav className="panel-nav" aria-label="Panel del local">
          <NavLink to="/panel" end>
            <ClipboardList size={20} aria-hidden />
            Pedidos
          </NavLink>
          <NavLink to="/panel/menu">
            <UtensilsCrossed size={20} aria-hidden />
            Menú
          </NavLink>
          <NavLink to="/panel/metricas">
            <ChartColumn size={20} aria-hidden />
            Métricas
          </NavLink>
          <NavLink to="/panel/ajustes">
            <Settings size={20} aria-hidden />
            Ajustes
          </NavLink>
        </nav>
      </header>
      {user!.shop_status === 'pendiente' && (
        <p className="banner">
          <Hourglass size={18} aria-hidden />
          <span>
            <strong>Tu local está en revisión.</strong> {user!.institution} debe aprobarlo antes de que aparezca para los
            estudiantes. Mientras tanto, arma tu menú y revisa tus horarios.
          </span>
        </p>
      )}
      {user!.shop_status === 'suspendido' && (
        <p className="banner banner-danger">
          <TriangleAlert size={18} aria-hidden />
          <span>
            <strong>Tu local está suspendido.</strong> Los estudiantes no pueden verlo. Contacta a la administración de{' '}
            {user!.institution}.
          </span>
        </p>
      )}
      <Outlet />
    </div>
  );
}

// ---------- Escáner de códigos QR ----------
function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const found = useRef(onCode);
  found.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const [{ default: jsQR }, media] = await Promise.all([
          import('jsqr'),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
        ]);
        stream = media;
        if (stopped) return media.getTracks().forEach((t) => t.stop());
        const el = video.current!;
        el.srcObject = media;
        await el.play();
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const scan = () => {
          if (stopped) return;
          if (el.readyState >= 2 && el.videoWidth > 0) {
            // Imagen reducida: suficiente para leer el código y liviana para celulares modestos.
            const scale = Math.min(1, 640 / el.videoWidth);
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const text = jsQR(img.data, img.width, img.height)?.data.trim().toUpperCase();
            if (text && /^PG[A-Z0-9]{4,8}$/.test(text)) {
              stopped = true;
              navigator.vibrate?.(80);
              return found.current(text);
            }
          }
          frame = requestAnimationFrame(scan);
        };
        scan();
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === 'NotAllowedError'
            ? 'No tenemos permiso para usar la cámara. Actívalo en los ajustes del navegador o escribe el código.'
            : 'No pudimos abrir la cámara en este dispositivo. Escribe el código a mano.',
        );
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Sheet title="Escanear código de retiro" onClose={onClose}>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <div className="scanner">
          <video ref={video} playsInline muted />
          <span className="scanner-frame" aria-hidden />
        </div>
      )}
      <p className="muted center">Apunta la cámara al código QR del estudiante.</p>
    </Sheet>
  );
}

// ---------- Pedidos en vivo ----------
const NEXT: Partial<Record<Status, { to: Status; label: string }>> = {
  recibido: { to: 'preparando', label: 'Empezar a preparar' },
  preparando: { to: 'listo', label: 'Listo: avisar' },
  listo: { to: 'entregado', label: 'Entregar' },
};

function eta(slot: string) {
  const m = minutesUntil(slot);
  if (m < 0) return { text: `Atrasado ${-m} min`, late: true };
  if (m === 0) return { text: 'Retira ahora', late: false };
  if (m < 60) return { text: `En ${m} min`, late: false };
  return { text: slotLabel(slot), late: false };
}

function OrderCard({ o, onMove }: { o: Order; onMove: (o: Order, to: Status) => void }) {
  const next = NEXT[o.status];
  const when = eta(o.slot);
  const noShow = o.status === 'listo' && minutesUntil(o.slot) <= -10;
  return (
    <article className="ticket-card">
      <header>
        <b className="slot-time">{o.slot.slice(11)}</b>
        <span className={`eta ${when.late ? 'late' : ''}`}>{when.text}</span>
        <span className="code-chip">{o.code}</span>
      </header>
      <p className="customer">{o.customer_name}</p>
      <ul className="lines">
        {o.items.map((i) => (
          <li key={i.product_id}>
            <span>
              <b>{i.qty}×</b> {i.name}
            </span>
          </li>
        ))}
      </ul>
      {o.note && <p className="note">{o.note}</p>}
      <p className={o.paid ? 'paid' : 'collect'}>
        {o.paid ? `Pagado · ${PAYMENT_LABEL[o.payment_method]}` : `Cobrar ${money(o.total)} en efectivo`}
      </p>
      <div className="ticket-actions">
        {next && (
          <button className="btn btn-primary" onClick={() => onMove(o, next.to)}>
            {next.label}
          </button>
        )}
        {noShow ? (
          <button
            className="btn btn-ghost"
            onClick={() => window.confirm(`¿Marcar el pedido ${o.code} como no retirado?`) && onMove(o, 'no_retirado')}
          >
            No vino
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            onClick={() => window.confirm(`¿Cancelar el pedido ${o.code} de ${o.customer_name}?`) && onMove(o, 'cancelado')}
          >
            Cancelar
          </button>
        )}
      </div>
    </article>
  );
}

export function ShopOrders() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => api<{ today: string; orders: Order[] }>('/shop/orders'), []);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  useOrderEvents(reload);
  useTick();
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const move = async (o: Order, to: Status) => {
    try {
      await api(`/shop/orders/${o.id}/status`, 'POST', { status: to });
      if (to === 'listo') toast(`Avisamos a ${o.customer_name} que su pedido está listo`, 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
    reload();
  };
  const deliver = async (value: string) => {
    try {
      const o = await api<Order>('/shop/pickup', 'POST', { code: value });
      toast(`Pedido ${o.code} entregado a ${o.customer_name}`, 'ok');
      setCode('');
    } catch (err) {
      toast(errorText(err), 'error');
    }
    reload();
  };
  const pickup = (e: FormEvent) => {
    e.preventDefault();
    void deliver(code);
  };

  const orders = data?.orders ?? [];
  const by = (s: Status) => orders.filter((o) => o.status === s);
  const delivered = by('entregado');
  const sales = delivered.reduce((n, o) => n + o.total, 0);
  const columns: { status: Status; title: string; empty: string }[] = [
    { status: 'recibido', title: 'Nuevos', empty: 'Sin pedidos nuevos' },
    { status: 'preparando', title: 'En preparación', empty: 'Nada en preparación' },
    { status: 'listo', title: 'Listos para retirar', empty: 'Nada esperando retiro' },
  ];

  return (
    <main className="panel-body">
      <section className="panel-top">
        <form className="pickup-form" onSubmit={pickup}>
          <label htmlFor="pickup-code">Entregar por código</label>
          <div>
            <input
              id="pickup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PG····"
              maxLength={10}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
            <button className="btn btn-dark">Entregar</button>
            <button type="button" className="btn btn-primary" onClick={() => setScanning(true)}>
              <ScanLine size={20} aria-hidden /> Escanear
            </button>
          </div>
        </form>
        <div className="kpis kpis-inline">
          <Kpi label="En curso" value={orders.filter((o) => o.status in NEXT).length} />
          <Kpi label="Entregados hoy" value={delivered.length} />
          <Kpi label="Ventas de hoy" value={moneyShort(sales)} tone="accent" />
        </div>
      </section>
      {error && <p className="error">{error}</p>}
      {!data && !error && <Loading />}
      <div className="board">
        {columns.map((c) => (
          <section key={c.status} className={`column column-${c.status}`}>
            <h2>
              {c.title} <span className="count">{by(c.status).length}</span>
            </h2>
            {by(c.status).length === 0 && <p className="muted">{c.empty}</p>}
            {by(c.status).map((o) => (
              <OrderCard key={o.id} o={o} onMove={move} />
            ))}
          </section>
        ))}
      </div>
      {delivered.length > 0 && (
        <details className="card">
          <summary>Entregados hoy ({delivered.length})</summary>
          <ul className="lines">
            {delivered.map((o) => (
              <li key={o.id}>
                <span>
                  {o.slot.slice(11)} · {o.code} · {o.customer_name}
                </span>
                <span>{money(o.total)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onCode={(c) => {
            setScanning(false);
            void deliver(c);
          }}
        />
      )}
    </main>
  );
}

// ---------- Métricas ----------
export function RangeToggle({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="segmented segmented-sm" role="group" aria-label="Período">
      <button className={days === 7 ? 'on' : ''} onClick={() => onChange(7)}>
        7 días
      </button>
      <button className={days === 30 ? 'on' : ''} onClick={() => onChange(30)}>
        30 días
      </button>
    </div>
  );
}

/** Marca como destacadas las horas con más demanda (al menos 80% del máximo). */
export function hourBars(byHour: { hour: number; orders: number }[]) {
  const max = Math.max(0, ...byHour.map((h) => h.orders));
  return byHour.map((h) => ({ label: `${h.hour}h`, value: h.orders, highlight: max > 0 && h.orders >= max * 0.8 }));
}

export function ShopStatsPage() {
  const [days, setDays] = useState(7);
  const { data, error } = useLoad(() => api<ShopStats>(`/shop/stats?days=${days}`), [days]);
  if (error) return <main className="panel-body narrow"><p className="error">{error}</p></main>;
  if (!data) return <main className="panel-body narrow"><Loading /></main>;
  const t = data.totals;
  const daily = days === 7 ? data.by_day : data.by_day.filter((_, i) => i % 3 === 0 || i === data.by_day.length - 1);
  return (
    <main className="panel-body">
      <div className="panel-title">
        <h1>Métricas</h1>
        <RangeToggle days={days} onChange={setDays} />
      </div>
      <div className="kpis">
        <Kpi label="Ventas entregadas" value={moneyShort(t.sales)} hint={`Ticket promedio ${money(t.avg_ticket)}`} tone="accent" />
        <Kpi label="Pedidos" value={t.orders} hint={`${t.customers} ${t.customers === 1 ? 'cliente' : 'clientes'}`} />
        <Kpi label="A tiempo" value={t.on_time_pct === null ? '—' : `${t.on_time_pct}%`} hint="Listos a la hora de retiro" />
        <Kpi label="Calificación" value={t.rating === null ? '—' : t.rating.toFixed(1)} hint={`${t.ratings} ${t.ratings === 1 ? 'opinión' : 'opiniones'}`} />
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Pedidos por día</h2>
          <BarChart
            label="Pedidos por día"
            data={(days === 7 ? data.by_day : daily).map((d) => ({ label: shortDay(d.date), value: d.orders }))}
          />
        </section>
        <section className="card">
          <h2>Demanda por hora de retiro</h2>
          {data.by_hour.length === 0 ? <p className="muted">Aún no hay pedidos en este período.</p> : <BarChart label="Pedidos por hora" data={hourBars(data.by_hour)} />}
          <p className="muted small">En color, las horas peak. Úsalas para decidir tu cupo por franja.</p>
        </section>
        <section className="card">
          <h2>Lo más pedido</h2>
          {data.top.length === 0 && <p className="muted">Aún no hay pedidos en este período.</p>}
          <ol className="ranking">
            {data.top.map((p) => (
              <li key={p.name}>
                <span aria-hidden>{p.emoji}</span>
                <span className="grow">{p.name}</span>
                <b>{p.qty}</b>
                <span className="muted">{moneyShort(p.sales)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2>Opiniones recientes</h2>
          {data.comments.length === 0 && <p className="muted">Todavía no hay comentarios de estudiantes.</p>}
          <ul className="comments">
            {data.comments.map((c, i) => (
              <li key={i}>
                <span className="rating">
                  <Star size={14} fill="currentColor" aria-hidden />
                  {c.rating}
                </span>
                <span className="grow">{c.comment}</span>
                <span className="muted">{shortDay(c.date)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {t.cancelled} cancelados · {t.no_show} no retirados en el período
          </p>
        </section>
      </div>
    </main>
  );
}

// ---------- Menú ----------
const BLANK = { category: '', name: '', description: '', price: '', emoji: '🍽️' };

export function ShopMenu() {
  const { user, toast } = useApp();
  const { data, reload } = useLoad(() => api<{ products: Product[] }>(`/shops/${user!.shop_id}`), []);
  const [form, setForm] = useState<(typeof BLANK & { id?: number }) | null>(null);
  const products = data?.products ?? [];
  const categories = [...new Set(products.map((p) => p.category))];

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    }
    reload();
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const body = { ...form, price: Number(form.price) };
    void run(async () => {
      await (form.id ? api(`/shop/products/${form.id}`, 'PATCH', body) : api('/shop/products', 'POST', body));
      setForm(null);
    });
  };

  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Menú</h1>
        <button className="btn btn-primary" onClick={() => setForm(BLANK)}>
          <Plus size={20} aria-hidden /> Agregar producto
        </button>
      </div>
      {!data && <Loading />}
      {data && products.length === 0 && (
        <Empty icon={<UtensilsCrossed size={28} />} title="Tu menú está vacío" text="Agrega tu primer producto para empezar a recibir pedidos." />
      )}
      {categories.map((c) => (
        <section key={c} className="stack">
          <h2 className="section">{c}</h2>
          <ul className="list">
            {products
              .filter((p) => p.category === c)
              .map((p) => (
                <li key={p.id} className={`card product ${p.available ? '' : 'soldout'}`}>
                  <span className="tile" aria-hidden>
                    {p.emoji}
                  </span>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    {p.description && <span className="muted clamp">{p.description}</span>}
                    <span className="price">{money(p.price)}</span>
                  </div>
                  <div className="product-admin">
                    <label className="switch">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={p.available}
                        onChange={() => run(() => api(`/shop/products/${p.id}`, 'PATCH', { available: !p.available }))}
                      />
                      <span aria-hidden />
                      {p.available ? 'Disponible' : 'Agotado'}
                    </label>
                    <div>
                      <button
                        className="icon-btn"
                        aria-label={`Editar ${p.name}`}
                        onClick={() =>
                          setForm({ id: p.id, category: p.category, name: p.name, description: p.description, price: String(p.price), emoji: p.emoji })
                        }
                      >
                        <Pencil size={18} />
                      </button>
                      <button
                        className="icon-btn danger"
                        aria-label={`Eliminar ${p.name}`}
                        onClick={() =>
                          window.confirm(`¿Eliminar "${p.name}" del menú?`) && run(() => api(`/shop/products/${p.id}`, 'DELETE'))
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {form && (
        <Sheet title={form.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <div className="form-row">
              <label className="w-emoji">
                Ícono
                <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={8} required />
              </label>
              <label className="grow">
                Nombre
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} required />
              </label>
            </div>
            <div className="form-row">
              <label className="grow">
                Categoría
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="categories"
                  maxLength={30}
                  placeholder="Ej.: Almuerzos"
                  required
                />
                <datalist id="categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="w-price">
                Precio ($)
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                />
              </label>
            </div>
            <label>
              <span>
                Descripción <span className="optional">(opcional)</span>
              </span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={120} />
            </label>
            <button className="btn btn-primary btn-block">Guardar producto</button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

// ---------- Ajustes ----------
export function ShopSettings() {
  const { toast } = useApp();
  const { data: shop, setData } = useLoad(() => api<Shop>('/shop/me'), []);
  const [f, setF] = useState<null | {
    name: string;
    description: string;
    location: string;
    emoji: string;
    opens: string;
    closes: string;
    prep_minutes: string;
    slot_capacity: string;
  }>(null);

  useEffect(() => {
    if (shop && !f)
      setF({
        name: shop.name,
        description: shop.description,
        location: shop.location,
        emoji: shop.emoji,
        opens: hhmm(shop.opens),
        closes: hhmm(shop.closes),
        prep_minutes: String(shop.prep_minutes),
        slot_capacity: String(shop.slot_capacity),
      });
  }, [shop, f]);

  if (!shop || !f) return <main className="panel-body narrow"><Loading /></main>;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const patch = async (body: object, ok: string) => {
    try {
      setData(await api<Shop>('/shop/me', 'PATCH', body));
      toast(ok, 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void patch(
      {
        name: f.name,
        description: f.description,
        location: f.location,
        emoji: f.emoji,
        opens: toMinutes(f.opens),
        closes: toMinutes(f.closes),
        prep_minutes: Number(f.prep_minutes),
        slot_capacity: Number(f.slot_capacity),
      },
      'Ajustes guardados',
    );
  };

  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Ajustes</h1>
      </div>
      <section className={`card setting pause ${shop.paused ? 'paused' : ''}`}>
        <span className="setting-icon" aria-hidden>
          {shop.paused ? <Pause size={20} /> : <Play size={20} />}
        </span>
        <div className="grow">
          <strong>{shop.paused ? 'Pedidos en pausa' : 'Recibiendo pedidos'}</strong>
          <p className="muted">
            {shop.paused ? 'Los estudiantes ven tu menú, pero no pueden pedir.' : 'Pausa si estás sobrepasado o cierras antes de tiempo.'}
          </p>
        </div>
        <button
          className={`btn btn-sm ${shop.paused ? 'btn-primary' : 'btn-dark'}`}
          onClick={() => patch({ paused: !shop.paused }, shop.paused ? 'Volviste a recibir pedidos' : 'Pedidos en pausa')}
        >
          {shop.paused ? 'Reanudar' : 'Pausar'}
        </button>
      </section>

      <form className="card form" onSubmit={save}>
        <h2>Horarios de retiro</h2>
        <div className="form-row">
          <label className="grow">
            Abre
            <input type="time" value={f.opens} onChange={(e) => set('opens')(e.target.value)} required />
          </label>
          <label className="grow">
            Cierra
            <input type="time" value={f.closes} onChange={(e) => set('closes')(e.target.value)} required />
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            Pedidos por franja de 10 min
            <input type="number" inputMode="numeric" min={1} max={100} value={f.slot_capacity} onChange={(e) => set('slot_capacity')(e.target.value)} required />
            <small>Cuando una franja se llena, los estudiantes eligen otra hora.</small>
          </label>
          <label className="grow">
            Anticipación mínima (min)
            <input type="number" inputMode="numeric" min={0} max={120} value={f.prep_minutes} onChange={(e) => set('prep_minutes')(e.target.value)} required />
            <small>Tiempo que necesitas para preparar un pedido.</small>
          </label>
        </div>
        <h2>Datos del local</h2>
        <div className="form-row">
          <label className="w-emoji">
            Ícono
            <input value={f.emoji} onChange={(e) => set('emoji')(e.target.value)} maxLength={8} required />
          </label>
          <label className="grow">
            Nombre
            <input value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={60} required />
          </label>
        </div>
        <label>
          Qué vendes
          <input value={f.description} onChange={(e) => set('description')(e.target.value)} maxLength={120} />
        </label>
        <label>
          Ubicación dentro de la sede
          <input value={f.location} onChange={(e) => set('location')(e.target.value)} maxLength={80} />
        </label>
        <button className="btn btn-primary btn-block">Guardar ajustes</button>
      </form>

      <AccountSettings notifyText="Recibe un aviso cada vez que entra un pedido, aunque tengas el panel cerrado." />
    </main>
  );
}
