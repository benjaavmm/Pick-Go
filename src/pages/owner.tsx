import { Building2, FileDown, KeyRound, Percent, Plus, Store, TriangleAlert, UserCog, UserPlus, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, errorText, money, percent, promoText, shortDay, type Order, type PayoutSummary, type Promo, type Settlement, type Totals } from '../lib';
import { useApp, useLoad } from '../state';
import { BRAND } from '../brand';
import { Empty, Kpi, Loading, Logo, Sheet } from '../ui';
import { AccountSettings } from './account';
import { LoyaltyEditor, PromosEditor } from './shop';

interface Institution {
  id: number;
  name: string;
  campuses: { id: number; name: string; city: string }[];
  admins: { id: number; name: string; email: string }[];
  shops: number;
  students: number;
  orders: number;
}
interface Access {
  email: string;
  password: string;
}

export function OwnerLayout() {
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-brand">
          <Logo />
          <span className="panel-name">Plataforma</span>
        </div>
        <nav className="panel-nav" aria-label="Panel de la plataforma">
          <NavLink to="/plataforma" end>
            <Building2 size={20} aria-hidden />
            Instituciones
          </NavLink>
          <NavLink to="/plataforma/locales">
            <Store size={20} aria-hidden />
            Locales
          </NavLink>
          <NavLink to="/plataforma/pagos">
            <Wallet size={20} aria-hidden />
            Pagos
          </NavLink>
          <NavLink to="/plataforma/accesos">
            <KeyRound size={20} aria-hidden />
            Accesos
          </NavLink>
          <NavLink to="/plataforma/cuenta">
            <UserCog size={20} aria-hidden />
            Cuenta
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

/** Muestra una sola vez la contraseña temporal recién creada. */
function AccessSheet({ access, onClose }: { access: Access; onClose: () => void }) {
  const { toast } = useApp();
  const copy = () =>
    navigator.clipboard
      ?.writeText(`Correo: ${access.email}\nContraseña temporal: ${access.password}`)
      .then(() => toast('Datos copiados', 'ok'))
      .catch(() => toast('No se pudo copiar. Anótalos a mano.', 'error'));
  return (
    <Sheet title="Datos de acceso" onClose={onClose}>
      <p>
        Entrega estos datos a la persona por un canal seguro. <strong>La contraseña no se vuelve a mostrar</strong>; debe
        cambiarla al entrar, en Cuenta → Cambiar contraseña.
      </p>
      <div className="stack">
        <span className="muted small">Correo</span>
        <p className="secret">{access.email}</p>
        <span className="muted small">Contraseña temporal</span>
        <p className="secret">{access.password}</p>
      </div>
      <button className="btn btn-primary btn-block" onClick={copy}>
        Copiar datos
      </button>
    </Sheet>
  );
}

export function OwnerInstitutions() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => api<{ institutions: Institution[] }>('/owner/overview'), []);
  const [creating, setCreating] = useState(false);
  const [adminFor, setAdminFor] = useState<Institution | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [f, setF] = useState({ name: '', campus: '', city: '', adminEmail: '' });
  const [email, setEmail] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ admin: Access }>('/owner/institutions', 'POST', f);
      setCreating(false);
      setF({ name: '', campus: '', city: '', adminEmail: '' });
      setAccess(r.admin);
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const addAdmin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<Access>(`/owner/institutions/${adminFor!.id}/admins`, 'POST', { email });
      setAdminFor(null);
      setEmail('');
      setAccess(r);
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Instituciones</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={20} aria-hidden /> Nueva institución
        </button>
      </div>
      <p className="muted">
        Cada institución tiene su propia administración, que aprueba locales y crea sedes. Los locales y estudiantes se
        registran solos desde la pantalla de ingreso.
      </p>
      {error && <p className="error">{error}</p>}
      {!data && !error && <Loading />}
      {data?.institutions.length === 0 && (
        <Empty icon={<Building2 size={28} />} title="Aún no hay instituciones" text="Crea la primera para empezar a operar." />
      )}
      <ul className="list">
        {data?.institutions.map((i) => (
          <li key={i.id} className="card stack">
            <div className="shop-admin">
              <span className="tile" aria-hidden>
                <Building2 size={22} />
              </span>
              <div className="grow">
                <strong>{i.name}</strong>
                <span className="muted">{i.campuses.map((c) => c.name).join(' · ') || 'Sin sedes'}</span>
                <span className="muted">
                  {i.shops} locales activos · {i.students} estudiantes · {i.orders} pedidos
                </span>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => setAdminFor(i)}>
                <UserPlus size={18} aria-hidden /> Administrador
              </button>
            </div>
            <p className="muted small">
              Administración: {i.admins.length ? i.admins.map((a) => a.email).join(', ') : 'sin cuentas todavía'}
            </p>
          </li>
        ))}
      </ul>

      {creating && (
        <Sheet title="Nueva institución" onClose={() => setCreating(false)}>
          <form className="form" onSubmit={create}>
            <label>
              Nombre de la institución
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Ej.: Universidad de…" required />
            </label>
            <div className="form-row">
              <label className="grow">
                Primera sede
                <input value={f.campus} onChange={(e) => setF({ ...f, campus: e.target.value })} maxLength={60} placeholder="Ej.: Campus Central" required />
              </label>
              <label className="grow">
                Ciudad
                <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={60} required />
              </label>
            </div>
            <label>
              Correo de quien administrará
              <input type="email" inputMode="email" autoCapitalize="none" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} required />
              <small>Le crearemos una cuenta con una contraseña temporal.</small>
            </label>
            <button className="btn btn-primary btn-block">Crear institución</button>
          </form>
        </Sheet>
      )}
      {adminFor && (
        <Sheet title={`Nuevo administrador de ${adminFor.name}`} onClose={() => setAdminFor(null)}>
          <form className="form" onSubmit={addAdmin}>
            <label>
              Correo
              <input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <button className="btn btn-primary btn-block">Crear cuenta</button>
          </form>
        </Sheet>
      )}
      {access && <AccessSheet access={access} onClose={() => setAccess(null)} />}
    </main>
  );
}

