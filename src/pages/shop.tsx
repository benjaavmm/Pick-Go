import {
  BellRing,
  Camera,
  ChartColumn,
  ClipboardList,
  Hourglass,
  FileDown,
  Gift,
  Pause,
  Pencil,
  Play,
  Plus,
  Printer,
  ScanLine,
  Settings,
  Star,
  Store,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
  Wallet,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  api,
  ApiError,
  BAES,
  baesName,
  type BaesOperator,
  errorText,
  hhmm,
  minutesUntil,
  money,
  moneyShort,
  optionsText,
  shortDay,
  slotLabel,
  toMinutes,
  type OptionGroup,
  type Order,
  type Product,
  type Shop,
  type Impact,
  type Promo,
  type ShopPayouts,
  type ShopStats,
  percent,
  type Status,
  type User,
} from '../lib';
import { BRAND } from '../brand';
import { beep, useApp, useLoad, useOrderEvents, useTick } from '../state';
import { BarChart, Empty, Kpi, Loading, Logo, ProductTile, Sheet } from '../ui';
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
            // AT: códigos actuales; PG: pedidos hechos antes del cambio de nombre.
            if (text && /^(AT|PG)[A-Z0-9]{4,8}$/.test(text)) {
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
  recibido: { to: 'preparando', label: 'Aceptar y preparar' },
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

const REASONS = ['Se agotó un producto', 'No alcanzamos a tenerlo a esa hora', 'Estamos cerrando'];

/** Al rechazar o cancelar, el local elige un motivo: el estudiante lo ve y sabe qué hacer. */
function RejectSheet({ o, onClose, onConfirm }: { o: Order; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState('');
  const custom = reason === '';
  return (
    <Sheet title={`${o.status === 'recibido' ? 'Rechazar' : 'Cancelar'} pedido de ${o.customer_name}`} onClose={onClose}>
      <p className="muted">
        Le avisaremos a {o.customer_name} con el motivo.
        {o.payment_method === 'app' && ' Como pagó en la app, le devolveremos el dinero automáticamente.'}
      </p>
      <div className="stack" role="radiogroup" aria-label="Motivo">
        {[...REASONS, ''].map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={`opt-choice ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>
            <span className="grow">{r || 'Otro motivo'}</span>
          </button>
        ))}
      </div>
      {custom && (
        <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={120} placeholder="Escribe el motivo" aria-label="Otro motivo" autoFocus />
      )}
      <button className="btn btn-danger btn-block" disabled={custom && !other.trim()} onClick={() => onConfirm(custom ? other.trim() : reason)}>
        {o.status === 'recibido' ? 'Rechazar pedido' : 'Cancelar pedido'}
      </button>
    </Sheet>
  );
}

/** Imprime la comanda de un pedido en la impresora que tenga el equipo. */
function printOrder(id: number) {
  const card = document.querySelector(`.ticket-card[data-order="${id}"]`);
  if (!card) return;
  document.body.classList.add('printing');
  card.classList.add('print-me');
  const done = () => {
    document.body.classList.remove('printing');
    card.classList.remove('print-me');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Entregar exige el código que muestra el estudiante: se escribe o se escanea su QR. */
function DeliverSheet({ o, onClose, onDeliver }: { o: Order; onClose: () => void; onDeliver: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const submit = async (value: string) => {
    setBusy(true);
    if (await onDeliver(value)) onClose();
    else setBusy(false);
  };
  if (scanning) return <Scanner onClose={() => setScanning(false)} onCode={(c) => { setScanning(false); void submit(c); }} />;
  return (
    <Sheet title={`Entregar a ${o.customer_name}`} onClose={onClose}>
      <p>
        Pídele a <strong>{o.customer_name}</strong> su código de retiro. Lo tiene en su pedido, en la app. Sin el código
        correcto no se puede entregar.
        {o.payment_method === 'junaeb' && !o.paid && ' Después te pedimos confirmar el cobro con la beca Junaeb.'}
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <label>
          Código de retiro
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="AT····"
            maxLength={10}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || code.trim().length < 4}>
          {busy ? 'Revisando…' : 'Confirmar entrega'}
        </button>
        <button type="button" className="btn btn-soft btn-block" onClick={() => setScanning(true)}>
          <ScanLine size={20} aria-hidden /> Escanear su QR
        </button>
      </form>
    </Sheet>
  );
}

interface Charge {
  orderId: number;
  code: string;
  total: number;
  operator: BaesOperator;
  customer: string;
}

/**
 * Cobro con beca Junaeb al entregar. El pedido ya está listo y el monto es fijo: el local cobra con el sistema de su
 * operador y confirma aquí. Si la beca no pasa, el estudiante paga con otro medio y queda registrado.
 */
function ChargeSheet({ c, onClose, onConfirm }: { c: Charge; onClose: () => void; onConfirm: (how: 'junaeb' | 'otro') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const op = BAES[c.operator] ?? BAES.edenred;
  const go = async (how: 'junaeb' | 'otro') => {
    setBusy(true);
    await onConfirm(how);
    setBusy(false);
  };
  return (
    <Sheet title={`Cobrar a ${c.customer} con beca Junaeb`} onClose={onClose}>
      <div className="charge">
        <span className="charge-kicker">
          <Wallet size={16} aria-hidden /> {op.app} ({op.name})
        </span>
        <b className="charge-amount">{money(c.total)}</b>
        <p>{op.shop(money(c.total))}</p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => go('junaeb')}>
        Cobrado con la beca · Entregar
      </button>
      <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => go('otro')}>
        La beca no pasó: pagó con otro medio · Entregar
      </button>
      <p className="muted small center">El código de retiro ({c.code}) ya está verificado.</p>
    </Sheet>
  );
}

function OrderCard({
  o,
  onMove,
  onReject,
  onDeliver,
}: {
  o: Order;
  onMove: (o: Order, to: Status) => void;
  onReject: (o: Order) => void;
  onDeliver: (o: Order) => void;
}) {
  const next = NEXT[o.status];
  const when = eta(o.slot);
  const noShow = o.status === 'listo' && minutesUntil(o.slot) <= -10;
  return (
    <article className="ticket-card" data-order={o.id}>
      <header>
        <b className="slot-time">{o.slot.slice(11)}</b>
        <span className={`eta ${when.late ? 'late' : ''}`}>{when.text}</span>
        <span className="order-ref">N.º {o.id}</span>
        <button className="icon-btn no-print" aria-label={`Imprimir comanda de ${o.customer_name}`} onClick={() => printOrder(o.id)}>
          <Printer size={18} />
        </button>
      </header>
      <p className="customer">{o.customer_name}</p>
      <ul className="lines">
        {o.items.map((i) => (
          <li key={i.id}>
            <span>
              <b>{i.qty}×</b> {i.name}
              {i.options.length > 0 && <small className="item-options">{optionsText(i.options)}</small>}
            </span>
          </li>
        ))}
      </ul>
      {o.note && <p className="note">{o.note}</p>}
      {o.reward_discount > 0 && <p className="paid">Incluye premio de la tarjeta de sellos</p>}
      {o.payment_method === 'junaeb' && !o.paid ? (
        <p className="collect collect-baes">
          <Wallet size={16} aria-hidden /> Cobrar {money(o.total)} con beca Junaeb ({BAES[o.baes_operator]?.name ?? 'operador'})
        </p>
      ) : (
        <p className={o.paid ? 'paid' : 'collect'}>
          {o.payment_method === 'app' ? 'Pagado en la app' : o.paid ? 'Pagado' : `Cobrar ${money(o.total)} al entregar`}
        </p>
      )}
      <div className="ticket-actions">
        {next && (
          <button className="btn btn-primary" onClick={() => (next.to === 'entregado' ? onDeliver(o) : onMove(o, next.to))}>
            {next.label}
          </button>
        )}
        {noShow ? (
          <button
            className="btn btn-ghost"
            onClick={() => window.confirm(`¿Marcar el pedido de ${o.customer_name} como no retirado?`) && onMove(o, 'no_retirado')}
          >
            No vino
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => onReject(o)}>
            {o.status === 'recibido' ? 'Rechazar' : 'Cancelar'}
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

  // Modo mostrador: la pantalla no se apaga mientras el tablero está abierto.
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock;
    if (!wl) return;
    let lock: Lock | null = null;
    const hold = () => {
      if (document.visibilityState === 'visible') wl.request('screen').then((l) => (lock = l), () => {});
    };
    hold();
    document.addEventListener('visibilitychange', hold);
    return () => {
      document.removeEventListener('visibilitychange', hold);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Mientras haya pedidos sin aceptar, la alerta se repite: un solo sonido se pierde con el ruido del local.
  const [sound, setSound] = useState(false);
  const waiting = (data?.orders ?? []).filter((o) => o.status === 'recibido').length;
  useEffect(() => {
    if (!sound || waiting === 0) return;
    const t = setInterval(beep, 7000);
    return () => clearInterval(t);
  }, [sound, waiting]);

  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [autoPrint, setAutoPrint] = useState(() => {
    try {
      return localStorage.getItem('altiro.autoprint') === '1';
    } catch {
      return false;
    }
  });
  const toggleAutoPrint = () => {
    const v = !autoPrint;
    setAutoPrint(v);
    try {
      localStorage.setItem('altiro.autoprint', v ? '1' : '0');
    } catch {
      /* almacenamiento no disponible */
    }
  };
  const move = async (o: Order, to: Status, reason?: string) => {
    // Con impresión automática, la comanda sale al aceptar el pedido.
    if (autoPrint && to === 'preparando') printOrder(o.id);
    try {
      await api(`/shop/orders/${o.id}/status`, 'POST', { status: to, reason });
      if (to === 'listo') toast(`Avisamos a ${o.customer_name} que su pedido está listo`, 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
    reload();
  };
  const [delivering, setDelivering] = useState<Order | null>(null);
  const [charging, setCharging] = useState<Charge | null>(null);
  const deliver = async (value: string, orderId?: number, charge?: 'junaeb' | 'otro') => {
    let ok = false;
    try {
      const o = await api<Order>('/shop/pickup', 'POST', { code: value, orderId, charge });
      toast(`Pedido entregado a ${o.customer_name}`, 'ok');
      setCode('');
      setCharging(null);
      ok = true;
    } catch (err) {
      // Pedido con beca Junaeb: el código es correcto, falta confirmar el cobro.
      const pending = err instanceof ApiError ? (err.data.charge as Charge | undefined) : undefined;
      if (pending) {
        setCharging({ ...pending, code: value });
        setCode('');
        ok = true;
      } else toast(errorText(err), 'error');
    }
    reload();
    return ok;
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
    { status: 'recibido', title: 'Por aceptar', empty: 'Sin pedidos nuevos' },
    { status: 'preparando', title: 'En preparación', empty: 'Nada en preparación' },
    { status: 'listo', title: 'Listos para retirar', empty: 'Nada esperando retiro' },
  ];

  return (
    <main className="panel-body">
      <label className="switch print-toggle">
        <input type="checkbox" role="switch" checked={autoPrint} onChange={toggleAutoPrint} />
        <span aria-hidden />
        <Printer size={16} aria-hidden /> Imprimir la comanda al aceptar cada pedido
      </label>
      <section className="panel-top">
        <form className="pickup-form" onSubmit={pickup}>
          <label htmlFor="pickup-code">Entregar por código</label>
          <div>
            <input
              id="pickup-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AT····"
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
      {!sound && (
        <button
          className="banner banner-link banner-button"
          onClick={() => {
            // Los navegadores solo permiten sonido después de que la persona toca la pantalla.
            beep();
            setSound(true);
          }}
        >
          <BellRing size={18} aria-hidden />
          <span>
            <strong>Activa el sonido de alerta.</strong> Tócalo al abrir el tablero: sonará cada vez que entre un pedido y
            seguirá sonando hasta que lo aceptes.
          </span>
        </button>
      )}
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
              <OrderCard key={o.id} o={o} onMove={move} onReject={setRejecting} onDeliver={setDelivering} />
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
      {delivering && <DeliverSheet o={delivering} onClose={() => setDelivering(null)} onDeliver={(c) => deliver(c, delivering.id)} />}
      {charging && (
        <ChargeSheet
          c={charging}
          onClose={() => setCharging(null)}
          onConfirm={async (how) => {
            await deliver(charging.code, charging.orderId, how);
          }}
        />
      )}
      {rejecting && (
        <RejectSheet
          o={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            void move(rejecting, 'cancelado', reason);
            setRejecting(null);
          }}
        />
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

function change(now: number, before: number) {
  if (before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: `${pct > 0 ? '+' : ''}${pct} % vs. período anterior` };
}

/** Lo que la app le generó al local: el resumen para el dueño. */
function ImpactPanel({ i }: { i: Impact }) {
  const sales = change(i.sales, i.previous.sales);
  const peak = i.peak_hours.length ? i.peak_hours.map((h) => `${h}:00`).join(', ') : null;
  const hours = Math.floor(i.queue_minutes_saved / 60);
  const minutes = i.queue_minutes_saved % 60;
  if (i.delivered === 0 && i.no_show_paid === 0)
    return (
      <section className="impact">
        <h2>Lo que ganaste con {BRAND}</h2>
        <p className="impact-note">Cuando entregues tus primeros pedidos, aquí verás cuánto vendiste por la app y cuánta fila te ahorraste.</p>
      </section>
    );
  return (
    <section className="impact">
      <h2>Lo que ganaste con {BRAND}</h2>
      <div className="impact-grid">
        <div className="impact-item">
          <span>Vendiste por la app</span>
          <b>{moneyShort(i.sales)}</b>
          <span>
            {i.delivered} pedidos entregados
            {sales && <> · <em className={sales.pct >= 0 ? 'up' : 'down'}>{sales.text}</em></>}
          </span>
        </div>
        {peak && (
          <div className="impact-item">
            <span>Pedidos en tus horas peak</span>
            <b>{i.peak_orders}</b>
            <span>A las {peak}, sin sumar gente a la fila</span>
          </div>
        )}
        <div className="impact-item">
          <span>Fila que te ahorraste</span>
          <b>{hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`}</b>
          <span>Estimado: {i.queue_minutes_per_order} min por pedido</span>
        </div>
        <div className="impact-item">
          <span>Clientes</span>
          <b>{i.customers}</b>
          <span>
            {i.new_customers} nuevos · {i.returning} volvieron más de una vez
          </span>
        </div>
        {i.promo_orders > 0 && (
          <div className="impact-item">
            <span>Ventas con promoción</span>
            <b>{moneyShort(i.promo_sales)}</b>
            <span>
              {i.promo_orders} pedidos en horas tranquilas · descuentos por {money(i.promo_given)}
            </span>
          </div>
        )}
        {i.no_show_paid > 0 && (
          <div className="impact-item">
            <span>No retirados, pero cobrados</span>
            <b>{money(i.no_show_paid_amount)}</b>
            <span>{i.no_show_paid} pedidos pagados en la app que no se perdieron</span>
          </div>
        )}
        {i.baes_orders > 0 && (
          <div className="impact-item">
            <span>Ventas con beca Junaeb</span>
            <b>{moneyShort(i.baes_sales)}</b>
            <span>{i.baes_orders} pedidos de estudiantes con beca, cobrados en segundos al retirar</span>
          </div>
        )}
        {i.rewards > 0 && (
          <div className="impact-item">
            <span>Premios de la tarjeta de sellos</span>
            <b>{i.rewards}</b>
            <span>Clientes que volvieron por su sello</span>
          </div>
        )}
      </div>
      <p className="impact-note">Últimos {i.days} días. Los minutos de fila son una estimación conservadora.</p>
    </section>
  );
}

export function ShopStatsPage() {
  const [days, setDays] = useState(7);
  const { data, error } = useLoad(() => api<ShopStats>(`/shop/stats?days=${days}`), [days]);
  const payouts = useLoad(() => api<ShopPayouts>('/shop/payouts'), []);
  const impact = useLoad(() => api<Impact>(`/shop/impact?days=${days}`), [days]);
  if (error) return <main className="panel-body narrow"><p className="error">{error}</p></main>;
  if (!data) return <main className="panel-body narrow"><Loading /></main>;
  const t = data.totals;
  const daily = days === 7 ? data.by_day : data.by_day.filter((_, i) => i % 3 === 0 || i === data.by_day.length - 1);
  const p = payouts.data;
  return (
    <main className="panel-body">
      <div className="panel-title">
        <h1>Métricas</h1>
        <div className="filters">
          <a className="btn btn-soft btn-sm" href={`/api/shop/orders.csv?days=${days}`} download>
            <FileDown size={18} aria-hidden /> Descargar pedidos
          </a>
          <RangeToggle days={days} onChange={setDays} />
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Ventas entregadas" value={moneyShort(t.sales)} hint={`Ticket promedio ${money(t.avg_ticket)}`} tone="accent" />
        <Kpi label="Pedidos" value={t.orders} hint={`${t.customers} ${t.customers === 1 ? 'cliente' : 'clientes'}`} />
        <Kpi label="A tiempo" value={t.on_time_pct === null ? '—' : `${t.on_time_pct}%`} hint="Listos a la hora de retiro" />
        <Kpi label="Calificación" value={t.rating === null ? '—' : t.rating.toFixed(1)} hint={`${t.ratings} ${t.ratings === 1 ? 'opinión' : 'opiniones'}`} />
      </div>
      {impact.data && <ImpactPanel i={impact.data} />}

      {p?.enabled && (
        <section className="card stack">
          <div className="panel-title">
            <h2>Pagos en la app</h2>
            <span className="muted small">Comisión {BRAND}: {percent(p.commission_bps)}</span>
          </div>
          <div className="kpis kpis-inline">
            <Kpi label="Por recibir" value={money(p.pending.amount)} hint={`${p.pending.orders} pedidos cerrados`} tone="accent" />
            <Kpi label="Cobrado a estudiantes" value={money(p.pending.gross)} hint={`Comisión ${money(p.pending.fee)}`} />
            <Kpi label="En curso" value={money(p.in_progress.gross)} hint={`${p.in_progress.orders} pedidos sin entregar`} />
          </div>
          <p className="muted small">
            Se liquida lo entregado y lo no retirado. Lo que se cancela se devuelve al estudiante y no paga comisión.
          </p>
          {p.settlements.length > 0 && (
            <ul className="lines">
              {p.settlements.map((st) => (
                <li key={st.id}>
                  <span>
                    {shortDay(st.created_at.slice(0, 10))} · {st.orders} pedidos{st.reference && ` · ${st.reference}`}
                  </span>
                  <span>
                    <a href={`/api/shop/settlements/${st.id}.csv`} download>
                      {money(st.amount)}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
interface ProductForm {
  id?: number;
  category: string;
  name: string;
  description: string;
  price: string;
  emoji: string;
  image: string | null;
  imageId: number | null;
  options: OptionGroup[];
  prepMinutes: string;
}
const BLANK: ProductForm = { category: '', name: '', description: '', price: '', emoji: '', image: null, imageId: null, options: [], prepMinutes: '' };

/** Reduce la foto en el propio dispositivo antes de subirla: carga rápida con datos móviles y menos espacio. */
async function uploadPhoto(file: File): Promise<{ id: number; url: string }> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No pudimos leer esa imagen. Prueba con una foto JPG o PNG.'));
      el.src = src;
    });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob) throw new Error('No pudimos procesar esa imagen.');
    const res = await fetch('/api/shop/images', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? 'No pudimos subir la foto.');
    return data;
  } finally {
    URL.revokeObjectURL(src);
  }
}

function OptionsEditor({ value, onChange }: { value: OptionGroup[]; onChange: (v: OptionGroup[]) => void }) {
  const setGroup = (i: number, g: Partial<OptionGroup>) => onChange(value.map((x, k) => (k === i ? { ...x, ...g } : x)));
  return (
    <div className="stack">
      {value.map((g, i) => (
        <div key={i} className="editor-group">
          <div className="editor-row">
            <input
              value={g.name}
              onChange={(e) => setGroup(i, { name: e.target.value })}
              placeholder="Nombre del grupo. Ej.: Tamaño"
              aria-label="Nombre del grupo de opciones"
              maxLength={30}
              required
            />
            <button type="button" className="icon-btn danger" aria-label="Quitar grupo" onClick={() => onChange(value.filter((_, k) => k !== i))}>
              <Trash2 size={18} />
            </button>
          </div>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={g.required} onChange={(e) => setGroup(i, { required: e.target.checked })} />
              Es obligatorio elegir
            </label>
            <label className="check">
              <input type="checkbox" checked={g.multiple} onChange={(e) => setGroup(i, { multiple: e.target.checked })} />
              Se pueden elegir varias
            </label>
          </div>
          {g.choices.map((c, j) => (
            <div key={j} className="editor-row">
              <input
                value={c.name}
                onChange={(e) => setGroup(i, { choices: g.choices.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })}
                placeholder="Alternativa. Ej.: Grande"
                aria-label="Nombre de la alternativa"
                maxLength={40}
                required
              />
              <input
                className="w-price"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={c.price === 0 ? '' : c.price}
                onChange={(e) =>
                  setGroup(i, { choices: g.choices.map((x, k) => (k === j ? { ...x, price: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)) })
                }
                placeholder="+ $0"
                aria-label="Precio adicional"
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="Quitar alternativa"
                disabled={g.choices.length <= 1}
                onClick={() => setGroup(i, { choices: g.choices.filter((_, k) => k !== j) })}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={g.choices.length >= 15}
            onClick={() => setGroup(i, { choices: [...g.choices, { id: '', name: '', price: 0 }] })}
          >
            <Plus size={18} aria-hidden /> Agregar alternativa
          </button>
        </div>
      ))}
      {value.length < 8 && (
        <button
          type="button"
          className="btn btn-soft"
          onClick={() => onChange([...value, { id: '', name: '', required: false, multiple: false, choices: [{ id: '', name: '', price: 0 }] }])}
        >
          <Plus size={18} aria-hidden /> Agregar grupo de opciones
        </button>
      )}
    </div>
  );
}

export function ShopMenu() {
  const { user, toast } = useApp();
  const { data, reload } = useLoad(() => api<{ products: Product[] }>(`/shops/${user!.shop_id}`), []);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [uploading, setUploading] = useState(false);
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
    const body = {
      category: form.category,
      name: form.name,
      description: form.description,
      price: Number(form.price),
      emoji: form.emoji,
      imageId: form.imageId,
      options: form.options,
      prepMinutes: Number(form.prepMinutes || 0),
    };
    void run(async () => {
      await (form.id ? api(`/shop/products/${form.id}`, 'PATCH', body) : api('/shop/products', 'POST', body));
      setForm(null);
    });
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file || !form) return;
    setUploading(true);
    try {
      const up = await uploadPhoto(file);
      setForm((f) => (f ? { ...f, image: up.url, imageId: up.id } : f));
    } catch (e) {
      toast(errorText(e), 'error');
    }
    setUploading(false);
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
                  <ProductTile image={p.image} emoji={p.emoji} />
                  <div className="grow">
                    <strong>{p.name}</strong>
                    {p.description && <span className="muted clamp">{p.description}</span>}
                    <span className="price">{money(p.price)}</span>
                    {p.options.length > 0 && <span className="muted">Opciones: {p.options.map((g) => g.name).join(', ')}</span>}
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
                          setForm({
                            id: p.id,
                            category: p.category,
                            name: p.name,
                            description: p.description,
                            price: String(p.price),
                            emoji: p.emoji,
                            image: p.image,
                            imageId: p.image ? Number(p.image.split('/').pop()) : null,
                            options: p.options,
                            prepMinutes: p.prep_minutes ? String(p.prep_minutes) : '',
                          })
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
            <div className="photo-field">
              <ProductTile image={form.image} emoji={form.emoji} large />
              <div className="grow stack">
                <span className="muted small">La foto y el ícono son opcionales. Si no pones ninguno, se muestra un ícono genérico.</span>
                <div className="photo-actions">
                  <label className="btn btn-soft btn-sm">
                    <Camera size={18} aria-hidden /> {uploading ? 'Subiendo…' : form.image ? 'Cambiar foto' : 'Subir foto'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                  </label>
                  {form.image && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, image: null, imageId: null })}>
                      Quitar foto
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="form-row">
              <label className="w-emoji">
                Ícono
                <input value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={8} placeholder="—" />
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
            <label>
              <span>
                Tiempo de preparación (min) <span className="optional">(opcional)</span>
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={240}
                value={form.prepMinutes}
                onChange={(e) => setForm({ ...form, prepMinutes: e.target.value })}
                placeholder="El del local"
              />
              <small>Si este producto tarda más que el resto, la app solo ofrecerá horas que alcances a cumplir.</small>
            </label>
            <div className="stack">
              <strong>Opciones</strong>
              <span className="muted small">Tamaños, agregados o variantes que el estudiante elige al pedir. Cada alternativa puede sumar un valor al precio.</span>
              <OptionsEditor value={form.options} onChange={(options) => setForm({ ...form, options })} />
            </div>
            <button className="btn btn-primary btn-block" disabled={uploading}>
              Guardar producto
            </button>
          </form>
        </Sheet>
      )}
    </main>
  );
}

// ---------- Ajustes ----------
const WEEK: [string, string][] = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']];

/** Descuentos para repartir la demanda hacia horas tranquilas. */
function PromosEditor({ shop, onSave }: { shop: Shop; onSave: (p: Promo[]) => void }) {
  const [rows, setRows] = useState(shop.promos.map((p) => ({ from: hhmm(p.from), to: hhmm(p.to), percent: String(p.percent) })));
  const set = (i: number, k: 'from' | 'to' | 'percent', v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rows.map((r) => ({ from: toMinutes(r.from), to: toMinutes(r.to), percent: Number(r.percent) })));
      }}
    >
      <h2>Promociones en horas tranquilas</h2>
      <p className="muted">
        Un descuento para quienes retiren en horas de poca venta. Mueve pedidos fuera del horario peak y te vende más en
        horas muertas. Los estudiantes lo ven en tu menú y al elegir la hora.
      </p>
      <div className="promo-editor">
        {rows.map((r, i) => (
          <div key={i} className="promo-row">
            <label>
              Desde
              <input type="time" value={r.from} onChange={(e) => set(i, 'from', e.target.value)} required />
            </label>
            <label>
              Hasta
              <input type="time" value={r.to} onChange={(e) => set(i, 'to', e.target.value)} required />
            </label>
            <label>
              % menos
              <input type="number" inputMode="numeric" min={1} max={50} value={r.percent} onChange={(e) => set(i, 'percent', e.target.value)} required />
            </label>
            <button type="button" className="icon-btn danger" aria-label="Quitar promoción" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
      {rows.length < 6 && (
        <button type="button" className="btn btn-soft" onClick={() => setRows([...rows, { from: '15:00', to: '16:00', percent: '10' }])}>
          <Plus size={18} aria-hidden /> Agregar promoción
        </button>
      )}
      <button className="btn btn-primary btn-block">Guardar promociones</button>
    </form>
  );
}

/** Tarjeta de sellos: cada N pedidos entregados, un producto gratis. */
function LoyaltyEditor({ shop, onSave }: { shop: Shop; onSave: (every: number, max: number) => void }) {
  const [on, setOn] = useState(shop.loyalty_every > 0);
  const [every, setEvery] = useState(String(shop.loyalty_every || 6));
  const [max, setMax] = useState(String(shop.loyalty_max || 2500));
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(on ? Number(every) : 0, on ? Number(max) : 0);
      }}
    >
      <div className="setting">
        <span className="setting-icon" aria-hidden>
          <Gift size={20} />
        </span>
        <div className="grow">
          <strong>Tarjeta de sellos</strong>
          <p className="muted">Cada pedido entregado suma un sello. Al completar la tarjeta, el estudiante gana un producto gratis.</p>
        </div>
        <label className="switch">
          <input type="checkbox" role="switch" checked={on} aria-label="Activar tarjeta de sellos" onChange={() => setOn(!on)} />
          <span aria-hidden />
        </label>
      </div>
      {on && (
        <div className="form-row">
          <label className="grow">
            Pedidos para un premio
            <input type="number" inputMode="numeric" min={2} max={30} value={every} onChange={(e) => setEvery(e.target.value)} required />
          </label>
          <label className="grow">
            Valor máximo del regalo ($)
            <input type="number" inputMode="numeric" min={1} max={100000} value={max} onChange={(e) => setMax(e.target.value)} required />
            <small>Se regala el producto más caro del pedido, hasta este valor.</small>
          </label>
        </div>
      )}
      <button className="btn btn-primary btn-block">Guardar tarjeta de sellos</button>
    </form>
  );
}

export function ShopSettings() {
  const { toast, payments } = useApp();
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

  const [daysDraft, setDaysDraft] = useState<string | null>(null);

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
  const days = daysDraft ?? shop.days;
  const setDays = setDaysDraft;
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
        days,
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

      {payments && (
        <section className="card setting">
          <span className="setting-icon" aria-hidden>
            <Store size={20} />
          </span>
          <div className="grow">
            <strong>Permitir pagar al retirar</strong>
            <p className="muted">
              {shop.pay_at_shop
                ? 'Los estudiantes pueden elegir pagar en la app o en tu local. Si alguien no retira, ese pedido no se cobra.'
                : 'Solo recibes pedidos ya pagados en la app: no pierdes la venta si alguien no retira.'}
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={shop.pay_at_shop}
              aria-label="Permitir pagar al retirar"
              onChange={() => patch({ pay_at_shop: !shop.pay_at_shop }, shop.pay_at_shop ? 'Solo pedidos pagados en la app' : 'También aceptas pagar al retirar')}
            />
            <span aria-hidden />
          </label>
        </section>
      )}

      <section className="card setting">
        <span className="setting-icon setting-baes" aria-hidden>
          <Wallet size={20} />
        </span>
        <div className="grow">
          <strong>Recibir beca Junaeb (BAES)</strong>
          <p className="muted">
            {shop.accepts_baes
              ? `Los estudiantes con beca pueden pedir y pagar al retirar con ${baesName(shop.baes_operator)}. Al entregar, confirmas el cobro.`
              : `Actívalo solo si tu local está adherido a ${BAES[shop.baes_operator].name}, el operador de la beca en tu sede. Así te encuentran los estudiantes con beca.`}
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={shop.accepts_baes}
            aria-label="Recibir beca Junaeb"
            onChange={() => patch({ accepts_baes: !shop.accepts_baes }, shop.accepts_baes ? 'Ya no recibes la beca Junaeb' : 'Ahora recibes la beca Junaeb')}
          />
          <span aria-hidden />
        </label>
      </section>

      <section className="card setting">
        <span className="setting-icon" aria-hidden>
          <Zap size={20} />
        </span>
        <div className="grow">
          <strong>Aceptar pedidos automáticamente</strong>
          <p className="muted">
            {shop.auto_accept
              ? 'Los pedidos entran directo a preparación. Úsalo si siempre puedes cumplir lo que está en el menú.'
              : 'Hoy revisas y aceptas cada pedido. Actívalo si en las horas peak no alcanzas a tocar la pantalla.'}
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={shop.auto_accept}
            aria-label="Aceptar pedidos automáticamente"
            onChange={() => patch({ auto_accept: !shop.auto_accept }, shop.auto_accept ? 'Vuelves a aceptar cada pedido a mano' : 'Los pedidos se aceptan solos')}
          />
          <span aria-hidden />
        </label>
      </section>

      <PromosEditor shop={shop} onSave={(promos) => patch({ promos }, 'Promociones guardadas')} />
      <LoyaltyEditor
        shop={shop}
        onSave={(every, max) => patch({ loyalty_every: every, loyalty_max: max }, every ? 'Tarjeta de sellos activada' : 'Tarjeta de sellos desactivada')}
      />

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
        <fieldset className="days">
          <legend>Días que atiendes</legend>
          {WEEK.map(([d, label]) => (
            <label key={d} className={`day ${days.includes(d) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={days.includes(d)}
                onChange={() => setDays(days.includes(d) ? days.replace(d, '') : [...days, d].sort().join(''))}
              />
              {label}
            </label>
          ))}
        </fieldset>
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
