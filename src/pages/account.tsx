import { BellRing, ChevronRight, Download, FileDown, KeyRound, LogOut, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../lib';
import { useApp } from '../state';
import { Sheet } from '../ui';
import { PasswordInput } from './auth';

function Notifications({ text }: { text: string }) {
  const { push, enablePush } = useApp();
  return (
    <section className="card setting">
      <span className="setting-icon" aria-hidden>
        <BellRing size={20} />
      </span>
      <div className="grow">
        <strong>Avisos</strong>
        <p className="muted">{text}</p>
        {push === 'on' && <span className="tag tag-on">Activados en este dispositivo</span>}
        {push === 'denied' && (
          <p className="hint">Están bloqueados. Actívalos en los ajustes de notificaciones de tu navegador para este sitio.</p>
        )}
        {push === 'ios-install' && (
          <p className="hint">
            En iPhone, primero agrega Pick&amp;Go a tu pantalla de inicio: toca Compartir y luego «Agregar a inicio». Después
            abre la app desde ahí y activa los avisos.
          </p>
        )}
        {push === 'unsupported' && (
          <p className="hint">Este navegador no admite avisos con la app cerrada. Dentro de la app te avisamos igual.</p>
        )}
      </div>
      {push === 'off' && (
        <button className="btn btn-primary btn-sm" onClick={enablePush}>
          Activar
        </button>
      )}
    </section>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me/password', 'POST', { current, next });
      toast('Contraseña actualizada. Cerramos tus otras sesiones.', 'ok');
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <label>
        Contraseña actual
        <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
      </label>
      <label>
        Contraseña nueva
        <PasswordInput value={next} onChange={setNext} autoComplete="new-password" minLength={8} />
        <small>Mínimo 8 caracteres.</small>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={busy}>
        Cambiar contraseña
      </button>
    </form>
  );
}

function DeleteForm() {
  const { setUser, clearCart } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me/delete', 'POST', { password });
      clearCart();
      setUser(null);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <p>
        Vamos a borrar tu nombre, tu correo y tu acceso. Tus pedidos anteriores quedan sin tus datos, para la contabilidad
        de los locales. Esto no se puede deshacer.
      </p>
      <label>
        Confirma con tu contraseña
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-danger btn-block" disabled={busy}>
        Eliminar mi cuenta
      </button>
    </form>
  );
}

/** Ajustes de cuenta comunes a estudiantes, locales e instituciones. */
export function AccountSettings({ notifyText }: { notifyText?: string }) {
  const { user, logout, toast, canInstall, install } = useApp();
  const [sheet, setSheet] = useState<null | 'password' | 'delete'>(null);

  const logoutAll = async () => {
    try {
      await api('/me/logout-all', 'POST');
      toast('Cerramos tus sesiones en otros dispositivos', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <>
      {notifyText && <Notifications text={notifyText} />}
      {canInstall && (
        <section className="card setting">
          <span className="setting-icon" aria-hidden>
            <Download size={20} />
          </span>
          <div className="grow">
            <strong>Instalar la app</strong>
            <p className="muted">Ábrela desde tu pantalla de inicio, como cualquier otra app.</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={install}>
            Instalar
          </button>
        </section>
      )}

      <h2 className="section">Seguridad y privacidad</h2>
      <div className="card menu">
        <button onClick={() => setSheet('password')}>
          <KeyRound size={20} aria-hidden />
          Cambiar contraseña
          <ChevronRight size={18} aria-hidden />
        </button>
        <button onClick={logoutAll}>
          <Smartphone size={20} aria-hidden />
          Cerrar sesión en otros dispositivos
          <ChevronRight size={18} aria-hidden />
        </button>
        <a href="/api/me/export" download="mis-datos-pickgo.json">
          <FileDown size={20} aria-hidden />
          Descargar mis datos
          <ChevronRight size={18} aria-hidden />
        </a>
        <Link to="/privacidad">
          <ShieldCheck size={20} aria-hidden />
          Privacidad y seguridad
          <ChevronRight size={18} aria-hidden />
        </Link>
        {user!.role === 'student' && (
          <button className="danger" onClick={() => setSheet('delete')}>
            <Trash2 size={20} aria-hidden />
            Eliminar mi cuenta
            <ChevronRight size={18} aria-hidden />
          </button>
        )}
      </div>

      <button className="btn btn-soft btn-block" onClick={logout}>
        <LogOut size={18} aria-hidden /> Cerrar sesión
      </button>

      {sheet === 'password' && (
        <Sheet title="Cambiar contraseña" onClose={() => setSheet(null)}>
          <PasswordForm onDone={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Sheet title="Eliminar mi cuenta" onClose={() => setSheet(null)}>
          <DeleteForm />
        </Sheet>
      )}
    </>
  );
}
