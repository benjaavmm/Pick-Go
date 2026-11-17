import { ArrowLeft, Star, UtensilsCrossed, X } from 'lucide-react';
import { Component, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from './brand';
import { STATUS_LABEL, type Status } from './lib';

/** Símbolo de la marca: un reloj que da la vuelta rápido. El mismo dibujo de los íconos de la app. */
export function Mark({ className = 'mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <rect width="48" height="48" rx="14" />
      <path d="M35.7 29.3 A12.5 12.5 0 1 1 32 15.4" />
      <path d="M33.1 11.1 L34 17 L27.9 17.2" />
      <path d="M24 25 V19 M24 25 L28.3 27.6" />
    </svg>
  );
}

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`logo logo-${size}`} aria-label={BRAND}>
      <Mark />
      <span aria-hidden>{BRAND.toLowerCase()}</span>
    </span>
  );
}

export function TopBar({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <header className="topbar">
      {back && (
        <Link to={back} className="icon-btn" aria-label="Volver">
          <ArrowLeft size={22} />
        </Link>
      )}
      <h1>{title}</h1>
      {action}
    </header>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export const Loading = () => (
  <p className="loading" role="status">
    Cargando
    <i>.</i>
    <i>.</i>
    <i>.</i>
  </p>
);

/** Imagen de un producto: la foto si tiene, si no el ícono, y si tampoco, un ícono genérico. */
export function ProductTile({ image, emoji, large }: { image?: string | null; emoji?: string; large?: boolean }) {
  return (
    <span className={`tile ${large ? 'tile-lg' : ''} ${image ? 'tile-photo' : ''}`} aria-hidden>
      {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : emoji ? emoji : <UtensilsCrossed size={large ? 28 : 22} />}
    </span>
  );
}

export function ErrorBox({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="card empty">
      <p className="error">{text}</p>
      <button className="btn btn-soft" onClick={retry}>
        Reintentar
      </button>
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <span className="empty-icon" aria-hidden>
        {icon}
      </span>
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
      {children}
    </div>
  );
}

export function Rating({ value, count }: { value: number | null; count?: number }) {
  if (value === null) return <span className="rating rating-none">Nuevo</span>;
  return (
    <span className="rating" aria-label={`Calificación ${value} de 5`}>
      <Star size={14} fill="currentColor" aria-hidden />
      {value.toFixed(1)}
      {count !== undefined && <small>({count})</small>}
    </span>
  );
}

export function StarsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
          className={n <= value ? 'on' : ''}
          onClick={() => onChange(n)}
        >
          <Star size={32} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

/** Ventana modal accesible: se cierra con Escape o tocando fuera, y devuelve el foco al cerrar. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      previous?.focus();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Gráfico de barras en SVG. `highlight` marca las barras destacadas (por ejemplo, las horas peak). */
export function BarChart({
  data,
  format = String,
  label,
}: {
  data: { label: string; value: number; highlight?: boolean }[];
  format?: (n: number) => string;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 320;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const step = W / Math.max(1, data.length);
  const bar = Math.min(34, step * 0.62);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} className="chart-axis" />
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 3 : 0, ((H - top - bottom) * d.value) / max);
        const x = i * step + (step - bar) / 2;
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${format(d.value)}`}</title>
            <rect x={x} y={H - bottom - h} width={bar} height={h} rx={Math.min(6, bar / 3)} className={d.highlight ? 'chart-bar hot' : 'chart-bar'} />
            {d.value > 0 && data.length <= 12 && (
              <text x={x + bar / 2} y={H - bottom - h - 5} className="chart-value">
                {format(d.value)}
              </text>
            )}
            <text x={x + bar / 2} y={H - 6} className="chart-label">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'accent' }) {
  return (
    <div className={`kpi ${tone === 'accent' ? 'kpi-accent' : ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

/** Si algo falla al dibujar una pantalla, se muestra una salida en vez de una página en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash crash">
        <Logo size="lg" />
        <h1>Algo salió mal</h1>
        <p>Tu pedido y tu cuenta están a salvo. Vuelve a cargar la app para continuar.</p>
        <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
          Volver a cargar
        </button>
      </div>
    );
  }
}

/** Pantalla de carga: una mano entra por la izquierda, toma la bolsa y se la lleva por la derecha. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label={`Cargando ${BRAND}`}>
      <Logo size="lg" />
      <svg className="grab" viewBox="0 0 300 180" aria-hidden>
        <line className="grab-floor" x1="40" y1="165" x2="260" y2="165" />
        <ellipse className="grab-shadow" cx="150" cy="165" rx="52" ry="6" />
        <g className="grab-bag">
          <path className="grab-line" d="M128 86 C128 46 172 46 172 86" />
          <path className="grab-lime" d="M108 84 H192 L186 152 a10 10 0 0 1 -10 9 H124 a10 10 0 0 1 -10 -9 Z" />
          <path className="grab-check" d="M136 122 l10 10 l19 -22" />
        </g>
        <g className="grab-hand">
          <rect className="grab-ink" x="-60" y="38" width="172" height="30" rx="15" />
          <rect className="grab-skin" x="104" y="36" width="20" height="34" rx="6" />
          <path className="grab-skin" d="M124 40 H150 a14 14 0 0 1 14 14 v2 a14 14 0 0 1 -14 14 H124 Z" />
          <path className="grab-skin" d="M134 58 v14 a6 6 0 0 0 12 0 v-14" />
          <path className="grab-skin" d="M146 58 v14 a6 6 0 0 0 12 0 v-14" />
        </g>
      </svg>
      <p className="splash-text">
        Cargando<i>.</i>
        <i>.</i>
        <i>.</i>
      </p>
    </div>
  );
}
