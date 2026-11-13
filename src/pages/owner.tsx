import { Building2, KeyRound, Plus, UserCog, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, errorText } from '../lib';
import { useApp, useLoad } from '../state';
import { Empty, Loading, Logo, Sheet } from '../ui';
import { AccountSettings } from './account';

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
