import { BellRing, Clock, Eye, EyeOff, GraduationCap, ShieldCheck, ShoppingBag, Store, Building2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText, type Campus, type User } from '../lib';
import { useApp, useLoad } from '../state';
import { Logo, TopBar } from '../ui';

function AuthShell({ children, hero }: { children: ReactNode; hero?: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-hero">
        <Logo size="lg" />
        {hero ?? (
          <>
            <h1 className="display">
              Pides.
              <br />
              Retiras.
              <br />
              <mark>Te vas.</mark>
            </h1>
            <p>Pide en los locales de tu sede, elige a qué hora retiras y sáltate la fila.</p>
            <ol className="steps">
              <li>
                <ShoppingBag size={20} aria-hidden />
                <span>
                  <strong>Pide desde la sala</strong>
                  Arma tu pedido en segundos.
                </span>
              </li>
              <li>
                <Clock size={20} aria-hidden />
                <span>
                  <strong>Elige tu hora</strong>
                  El local lo prepara para ese momento.
                </span>
              </li>
              <li>
                <BellRing size={20} aria-hidden />
                <span>
                  <strong>Te avisamos</strong>
                  Llegas, muestras tu código y listo.
                </span>
              </li>
            </ol>
          </>
        )}
      </section>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export function CampusSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { data } = useLoad(() => api<Campus[]>('/campuses'), []);
  const groups = new Map<string, Campus[]>();
  for (const c of data ?? []) groups.set(c.institution, [...(groups.get(c.institution) ?? []), c]);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
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

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="password">
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={minLength}
        maxLength={200}
        required
      />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        {show ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </span>
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
    <AuthShell>
      <form className="card form" onSubmit={submit}>
        <h2>Ingresa a tu cuenta</h2>
        <label>
          Correo
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Contraseña
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Entrando…' : 'Ingresar'}
        </button>
        <p className="form-foot">
          ¿Primera vez? <Link to="/registro">Crea tu cuenta</Link>
        </p>
      </form>

      {demo && (
        <section className="demo">
          <h2>Explora la demo</h2>
          <p>Entra con una cuenta de prueba. Abre dos ventanas para ver los avisos en vivo entre estudiante y local.</p>
          <div className="demo-grid">
            <button onClick={() => quick('estudiante@pickgo.cl')}>
              <GraduationCap size={22} aria-hidden />
              Estudiante
            </button>
            <button onClick={() => quick('copec@pickgo.cl')}>
              <Store size={22} aria-hidden />
              Local
            </button>
            <button onClick={() => quick('admin@pickgo.cl')}>
              <Building2 size={22} aria-hidden />
              Institución
            </button>
          </div>
          {demoError && <p className="error">{demoError}</p>}
        </section>
      )}

      <p className="auth-links">
        ¿Tienes un local en una sede? <Link to="/registro-local">Súmalo a Pick&amp;Go</Link>
        <br />
        <Link to="/privacidad">Privacidad y seguridad</Link>
      </p>
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
    <AuthShell>
      <form className="card form" onSubmit={submit}>
        <h2>Crea tu cuenta</h2>
        <label>
          Nombre
          <input autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Correo
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={f.email}
            onChange={(e) => set('email')(e.target.value)}
            required
          />
        </label>
        <label>
          Contraseña
          <PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} />
          <small>Mínimo 8 caracteres. Evita las que usas en otros sitios.</small>
        </label>
        <label>
          Sede
          <CampusSelect value={f.campusId} onChange={set('campusId')} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creando…' : 'Crear cuenta'}
        </button>
        <p className="form-foot">
          Al crear tu cuenta aceptas el uso de tus datos descrito en <Link to="/privacidad">Privacidad</Link>.
          <br />
          ¿Ya tienes cuenta? <Link to="/">Ingresa</Link>
        </p>
      </form>
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
    <AuthShell
      hero={
        <>
          <h1 className="display">
            Menos fila.
            <br />
            <mark>Más ventas.</mark>
          </h1>
          <p>
            Recibe los pedidos antes de que lleguen los estudiantes, prepáralos con calma y entrégalos a la hora acordada.
          </p>
          <ol className="steps">
            <li>
              <Store size={20} aria-hidden />
              <span>
                <strong>Registra tu local</strong>
                La institución lo revisa y lo aprueba.
              </span>
            </li>
            <li>
              <ShoppingBag size={20} aria-hidden />
              <span>
                <strong>Publica tu menú</strong>
                Tú defines precios, horarios y cuántos pedidos tomas.
              </span>
            </li>
            <li>
              <BellRing size={20} aria-hidden />
              <span>
                <strong>Recibe pedidos en vivo</strong>
                Con aviso sonoro en tu celular, tablet o computador.
              </span>
            </li>
          </ol>
        </>
      }
    >
      <form className="card form" onSubmit={submit}>
        <h2>Registra tu local</h2>
        <label>
          Nombre del local
          <input value={f.shopName} onChange={(e) => set('shopName')(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Sede donde está
          <CampusSelect value={f.campusId} onChange={set('campusId')} />
        </label>
        <label>
          <span>
            Qué vendes <span className="optional">(opcional)</span>
          </span>
          <input
            value={f.description}
            onChange={(e) => set('description')(e.target.value)}
            maxLength={120}
            placeholder="Ej.: Sándwiches y cafetería"
          />
        </label>
        <label>
          <span>
            Ubicación dentro de la sede <span className="optional">(opcional)</span>
          </span>
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
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={f.email}
            onChange={(e) => set('email')(e.target.value)}
            required
          />
        </label>
        <label>
          Contraseña
          <PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} />
          <small>Mínimo 8 caracteres.</small>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creando…' : 'Registrar local'}
        </button>
        <p className="form-foot">
          ¿Ya tienes cuenta? <Link to="/">Ingresa</Link>
        </p>
      </form>
    </AuthShell>
  );
}

const FAQ: [string, string][] = [
  ['¿Cómo funciona Pick&Go?', 'Eliges un local de tu sede, armas tu pedido y escoges a qué hora lo retiras. El local lo recibe al instante y lo prepara para esa hora. Cuando está listo te avisamos; llegas, muestras tu código y te lo llevas.'],
  ['¿Con cuánta anticipación tengo que pedir?', 'Cada local define cuánto necesita para preparar. La app solo te muestra las horas que todavía alcanzan, partiendo por la más cercana. También puedes dejar pedido para mañana.'],
  ['¿Por qué una hora aparece como "Lleno"?', 'Cada local acepta una cantidad limitada de pedidos cada 10 minutos, para poder tenerlos todos a tiempo. Si una hora se llenó, elige la siguiente.'],
  ['¿Cómo retiro mi pedido?', 'Abre el pedido en la app y muestra el código QR o el código de seis caracteres. El local lo escanea o lo escribe y te entrega tu pedido.'],
  ['¿Puedo cancelar?', 'Sí, mientras el local no haya empezado a prepararlo. Después de eso ya no se puede cancelar desde la app.'],
  ['¿Qué pasa si no retiro un pedido?', 'El local lo marca como no retirado. Si acumulas dos en 30 días, el pago en efectivo se desactiva por un tiempo y tendrás que pagar al momento de pedir.'],
  ['¿Cómo pago?', 'Puedes elegir tarjeta, tarjeta JUNAEB o efectivo al retirar. En esta versión de demostración los pagos con tarjeta son simulados: no se hace ningún cobro real.'],
  ['No me llegan los avisos', 'Actívalos en tu perfil. En iPhone primero debes agregar Pick&Go a tu pantalla de inicio y abrirla desde ahí. Con la app abierta, los avisos llegan siempre.'],
  ['¿Cómo instalo la app?', 'En Android, abre el menú del navegador y elige "Instalar app" o "Agregar a pantalla de inicio". En iPhone, toca Compartir y luego "Agregar a inicio".'],
];

export function Help() {
  return (
    <main className="page">
      <TopBar title="Ayuda" back="/perfil" />
      <div className="faq">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}

export function Privacy({ back = '/' }: { back?: string }) {
  return (
    <main className="page prose">
      <TopBar title="Privacidad y seguridad" back={back} />
      <section className="card">
        <h2>
          <ShieldCheck size={20} aria-hidden /> Qué datos guardamos
        </h2>
        <ul>
          <li>Tu nombre, tu correo y la sede que elegiste.</li>
          <li>Tus pedidos: qué pediste, en qué local, a qué hora y cómo pagaste.</li>
          <li>Las calificaciones y comentarios que dejas a los locales.</li>
          <li>Si activas los avisos, el identificador que tu navegador entrega para enviarte notificaciones.</li>
        </ul>
        <p>No guardamos datos de tarjetas ni tu ubicación.</p>
      </section>
      <section className="card">
        <h2>Para qué los usamos</h2>
        <ul>
          <li>El local ve tu nombre y tu pedido para prepararlo y entregártelo.</li>
          <li>Tu institución ve cifras agregadas (cantidad de pedidos, horarios de mayor demanda), no tus pedidos uno a uno.</li>
          <li>No vendemos ni compartimos tus datos con terceros para publicidad.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Cómo los protegemos</h2>
        <ul>
          <li>Tu contraseña se guarda cifrada con un algoritmo de una sola vía: nadie puede leerla, ni siquiera nosotros.</li>
          <li>Tu cuenta se bloquea por un rato si alguien intenta adivinar la contraseña.</li>
          <li>Al cambiar tu contraseña se cierran las sesiones abiertas en otros dispositivos.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Tus derechos</h2>
        <p>
          Desde tu perfil puedes descargar todos tus datos y eliminar tu cuenta cuando quieras. Al eliminarla borramos tus
          datos personales; los pedidos quedan sin tu nombre para la contabilidad de los locales.
        </p>
      </section>
    </main>
  );
}
