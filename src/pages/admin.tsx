import { Building2, Check, FileDown, LayoutDashboard, MapPin, Plus, Store, UserCog, Ban } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { api, errorText, money, moneyShort, shortDay, type AdminShop, type Overview } from '../lib';
import { useApp, useLoad } from '../state';
import { BarChart, Empty, Kpi, Loading, Logo, Rating, Sheet } from '../ui';
import { AccountSettings } from './account';
import { hourBars, RangeToggle } from './shop';

interface Ctx {
  data: Overview;
  reload: () => void;
  days: number;
  setDays: (d: number) => void;
  campus: string;
  setCampus: (c: string) => void;
}
const useAdmin = () => useOutletContext<Ctx>();

export function AdminLayout() {
  const { user } = useApp();
  const [days, setDays] = useState(7);
  const [campus, setCampus] = useState('');
  const { data, error, reload } = useLoad(
    () => api<Overview>(`/admin/overview?days=${days}${campus ? `&campus=${campus}` : ''}`),
    [days, campus],
  );
  const pending = data?.shops.filter((s) => s.status === 'pendiente').length ?? 0;
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-brand">
          <Logo />
          <span className="panel-name">{user!.institution}</span>
        </div>
        <nav className="panel-nav" aria-label="Panel de la institución">
          <NavLink to="/institucion" end>
            <LayoutDashboard size={20} aria-hidden />
            Resumen
          </NavLink>
          <NavLink to="/institucion/locales">
            <span className="tab-icon">
              <Store size={20} aria-hidden />
              {pending > 0 && <b className="badge">{pending}</b>}
            </span>
            Locales
          </NavLink>
          <NavLink to="/institucion/sedes">
            <Building2 size={20} aria-hidden />
            Sedes
          </NavLink>
          <NavLink to="/institucion/cuenta">
            <UserCog size={20} aria-hidden />
            Cuenta
          </NavLink>
        </nav>
      </header>
      {error && (
        <main className="panel-body">
          <p className="error">{error}</p>
        </main>
      )}
      {!data && !error && (
        <main className="panel-body">
          <Loading />
        </main>
      )}
      {data && <Outlet context={{ data, reload, days, setDays, campus, setCampus } satisfies Ctx} />}
    </div>
  );
}

