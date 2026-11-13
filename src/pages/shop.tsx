import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  api,
  errorText,
  hhmm,
  minutesUntil,
  money,
  PAYMENT_LABEL,
  slotLabel,
  toMinutes,
  type Order,
  type Product,
  type Shop,
  type Status,
} from '../lib';
import { useApp, useLoad, useOrderEvents } from '../state';
import { NotificationsCard } from './student';

export function ShopLayout() {
  const { user, logout } = useApp();
  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <span className="logo">Pick&amp;Go</span>
          <span className="panel-shop">{user!.shop_name}</span>
        </div>
        <nav aria-label="Panel del local">
          <NavLink to="/panel" end>
            Pedidos
          </NavLink>
          <NavLink to="/panel/menu">Menú</NavLink>
          <NavLink to="/panel/ajustes">Ajustes</NavLink>
        </nav>
        <button className="btn btn-ghost" onClick={logout}>
          Salir
        </button>
      </header>
      <Outlet />
    </div>
  );
}

// ---------- Pedidos en vivo ----------
const NEXT: Partial<Record<Status, { to: Status; label: string }>> = {
  recibido: { to: 'preparando', label: 'Empezar a preparar' },
  preparando: { to: 'listo', label: 'Marcar listo y avisar' },
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
  return (
    <article className="card ticket-card">
      <header>
        <span className="slot-time">{o.slot.slice(11)}</span>
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
      {o.note && <p className="note">📝 {o.note}</p>}
      <p className={o.paid ? 'muted' : 'collect'}>
        {o.paid ? `Pagado · ${PAYMENT_LABEL[o.payment_method]}` : `Cobrar ${money(o.total)} en efectivo`}
      </p>
      <div className="ticket-actions">
        {next && (
          <button className="btn btn-primary" onClick={() => onMove(o, next.to)}>
            {next.label}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => window.confirm(`¿Cancelar el pedido ${o.code} de ${o.customer_name}?`) && onMove(o, 'cancelado')}
        >
          Cancelar
        </button>
      </div>
    </article>
  );
}

export function ShopOrders() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => api<{ today: string; orders: Order[] }>('/shop/orders'), []);
  const [code, setCode] = useState('');
  const [, tick] = useState(0);
  useOrderEvents(reload);
  useEffect(() => {
    const t = setInterval(() => {
      reload();
      tick((n) => n + 1);
    }, 30000);
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
  const pickup = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const o = await api<Order>('/shop/pickup', 'POST', { code });
      toast(`Pedido ${o.code} entregado a ${o.customer_name}`, 'ok');
      setCode('');
    } catch (err) {
      toast(errorText(err), 'error');
    }
    reload();
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
              maxLength={8}
              autoComplete="off"
              required
            />
            <button className="btn btn-primary">Entregar</button>
          </div>
        </form>
        <dl className="stats">
          <div>
            <dt>En curso</dt>
            <dd>{orders.filter((o) => o.status in NEXT).length}</dd>
          </div>
          <div>
            <dt>Entregados</dt>
            <dd>{delivered.length}</dd>
          </div>
          <div>
            <dt>Ventas entregadas</dt>
            <dd>{money(sales)}</dd>
          </div>
        </dl>
      </section>
      {error && <p className="error">{error}</p>}
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
          <summary>Entregados ({delivered.length})</summary>
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
    </main>
  );
}

// ---------- Menú ----------
const BLANK = { category: '', name: '', description: '', price: '', emoji: '🍽️' };

export function ShopMenu() {
  const { user, toast } = useApp();
  const { data, reload } = useLoad(() => api<{ products: Product[] }>(`/shops/${user!.shop_id}`), []);
  const [form, setForm] = useState<typeof BLANK & { id?: number }>(BLANK);
  const [open, setOpen] = useState(false);
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
    const body = { ...form, price: Number(form.price) };
    void run(async () => {
      await (form.id ? api(`/shop/products/${form.id}`, 'PATCH', body) : api('/shop/products', 'POST', body));
      setOpen(false);
      setForm(BLANK);
    });
  };
  const edit = (p: Product) => {
    setForm({ id: p.id, category: p.category, name: p.name, description: p.description, price: String(p.price), emoji: p.emoji });
    setOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="panel-body narrow">
      {open ? (
        <form className="card form" onSubmit={save}>
          <h2>{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
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
            <label>
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
            Descripción <span className="optional">(opcional)</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={120} />
          </label>
          <div className="form-actions">
            <button className="btn btn-primary">Guardar</button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setOpen(false);
                setForm(BLANK);
              }}
            >
              Descartar
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          + Agregar producto
        </button>
      )}

      {data && products.length === 0 && (
        <p className="muted">Tu menú está vacío. Agrega tu primer producto para empezar a recibir pedidos.</p>
      )}
      {categories.map((c) => (
        <section key={c}>
          <h2 className="section">{c}</h2>
          <ul className="list">
            {products
              .filter((p) => p.category === c)
              .map((p) => (
                <li key={p.id} className={`card product ${p.available ? '' : 'soldout'}`}>
                  <span className="avatar" aria-hidden>
                    {p.emoji}
                  </span>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    {p.description && <span className="muted">{p.description}</span>}
                    <span className="price">{money(p.price)}</span>
                  </div>
                  <div className="product-admin">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={p.available}
                        onChange={() => run(() => api(`/shop/products/${p.id}`, 'PATCH', { available: !p.available }))}
                      />
                      {p.available ? 'Disponible' : 'Agotado'}
                    </label>
                    <div>
                      <button className="btn btn-ghost" onClick={() => edit(p)}>
                        Editar
                      </button>
                      <button
                        className="btn btn-ghost danger"
                        onClick={() =>
                          window.confirm(`¿Eliminar "${p.name}" del menú?`) && run(() => api(`/shop/products/${p.id}`, 'DELETE'))
                        }
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
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
  const [perm, setPerm] = useState<string>('Notification' in window ? Notification.permission : 'unsupported');

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

  if (!shop || !f) return <main className="panel-body narrow"><p className="muted">Cargando…</p></main>;
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
      <section className={`card pause ${shop.paused ? 'paused' : ''}`}>
        <div>
          <strong>{shop.paused ? 'Pedidos en pausa' : 'Recibiendo pedidos'}</strong>
          <p className="muted">
            {shop.paused
              ? 'Los estudiantes ven tu menú, pero no pueden pedir.'
              : 'Pausa si estás sobrepasado o cierras antes de tiempo.'}
          </p>
        </div>
        <button
          className={`btn ${shop.paused ? 'btn-primary' : 'btn-soft'}`}
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
            <input
              type="number"
              min={1}
              max={100}
              value={f.slot_capacity}
              onChange={(e) => set('slot_capacity')(e.target.value)}
              required
            />
            <small>Cuando una franja se llena, los estudiantes eligen otra hora.</small>
          </label>
          <label className="grow">
            Anticipación mínima (min)
            <input
              type="number"
              min={0}
              max={120}
              value={f.prep_minutes}
              onChange={(e) => set('prep_minutes')(e.target.value)}
              required
            />
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
        <button className="btn btn-primary">Guardar ajustes</button>
      </form>

      <NotificationsCard perm={perm} setPerm={setPerm} text="Recibe un aviso con sonido cada vez que entra un pedido." />
    </main>
  );
}
