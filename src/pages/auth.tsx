import { BellRing, Coffee, Eye, EyeOff, GraduationCap, ShieldCheck, ShoppingBag, Store, Building2 } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorText, type Campus, type User } from '../lib';
import { BRAND } from '../brand';
import { useApp, useLoad } from '../state';
import { HeroArt, Logo, TopBar } from '../ui';

function AuthShell({ children, hero }: { children: ReactNode; hero?: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-hero">
        <Logo size="lg" />
        {!hero && <HeroArt />}
        {hero ?? (
          <>
            <h1 className="display">
              <span className="hl">Pide entre clases.</span>
              <br />
              <mark>Retira sin fila.</mark>
            </h1>
            <p>Pide en los locales de tu sede y retira justo en tu recreo, sin fila.</p>
            <ol className="steps">
              <li>
                <Coffee size={20} aria-hidden />
                <span>
                  <strong>Calza con tus recreos</strong>
                  Te proponemos la hora justa para retirar.
                </span>
              </li>
              <li>
                <ShoppingBag size={20} aria-hidden />
                <span>
                  <strong>Pide desde la sala</strong>
                  Arma tu pedido en segundos.
                </span>
              </li>
              <li>
                <BellRing size={20} aria-hidden />
                <span>
                  <strong>Te avisamos</strong>
                  Llegas, muestras tu código y te vas.
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
  const { demo, mail, setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(() => api<User>('/auth/login', 'POST', { email, password }));
  const [demoError, setDemoError] = useState('');

  const quick = async (mail: string) => {
    try {
      setUser(await api<User>('/auth/login', 'POST', { email: mail, password: 'torugo123' }));
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
          {mail && (
            <>
              <br />
              <Link to="/recuperar">Olvidé mi contraseña</Link>
            </>
          )}
        </p>
      </form>

      {demo && (
        <section className="demo">
          <h2>Explora la demo</h2>
          <p>Entra con una cuenta de prueba. Abre dos ventanas para ver los avisos en vivo entre estudiante y local.</p>
          <div className="demo-grid">
            <button onClick={() => quick('estudiante@torugo.cl')}>
              <GraduationCap size={22} aria-hidden />
              Estudiante
            </button>
            <button onClick={() => quick('cafe@torugo.cl')}>
              <Store size={22} aria-hidden />
              Local
            </button>
            <button onClick={() => quick('admin@torugo.cl')}>
              <Building2 size={22} aria-hidden />
              Institución
            </button>
            <button onClick={() => quick('plataforma@torugo.cl')}>
              <ShieldCheck size={22} aria-hidden />
              Plataforma
            </button>
          </div>
          {demoError && <p className="error">{demoError}</p>}
        </section>
      )}

      <p className="auth-links">
        ¿Tienes un local en una sede? <Link to="/registro-local">Súmalo a {BRAND}</Link>
        <br />
        <Link to="/privacidad">Privacidad y seguridad</Link> · <Link to="/condiciones">Condiciones de uso</Link>
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
          Al crear tu cuenta aceptas las <Link to="/condiciones">Condiciones de uso</Link> y el uso de tus datos descrito en{' '}
          <Link to="/privacidad">Privacidad</Link>.
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

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot', 'POST', { email });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  };
  return (
    <AuthShell>
      {sent ? (
        <section className="card form">
          <h2>Revisa tu correo</h2>
          <p>
            Si hay una cuenta con <strong>{email}</strong>, te enviamos un enlace para elegir una contraseña nueva. Vale por
            30 minutos.
          </p>
          <p className="muted">¿No llega? Mira en la carpeta de correo no deseado.</p>
          <Link to="/" className="btn btn-primary btn-block">
            Volver a ingresar
          </Link>
        </section>
      ) : (
        <form className="card form" onSubmit={submit}>
          <h2>Recupera tu contraseña</h2>
          <p className="muted">Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva.</p>
          <label>
            Correo
            <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar enlace'}
          </button>
          <p className="form-foot">
            <Link to="/">Volver a ingresar</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset', 'POST', { token, password });
      toast('Contraseña cambiada. Ya puedes ingresar.', 'ok');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <AuthShell>
      <form className="card form" onSubmit={submit}>
        <h2>Elige una contraseña nueva</h2>
        <label>
          Contraseña nueva
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          <small>Mínimo 8 caracteres. Al cambiarla se cierran tus sesiones abiertas.</small>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !token}>
          Guardar contraseña
        </button>
        <p className="form-foot">
          <Link to="/recuperar">Pedir un enlace nuevo</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function Terms({ back = '/' }: { back?: string }) {
  return (
    <main className="page prose">
      <TopBar title="Condiciones de uso" back={back} />
      <section className="card">
        <h2>Qué es {BRAND}</h2>
        <p>
          {BRAND} conecta a estudiantes con los locales de su sede para pedir por adelantado y retirar a una hora
          acordada. {BRAND} no vende ni prepara los productos: cada local es responsable de lo que ofrece, de sus
          precios y de la calidad de lo que entrega.
        </p>
      </section>
      <section className="card">
        <h2>Si eres estudiante</h2>
        <ul>
          <li>Un pedido confirmado es un compromiso de retirarlo a la hora que elegiste.</li>
          <li>Si pagaste en la app y no retiras el pedido, el local igual lo preparó: ese pago no se devuelve.</li>
          <li>Puedes cancelar mientras el local no lo haya aceptado; si pagaste en la app, te devolvemos el pago.</li>
          <li>Si el local rechaza o cancela tu pedido, te devolvemos el pago completo.</li>
          <li>
            Si eliges pagar con tu beca Junaeb, pagas en el mesón al retirar, con la app de su operador. {BRAND} no cobra la
            beca ni ve tu saldo. Si la beca no pasa, pagas con otro medio.
          </li>
          <li>Si no retiras un pedido que ibas a pagar al retirar, por 30 días solo podrás pagar en la app.</li>
          <li>Si acumulas tres pedidos sin retirar en 30 días, tu cuenta no podrá hacer pedidos nuevos por un tiempo.</li>
          <li>Tu cuenta es personal: no la compartas ni la uses para pedir a nombre de otra persona.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Si tienes un local</h2>
        <ul>
          <li>Mantén tu menú, precios, horarios y disponibilidad al día.</li>
          <li>Acepta solo los pedidos que puedas tener listos a la hora de retiro, y avisa cuando estén listos.</li>
          <li>Lo pagado en la app se te transfiere descontada la comisión de {BRAND}; los pedidos que aceptes pagar al retirar los cobras tú.</li>
          <li>Las promociones y la tarjeta de sellos las define y las paga {BRAND}: recibes siempre el precio completo de tus productos.</li>
          <li>Activa la beca Junaeb solo si estás adherido a su operador en tu sede. Esos pedidos los cobras tú, con el sistema del operador.</li>
          <li>La institución puede suspender un local que no cumpla.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Uso correcto</h2>
        <p>
          No uses la app para pedidos falsos, para suplantar a otra persona ni para intentar acceder a datos ajenos. Podemos
          suspender las cuentas que lo hagan.
        </p>
        <p className="muted small">
          Este texto resume las reglas de uso del servicio durante su etapa piloto y puede actualizarse.
        </p>
      </section>
    </main>
  );
}

const FAQ: [string, string][] = [
  [`¿Cómo funciona ${BRAND}?`, 'Eliges un local de tu sede, armas tu pedido y escoges a qué hora lo retiras. El local lo recibe al instante y lo prepara para esa hora. Cuando está listo te avisamos; llegas, muestras tu código y te lo llevas.'],
  ['¿Con cuánta anticipación tengo que pedir?', 'Cada local define cuánto necesita para preparar. La app solo te muestra las horas que todavía alcanzan, partiendo por la más cercana. También puedes dejar pedido para mañana.'],
  ['¿Por qué una hora aparece como "Lleno"?', 'Cada local acepta una cantidad limitada de pedidos cada 10 minutos, para poder tenerlos todos a tiempo. Si una hora se llenó, elige la siguiente.'],
  ['¿Cómo retiro mi pedido?', 'Abre el pedido en la app y muestra el código QR o el código de seis caracteres. El local lo escanea o lo escribe y te entrega tu pedido.'],
  ['¿Puedo cancelar?', 'Sí, mientras el local no haya aceptado el pedido. Después de eso ya no se puede cancelar desde la app.'],
  ['¿Qué pasa si no retiro un pedido?', 'El local lo preparó para ti, así que lo marca como no retirado. Si acumulas tres en 30 días, tu cuenta no puede hacer pedidos nuevos hasta que alguno salga de ese período.'],
  ['¿Cómo pago?', 'Pagas en la app al confirmar el pedido, y el local lo recibe apenas se aprueba el pago. Algunos locales también permiten pagar al retirar, en efectivo o con Junaeb: puedes tener un pedido así a la vez, y si no lo retiras, por 30 días solo podrás pagar en la app. Si el local rechaza tu pedido o cancelas antes de que lo acepte, te devolvemos el pago.'],
  ['¿Puedo pagar con mi beca Junaeb?', 'Sí, en los locales que dicen «Junaeb». Eliges «Junaeb al retirar» y pagas en el mesón con la app de tu beca: Ticket Junaeb (Edenred) en regiones o Pluxee Chile en la Región Metropolitana. Como tu pedido ya está listo y el monto es exacto, pagar toma segundos. La beca no se puede cobrar dentro de la app: Junaeb no lo permite a apps externas.'],
  ['¿Para qué sirven mis recreos?', 'Si guardas tus recreos en tu perfil, al pedir te proponemos retirar justo cuando empieza el próximo, y en las horas de retiro marcamos las que calzan con tu horario. Así llegas, retiras y te queda el recreo para comer.'],
  ['¿Qué pasa si cierro la app antes de pagar?', 'Tu pedido queda guardado con la hora reservada por unos minutos. Ábrelo desde Pedidos y toca Pagar. Si no se paga a tiempo, la reserva se libera sola y no se cobra nada.'],
  ['No me llegan los avisos', `Actívalos en tu perfil. En iPhone primero debes agregar ${BRAND} a tu pantalla de inicio y abrirla desde ahí. Con la app abierta, los avisos llegan siempre.`],
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
          <li>Tus pedidos: qué pediste, en qué local y a qué hora.</li>
          <li>Las calificaciones y comentarios que dejas a los locales.</li>
          <li>Si activas los avisos, el identificador que tu navegador entrega para enviarte notificaciones.</li>
          <li>Si los indicas, que tienes beca Junaeb y los horarios de tus recreos.</li>
        </ul>
        <p>
          No guardamos los datos de tu tarjeta ni tu ubicación. Los pagos en la app los procesa el proveedor de pagos
          (Mercado Pago): {BRAND} solo recibe la confirmación de que el pago se aprobó. De tu beca Junaeb no guardamos tu
          RUT, tu clave ni tu saldo: la pagas directamente en el local.
        </p>
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
