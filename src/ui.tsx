import { ArrowLeft, Check, Star, UtensilsCrossed, X } from 'lucide-react';
import { Component, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from './brand';
import { cardStyle, inkOn, money, STATUS_LABEL, type Loyalty, type Status } from './lib';

export function Logo({ size = 'md' }: { size?: 'md' | 'lg' | 'xl' }) {
  return (
    // Logo de palabra: «Toru» en azul negro y «Go» en azul vivido.
    <span className={`logo logo-${size}`} aria-label={BRAND}>
      <span aria-hidden>
        {BRAND.slice(0, -2)}
        <span className="go">{BRAND.slice(-2)}</span>
      </span>
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
          <path className="grab-paper" d="M108 84 H192 L186 152 a10 10 0 0 1 -10 9 H124 a10 10 0 0 1 -10 -9 Z" />
          <rect className="grab-badge" x="131" y="104" width="38" height="38" rx="11" />
          <path className="grab-check" d="M141 123 l7 7 l13 -15" />
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

/** Ilustración de la portada: la bolsa de papel y el café listos para llevar, con líneas de movimiento. */
export function HeroArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`hero-art ${className}`} viewBox="0 0 240 210" aria-hidden>
      <defs>
        <pattern id="hero-dots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle className="art-dot" cx="4.5" cy="4.5" r="2" />
        </pattern>
        <pattern id="hero-dots-sun" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle className="art-dot-sun" cx="4.5" cy="4.5" r="2.2" />
        </pattern>
      </defs>
      <circle cx="196" cy="54" r="40" fill="url(#hero-dots)" />
      <circle cx="40" cy="176" r="30" fill="url(#hero-dots-sun)" />
      <path className="art-motion" d="M22 64 C8 96 9 138 26 170" />
      <path className="art-motion art-motion-2" d="M8 98 C2 116 3 132 10 148" />
      <path className="art-motion" d="M172 22 C196 14 220 26 230 48" />
      <g className="art-bag">
        <path className="art-handle" d="M74 74 C74 44 116 44 116 74" />
        <path className="art-paper" d="M44 72 H146 L152 188 a9 9 0 0 1 -9 9 H47 a9 9 0 0 1 -9 -9 Z" />
        <path className="art-fold" d="M44 72 H146 L147 88 H43 Z" />
        <rect className="art-badge" x="70" y="114" width="50" height="50" rx="14" />
        <path className="art-glyph" d="M84 132 H106 L104 152 H86 Z M89 132 v-3 a6 6 0 0 1 12 0 v3" />
      </g>
      <g className="art-cup">
        <path className="art-steam" d="M168 76 c-7 -8 7 -14 0 -23 M184 76 c-7 -8 7 -14 0 -23" />
        <rect className="art-lid-top" x="150" y="84" width="52" height="11" rx="5.5" />
        <rect className="art-lid" x="142" y="93" width="68" height="15" rx="7" />
        <path className="art-cup-body" d="M147 108 H205 L198 192 a9 9 0 0 1 -9 8 H163 a9 9 0 0 1 -9 -8 Z" />
        <circle className="art-cup-seal" cx="176" cy="150" r="17" />
        <path className="art-cup-glyph" d="M168 143 h13 v7 a6.5 6.5 0 0 1 -13 0 Z M181 145 h2 a3 3 0 0 1 0 6 h-2" />
      </g>
    </svg>
  );
}

type ShopLook = { name: string; emoji: string; color?: string; color_2?: string; logo?: string | null };

/** Logo del local; si no tiene, su ícono sobre su color de marca (o el gris de la app si no eligió color). */
export function ShopLogo({ shop, large }: { shop: ShopLook; large?: boolean }) {
  const brand = shop.color && /^#[0-9a-f]{6}$/i.test(shop.color) ? shop.color : null;
  return (
    <span
      className={`tile ${large ? 'tile-lg' : ''} ${shop.logo ? 'tile-logo' : ''}`}
      style={!shop.logo && brand ? { background: brand, color: inkOn(brand) } : undefined}
      aria-hidden
    >
      {shop.logo ? <img src={shop.logo} alt="" loading="lazy" decoding="async" /> : shop.emoji}
    </span>
  );
}

/** Tarjeta de sellos de un local, pintada con los colores del local. */
export function StampCard({ shop, card }: { shop: ShopLook; card: Loyalty }) {
  return (
    <section className="loyalty" style={cardStyle(shop.color, shop.color_2)} aria-label={`Tarjeta de sellos de ${shop.name}`}>
      <div className="loyalty-top">
        <span className={`loyalty-emoji ${shop.logo ? 'has-logo' : ''}`} aria-hidden>
          {shop.logo ? <img src={shop.logo} alt="" /> : shop.emoji}
        </span>
        <span className="loyalty-shop">{shop.name}</span>
        <span className="loyalty-tag">Tarjeta de sellos</span>
      </div>
      <div className="loyalty-head">
        <strong>{card.rewards > 0 ? `¡Tienes ${card.rewards === 1 ? 'un premio' : `${card.rewards} premios`}!` : `${card.stamps} de ${card.every} sellos`}</strong>
        <span>
          {card.rewards > 0
            ? `Úsalo en tu próximo pedido: un producto gratis hasta ${money(card.max)}.`
            : `Cada ${card.every} pedidos, un producto gratis hasta ${money(card.max)}.`}
        </span>
      </div>
      <ol className="stamps" aria-label={`${card.stamps} de ${card.every} sellos`}>
        {Array.from({ length: card.every }, (_, i) => (
          <li key={i} className={i < card.stamps ? 'on' : ''}>
            {i < card.stamps && <Check size={16} strokeWidth={3} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