interface OwnerShop {
  id: number;
  name: string;
  emoji: string;
  status: 'pendiente' | 'activo' | 'suspendido';
  paused: boolean;
  campus_name: string;
  institution: string;
  promos: Promo[];
  loyalty_every: number;
  loyalty_max: number;
  totals: Totals;
  fee: number;
  discounts: number;
}

/**
 * Locales vistos por la plataforma. Cada local maneja su operación (menú, horarios, cupos, aceptar pedidos); la
 * plataforma maneja lo comercial: las promociones y la tarjeta de sellos, que paga con su comisión.
 */
export function OwnerShops() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => api<{ commission_bps: number; shops: OwnerShop[] }>('/owner/shops'), []);
  const [editing, setEditing] = useState<OwnerShop | null>(null);
  if (error) return <main className="panel-body narrow"><p className="error">{error}</p></main>;
  if (!data) return <main className="panel-body narrow"><Loading /></main>;
  const save = async (body: object, ok: string) => {
    try {
      const r = await api<Pick<OwnerShop, 'promos' | 'loyalty_every' | 'loyalty_max'>>(`/owner/shops/${editing!.id}`, 'PATCH', body);
      setEditing({ ...editing!, ...r });
      toast(ok, 'ok');
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const fee = data.shops.reduce((n, s) => n + s.fee, 0);
  const discounts = data.shops.reduce((n, s) => n + s.discounts, 0);
  const commission = data.commission_bps / 100;
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Locales</h1>
      </div>
      <p className="muted">
        Cada local decide su operación: menú, horarios, cupos y qué pedidos acepta. {BRAND} decide lo comercial: la
        comisión, las promociones y la tarjeta de sellos. Los descuentos los paga {BRAND} con su comisión; el local
        recibe siempre el precio completo.
      </p>
      <div className="kpis kpis-inline">
        <Kpi label="Comisiones (30 días)" value={money(fee)} />
        <Kpi label="Descuentos (30 días)" value={money(discounts)} />
        <Kpi label="Resultado" value={money(fee - discounts)} tone="accent" hint="Comisiones menos descuentos" />
      </div>
      <ul className="list">
        {data.shops.map((s) => {
          const t = s.totals;
          const over = s.promos.some((p) => p.percent > commission);
          return (
            <li key={s.id} className="card owner-shop">
              <div className="owner-shop-head">
                <span className="tile" aria-hidden>
                  {s.emoji}
                </span>
                <div className="grow">
                  <strong>{s.name}</strong>
                  <span className="muted">
                    {s.institution} · {s.campus_name}
                    {s.status !== 'activo' && ` · ${s.status === 'pendiente' ? 'en revisión' : 'suspendido'}`}
                    {s.paused && ' · en pausa'}
                  </span>
                </div>
                <button className="btn btn-soft btn-sm" onClick={() => setEditing(s)}>
                  <Percent size={16} aria-hidden /> Descuentos
                </button>
              </div>
              <dl className="owner-shop-stats">
                <div>
                  <dt>Pedidos 30 días</dt>
                  <dd>{t.orders}</dd>
                </div>
                <div>
                  <dt>A tiempo</dt>
                  <dd>{t.on_time_pct === null ? '—' : `${t.on_time_pct}%`}</dd>
                </div>
                <div>
                  <dt>Cancelados</dt>
                  <dd>{t.cancelled}</dd>
                </div>
                <div>
                  <dt>No retirados</dt>
                  <dd>{t.no_show}</dd>
                </div>
                <div>
                  <dt>Calificación</dt>
                  <dd>{t.rating === null ? '—' : t.rating.toFixed(1)}</dd>
                </div>
              </dl>
              <p className="muted small">
                {s.promos.length ? s.promos.map(promoText).join(' · ') : 'Sin promociones'}
                {' · '}
                {s.loyalty_every ? `Sellos: 1 premio cada ${s.loyalty_every} (hasta ${money(s.loyalty_max)})` : 'Sin tarjeta de sellos'}
                {s.discounts > 0 && ` · ${money(s.discounts)} en descuentos este mes`}
              </p>
              {over && (
                <p className="notice notice-warn">
                  <TriangleAlert size={18} aria-hidden />
                  <span>Una promoción supera la comisión ({percent(data.commission_bps)}): en esos pedidos {BRAND} pone dinero.</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <Sheet title={`Descuentos en ${editing.name}`} onClose={() => setEditing(null)}>
          <PromosEditor key={`p${editing.id}`} shop={editing} onSave={(promos) => save({ promos }, 'Promociones guardadas')} />
          <LoyaltyEditor
            key={`l${editing.id}`}
            shop={editing}
            onSave={(every, max) => save({ loyalty_every: every, loyalty_max: max }, every ? 'Tarjeta de sellos activada' : 'Tarjeta de sellos desactivada')}
          />
        </Sheet>
      )}
    </main>
  );
}

interface PaymentsOverview {
  mode: 'simulado' | 'mercadopago' | null;
  commission_bps: number;
  totals: { gross: number; fee: number; orders: number; discounts: number; net: number };
  shops: {
    id: number;
    name: string;
    emoji: string;
    campus_name: string;
    institution: string;
    pending: PayoutSummary;
    in_progress: { orders: number; gross: number };
  }[];
  settlements: Settlement[];
  failed_refunds: Order[];
}

export function OwnerPayments() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => api<PaymentsOverview>('/owner/payments'), []);
  const [rate, setRate] = useState<string | null>(null);
  const [paying, setPaying] = useState<PaymentsOverview['shops'][number] | null>(null);
  const [reference, setReference] = useState('');

  if (error) return <main className="panel-body narrow"><p className="error">{error}</p></main>;
  if (!data) return <main className="panel-body narrow"><Loading /></main>;

  const saveRate = async (e: FormEvent) => {
    e.preventDefault();
    const pct = Number(String(rate).replace(',', '.'));
    try {
      await api('/owner/settings', 'PATCH', { commission_bps: Math.round(pct * 100) });
      toast('Comisión actualizada: se aplica a los pedidos que se paguen desde ahora', 'ok');
      setRate(null);
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const settle = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const st = await api<Settlement>('/owner/settlements', 'POST', { shopId: paying!.id, reference });
      toast(`Registrado: ${money(st.amount)} a ${st.shop_name}`, 'ok');
      setPaying(null);
      setReference('');
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const fixRefund = async (o: Order, manual: boolean) => {
    try {
      await api(`/owner/orders/${o.id}/refund`, 'POST', { manual });
      toast(manual ? 'Marcado como devuelto' : 'Reembolso hecho', 'ok');
    } catch (err) {
      toast(errorText(err), 'error');
    }
    reload();
  };
  const owed = data.shops.filter((s) => s.pending.orders > 0 || s.in_progress.orders > 0);
  const totalOwed = data.shops.reduce((n, s) => n + s.pending.amount, 0);

  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Pagos</h1>
      </div>
      {!data.mode && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>El cobro en la app está desactivado: todos los pedidos se pagan en el local. Se activa con TORUGO_PAYMENTS.</span>
        </p>
      )}
      {data.mode === 'simulado' && (
        <p className="notice notice-warn">
          <TriangleAlert size={18} aria-hidden />
          <span>Marcha blanca: los pagos son de prueba y no mueven dinero. Los montos sirven para ensayar las liquidaciones.</span>
        </p>
      )}
      <div className="kpis">
        <Kpi label="Por transferir a locales" value={money(totalOwed)} tone="accent" />
        <Kpi label="Comisiones" value={money(data.totals.fee)} hint={`${data.totals.orders} pedidos pagados en la app`} />
        <Kpi label="Descuentos pagados" value={money(data.totals.discounts)} hint="Promociones y premios" />
        <Kpi label={`Lo que queda a ${BRAND}`} value={money(data.totals.net)} hint="Comisiones menos descuentos" />
      </div>

      <form className="card form" onSubmit={saveRate}>
        <h2>Comisión de la plataforma</h2>
        <p className="muted">
          Porcentaje de cada pedido pagado en la app que se queda {BRAND}. Recuerda que el proveedor de pagos también
          cobra su propia comisión a tu cuenta: la tuya debe cubrirla.
        </p>
        <div className="inline-form">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={50}
            step={0.1}
            value={rate ?? String(data.commission_bps / 100)}
            onChange={(e) => setRate(e.target.value)}
            aria-label="Comisión en porcentaje"
            required
          />
          <button className="btn btn-dark" disabled={rate === null}>
            Guardar
          </button>
        </div>
        <small className="muted">Hoy: {percent(data.commission_bps)} por pedido.</small>
      </form>

      <h2 className="section">Por transferir</h2>
      {owed.length === 0 && <Empty icon={<Wallet size={28} />} title="No hay montos pendientes" text="Aquí verás cuánto transferir a cada local." />}
      <ul className="list">
        {owed.map((s) => (
          <li key={s.id} className="card shop-admin">
            <span className="tile" aria-hidden>
              {s.emoji}
            </span>
            <div className="grow">
              <strong>{s.name}</strong>
              <span className="muted">
                {s.institution} · {s.campus_name}
              </span>
              <span className="muted">
                {s.pending.orders} pedidos cerrados · cobrado {money(s.pending.gross)} · comisión {money(s.pending.fee)}
                {s.pending.discounts > 0 && ` · descuentos ${money(s.pending.discounts)}`}
                {s.in_progress.orders > 0 && ` · ${s.in_progress.orders} aún en curso`}
              </span>
            </div>
            <div className="shop-admin-actions">
              <strong className="price">{money(s.pending.amount)}</strong>
              <button className="btn btn-primary btn-sm" disabled={s.pending.orders === 0} onClick={() => setPaying(s)}>
                Registrar transferencia
              </button>
            </div>
          </li>
        ))}
      </ul>

      {data.failed_refunds.length > 0 && (
        <>
          <h2 className="section">Devoluciones con problemas</h2>
          <ul className="list">
            {data.failed_refunds.map((o) => (
              <li key={o.id} className="card shop-admin">
                <div className="grow">
                  <strong>
                    {o.code} · {money(o.total)}
                  </strong>
                  <span className="muted">
                    {o.customer_name} · {o.shop_name}
                  </span>
                </div>
                <div className="shop-admin-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => fixRefund(o, false)}>
                    Reintentar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => fixRefund(o, true)}>
                    Ya lo devolví
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data.settlements.length > 0 && (
        <>
          <h2 className="section">Transferencias registradas</h2>
          <section className="card">
            <ul className="lines">
              {data.settlements.map((st) => (
                <li key={st.id}>
                  <span>
                    {shortDay(st.created_at.slice(0, 10))} · {st.shop_name}
                    {st.reference && ` · ${st.reference}`}
                  </span>
                  <span>
                    <a href={`/api/owner/settlements/${st.id}.csv`} download aria-label={`Descargar detalle de la transferencia a ${st.shop_name}`}>
                      <FileDown size={14} aria-hidden /> {money(st.amount)}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {paying && (
        <Sheet title={`Transferencia a ${paying.name}`} onClose={() => setPaying(null)}>
          <form className="form" onSubmit={settle}>
            <p>
              Transfiere <strong>{money(paying.pending.amount)}</strong> a la cuenta del local y luego regístralo aquí. Quedan
              marcados como pagados sus {paying.pending.orders} pedidos cerrados, y el local verá el detalle.
            </p>
            <label>
              <span>
                Referencia <span className="optional">(opcional)</span>
              </span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="N° de transferencia" />
            </label>
            <button className="btn btn-primary btn-block">Registrar {money(paying.pending.amount)}</button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

export function OwnerAccess() {
  const { toast } = useApp();
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<Access | null>(null);
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(`¿Generar una contraseña nueva para ${email}? Se cerrarán sus sesiones abiertas.`)) return;
    try {
      setAccess(await api<Access>('/owner/reset-password', 'POST', { email }));
      setEmail('');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Accesos</h1>
      </div>
      <form className="card form" onSubmit={reset}>
        <h2>Recuperar el acceso de una cuenta</h2>
        <p className="muted">
          Si alguien olvidó su contraseña, genera una temporal y entrégasela por un canal seguro, después de confirmar que
          es quien dice ser. Sirve para estudiantes, locales y administraciones.
        </p>
        <label>
          Correo de la cuenta
          <input type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button className="btn btn-dark btn-block">Generar contraseña temporal</button>
      </form>
      {access && <AccessSheet access={access} onClose={() => setAccess(null)} />}
    </main>
  );
}

export function OwnerAccount() {
  const { user } = useApp();
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Cuenta</h1>
      </div>
      <section className="card profile">
        <span className="avatar" aria-hidden>
          <UserCog size={22} />
        </span>
        <div className="grow">
          <strong>{user!.name}</strong>
          <span className="muted">{user!.email}</span>
        </div>
      </section>
      <AccountSettings />
    </main>
  );
}
