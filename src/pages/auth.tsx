import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText, type Campus, type User } from '../lib';
import { useApp, useLoad } from '../state';

function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <main className="auth">
      <header className="auth-head">
        <h1 className="logo logo-xl">Pick&amp;Go</h1>
        <p>{subtitle}</p>
      </header>
      {children}
    </main>
  );
}

export function CampusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useLoad(() => api<Campus[]>('/campuses'), []);
  const groups = new Map<string, Campus[]>();
  for (const c of data ?? []) groups.set(c.institution, [...(groups.get(c.institution) ?? []), c]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Elige tu sede</option>
      {[...groups].map(([inst, list]) => (
        <optgroup key={inst} label={inst}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {inst} · {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function useSubmit(action: () => Promise<User>) {
  const { setUser } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await action());
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function Login() {
  const { demo, setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(() => api<User>('/auth/login', 'POST', { email, password }));
  const [demoError, setDemoError] = useState('');

  const quick = async (mail: string) => {
    try {
      setUser(await api<User>('/auth/login', 'POST', { email: mail, password: 'pickgo123' }));
    } catch (err) {
      setDemoError(errorText(err));
    }
  };

  return (
    <AuthShell subtitle="Pide, retira y sigue con tu día.">
      <form className="card form" onSubmit={submit}>
        <label>
          Correo
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Ingresar'}
        </button>
      </form>
      <p className="auth-links">
        ¿Primera vez? <Link to="/registro">Crea tu cuenta</Link>
        <br />
        ¿Tienes un local en una sede? <Link to="/registro-local">Súmalo a Pick&amp;Go</Link>
      </p>
      {demo && (
        <section className="card demo">
          <h2>Probar la demo</h2>
          <p>Entra con una cuenta de prueba. Abre las dos en ventanas distintas para ver los avisos en vivo.</p>
          <div className="demo-actions">
            <button className="btn btn-soft" onClick={() => quick('estudiante@pickgo.cl')}>
              Entrar como estudiante
            </button>
            <button className="btn btn-soft" onClick={() => quick('copec@pickgo.cl')}>
              Entrar como local
            </button>
          </div>
          {demoError && <p className="error">{demoError}</p>}
        </section>
      )}
    </AuthShell>
  );
}

export function Register() {
  const [f, setF] = useState({ name: '', email: '', password: '', campusId: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { error, busy, submit } = useSubmit(() =>
    api<User>('/auth/register', 'POST', { ...f, campusId: Number(f.campusId) }),
  );
  return (
    <AuthShell subtitle="Crea tu cuenta de estudiante">
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre
          <input autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Correo
          <input type="email" autoComplete="email" value={f.email} onChange={(e) => set('email')(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => set('password')(e.target.value)}
            minLength={8}
            required
          />
          <small>Mínimo 8 caracteres.</small>
        </label>
        <label>
          Sede
          <CampusSelect value={f.campusId} onChange={set('campusId')} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="auth-links">
        ¿Ya tienes cuenta? <Link to="/">Ingresa</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterShop() {
  const [f, setF] = useState({ name: '', email: '', password: '', campusId: '', shopName: '', description: '', location: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { error, busy, submit } = useSubmit(() =>
    api<User>('/auth/register-shop', 'POST', { ...f, campusId: Number(f.campusId) }),
  );
  return (
    <AuthShell subtitle="Suma tu local y recibe pedidos anticipados">
      <form className="card form" onSubmit={submit}>
        <label>
          Nombre del local
          <input value={f.shopName} onChange={(e) => set('shopName')(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Sede donde está
          <CampusSelect value={f.campusId} onChange={set('campusId')} />
        </label>
        <label>
          Qué vendes <span className="optional">(opcional)</span>
          <input
            value={f.description}
            onChange={(e) => set('description')(e.target.value)}
            maxLength={120}
            placeholder="Ej.: Sándwiches y cafetería"
          />
        </label>
        <label>
          Ubicación dentro de la sede <span className="optional">(opcional)</span>
          <input
            value={f.location}
            onChange={(e) => set('location')(e.target.value)}
            maxLength={80}
            placeholder="Ej.: Patio central"
          />
        </label>
        <hr />
        <label>
          Tu nombre
          <input autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Correo
          <input type="email" autoComplete="email" value={f.email} onChange={(e) => set('email')(e.target.value)} required />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => set('password')(e.target.value)}
            minLength={8}
            required
          />
          <small>Mínimo 8 caracteres.</small>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creando…' : 'Registrar local'}
        </button>
      </form>
      <p className="auth-links">
        ¿Ya tienes cuenta? <Link to="/">Ingresa</Link>
      </p>
    </AuthShell>
  );
}