function Filters() {
  const { data, days, setDays, campus, setCampus } = useAdmin();
  return (
    <div className="filters">
      <select value={campus} onChange={(e) => setCampus(e.target.value)} aria-label="Sede">
        <option value="">Todas las sedes</option>
        {data.campuses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <RangeToggle days={days} onChange={setDays} />
    </div>
  );
}

/** Descarga la tabla de locales como CSV, para informes de la institución. */
function downloadCsv(shops: AdminShop[], data: Overview) {
  const cell = (v: string | number | null) => {
    // Las celdas que parten con =, +, - o @ se anteponen con ' para que la planilla no las ejecute como fórmula.
    const t = String(v ?? '').replace(/^([=+\-@])/, "'$1");
    return `"${t.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['Local', 'Sede', 'Pedidos', 'Entregados', 'Cancelados', 'No retirados', 'A tiempo (%)', 'Calificación', 'Ventas (CLP)'],
    ...shops.map((s) => [
      s.name,
      s.campus_name,
      s.totals.orders,
      s.totals.delivered,
      s.totals.cancelled,
      s.totals.no_show,
      s.totals.on_time_pct,
      s.totals.rating,
      s.totals.sales,
    ]),
  ];
  const csv = '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pickgo-locales-${data.from}-a-${data.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminOverview() {
  const { data, days } = useAdmin();
  const t = data.totals;
  const active = data.shops.filter((s) => s.status === 'activo');
  const pending = data.shops.filter((s) => s.status === 'pendiente');
  const daily = days === 7 ? data.by_day : data.by_day.filter((_, i) => i % 3 === 0 || i === data.by_day.length - 1);
  const peak = [...data.by_hour].sort((a, b) => b.orders - a.orders)[0];
  const ranked = [...active].sort((a, b) => b.totals.orders - a.totals.orders);
  return (
    <main className="panel-body">
      <div className="panel-title">
        <h1>Resumen</h1>
        <Filters />
      </div>
      {pending.length > 0 && (
        <NavLink to="/institucion/locales" className="banner banner-link">
          <Store size={18} aria-hidden />
          <span>
            <strong>
              {pending.length} {pending.length === 1 ? 'local espera' : 'locales esperan'} tu aprobación.
            </strong>{' '}
            Revísalos para que aparezcan a los estudiantes.
          </span>
        </NavLink>
      )}
      <div className="kpis">
        <Kpi
          label="Pedidos sin fila"
          value={t.orders - t.cancelled}
          hint={`${t.customers} estudiantes pidieron · ${data.students} registrados`}
          tone="accent"
        />
        <Kpi label="A tiempo" value={t.on_time_pct === null ? '—' : `${t.on_time_pct}%`} hint="Listos a la hora que eligió el estudiante" />
        <Kpi label="Ventas de los locales" value={moneyShort(t.sales)} hint={`Ticket promedio ${money(t.avg_ticket)}`} />
        <Kpi label="Satisfacción" value={t.rating === null ? '—' : `${t.rating.toFixed(1)} / 5`} hint={`${t.ratings} opiniones`} />
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Demanda por hora de retiro</h2>
          {data.by_hour.length === 0 ? <p className="muted">Aún no hay pedidos en este período.</p> : <BarChart label="Pedidos por hora" data={hourBars(data.by_hour)} />}
          <p className="muted small">
            {peak
              ? `La mayor demanda se concentra a las ${peak.hour}:00. En color, las horas peak.`
              : 'Aquí vas a ver en qué horarios se concentra la demanda.'}
          </p>
        </section>
        <section className="card">
          <h2>Pedidos por día</h2>
          <BarChart label="Pedidos por día" data={daily.map((d) => ({ label: shortDay(d.date), value: d.orders }))} />
          <p className="muted small">
            {t.cancelled} cancelados · {t.no_show} no retirados en el período
          </p>
        </section>
      </div>
      <section className="card">
        <div className="panel-title">
          <h2>Locales activos</h2>
          {ranked.length > 0 && (
            <button className="btn btn-soft btn-sm" onClick={() => downloadCsv(ranked, data)}>
              <FileDown size={18} aria-hidden /> Descargar CSV
            </button>
          )}
        </div>
        {ranked.length === 0 ? (
          <p className="muted">Todavía no hay locales activos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Sede</th>
                  <th className="num">Pedidos</th>
                  <th className="num">A tiempo</th>
                  <th className="num">Calificación</th>
                  <th className="num">Ventas</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span aria-hidden>{s.emoji}</span> {s.name}
                    </td>
                    <td>{s.campus_name}</td>
                    <td className="num">{s.totals.orders}</td>
                    <td className="num">{s.totals.on_time_pct === null ? '—' : `${s.totals.on_time_pct}%`}</td>
                    <td className="num">
                      <Rating value={s.totals.rating} />
                    </td>
                    <td className="num">{moneyShort(s.totals.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const STATUS_TEXT = { pendiente: 'En revisión', activo: 'Activo', suspendido: 'Suspendido' } as const;

function ShopRow({ s, onChange }: { s: AdminShop; onChange: (s: AdminShop, status: 'activo' | 'suspendido') => void }) {
  return (
    <li className="card shop-admin">
      <span className="tile" aria-hidden>
        {s.emoji}
      </span>
      <div className="grow">
        <strong>{s.name}</strong>
        <span className="muted">
          {s.campus_name}
          {s.location && ` · ${s.location}`}
        </span>
        <span className="muted">
          {s.products} {s.products === 1 ? 'producto' : 'productos'} en el menú{s.contact && ` · ${s.contact}`}
        </span>
      </div>
      <div className="shop-admin-actions">
        <span className={`tag tag-${s.status}`}>{STATUS_TEXT[s.status]}</span>
        {s.status !== 'activo' && (
          <button className="btn btn-primary btn-sm" onClick={() => onChange(s, 'activo')}>
            <Check size={16} aria-hidden /> {s.status === 'pendiente' ? 'Aprobar' : 'Reactivar'}
          </button>
        )}
        {s.status !== 'suspendido' && (
          <button
            className="btn btn-ghost btn-sm danger"
            onClick={() =>
              window.confirm(
                s.status === 'pendiente'
                  ? `¿Rechazar la solicitud de ${s.name}?`
                  : `¿Suspender ${s.name}? Los estudiantes dejarán de verlo.`,
              ) && onChange(s, 'suspendido')
            }
          >
            <Ban size={16} aria-hidden /> {s.status === 'pendiente' ? 'Rechazar' : 'Suspender'}
          </button>
        )}
      </div>
    </li>
  );
}

export function AdminShops() {
  const { data, reload } = useAdmin();
  const { toast } = useApp();
  const change = async (s: AdminShop, status: 'activo' | 'suspendido') => {
    try {
      await api(`/admin/shops/${s.id}/status`, 'POST', { status });
      toast(status === 'activo' ? `${s.name} ya aparece para los estudiantes` : `${s.name} quedó suspendido`, 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
    reload();
  };
  const groups: [string, AdminShop[]][] = [
    ['Esperan tu aprobación', data.shops.filter((s) => s.status === 'pendiente')],
    ['Activos', data.shops.filter((s) => s.status === 'activo')],
    ['Suspendidos', data.shops.filter((s) => s.status === 'suspendido')],
  ];
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Locales</h1>
      </div>
      <p className="muted">
        Los locales se registran solos desde la pantalla de ingreso. Aparecen para los estudiantes cuando los apruebas.
      </p>
      {data.shops.length === 0 && <Empty icon={<Store size={28} />} title="Aún no hay locales" text="Invita a los locales de tus sedes a registrarse." />}
      {groups.map(
        ([title, list]) =>
          list.length > 0 && (
            <section key={title} className="stack">
              <h2 className="section">
                {title} <span className="count">{list.length}</span>
              </h2>
              <ul className="list">
                {list.map((s) => (
                  <ShopRow key={s.id} s={s} onChange={change} />
                ))}
              </ul>
            </section>
          ),
      )}
    </main>
  );
}

export function AdminCampuses() {
  const { data, reload } = useAdmin();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/admin/campuses', 'POST', { name, city });
      toast('Sede creada', 'ok');
      setOpen(false);
      setName('');
      setCity('');
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Sedes</h1>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          <Plus size={20} aria-hidden /> Agregar sede
        </button>
      </div>
      <ul className="list">
        {data.campuses.map((c) => (
          <li key={c.id} className="card shop-admin">
            <span className="tile" aria-hidden>
              <MapPin size={22} />
            </span>
            <div className="grow">
              <strong>{c.name}</strong>
              <span className="muted">{c.city}</span>
            </div>
            <span className="muted">
              {c.students} {c.students === 1 ? 'estudiante' : 'estudiantes'}
            </span>
          </li>
        ))}
      </ul>
      {open && (
        <Sheet title="Nueva sede" onClose={() => setOpen(false)}>
          <form className="form" onSubmit={save}>
            <label>
              Nombre de la sede
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ej.: Sede Maipú" required />
            </label>
            <label>
              Ciudad
              <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} required />
            </label>
            <button className="btn btn-primary btn-block">Crear sede</button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

export function AdminAccount() {
  const { user } = useApp();
  return (
    <main className="panel-body narrow">
      <div className="panel-title">
        <h1>Cuenta</h1>
      </div>
      <section className="card profile">
        <span className="avatar" aria-hidden>
          <Building2 size={22} />
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
