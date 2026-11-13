import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, STATUS_LABEL, type Order, type Product, type Shop, type User } from './lib';

export interface CartLine {
  /** Identifica la línea: el producto más las opciones elegidas. */
  key: string;
  productId: number;
  choices: string[];
  /** Resumen de las opciones elegidas, para mostrar. */
  detail: string;
  image: string | null;
  name: string;
  emoji: string;
  price: number;
  qty: number;
}
export interface Cart {
  shopId: number | null;
  shopName: string;
  lines: CartLine[];
}
const EMPTY_CART: Cart = { shopId: null, shopName: '', lines: [] };
const CART_KEY = 'pickgo.cart';

export interface OrderEvent {
  type: 'new' | 'update';
  order: Order;
}

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error' | 'info';
}

/** 'on': avisos activos · 'off': se pueden activar · 'denied': bloqueados · 'ios-install': hay que instalar la app · 'unsupported' */
export type PushState = 'on' | 'off' | 'denied' | 'ios-install' | 'unsupported';

export type Theme = 'claro' | 'oscuro' | 'auto';
const THEME_KEY = 'pickgo.theme';
/** La pantalla de carga se muestra al menos este tiempo, para que la animación se vea completa. */
const SPLASH_MS = 2000;

// Se calcula una sola vez por carga de página: true solo la primera vez que se abre la app en esta sesión.
const SHOW_INTRO = (() => {
  try {
    if (sessionStorage.getItem('pickgo.intro')) return false;
    sessionStorage.setItem('pickgo.intro', '1');
  } catch {
    /* almacenamiento no disponible */
  }
  return true;
})();

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'oscuro' || t === 'auto') return t;
  } catch {
    /* almacenamiento no disponible */
  }
  return 'claro';
}

/** Aplica el tema al documento. El claro es el predeterminado; el oscuro solo si la persona lo elige. */
export function applyTheme(theme: Theme = storedTheme()) {
  const dark = theme === 'oscuro' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0f0b' : '#e6f7ac');
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

interface AppState {
  user: User | null;
  loading: boolean;
  /** La carga actual es la de apertura de la app y lleva la animación de la bolsa. */
  intro: boolean;
  /** No se pudo contactar al servidor al abrir la app. */
  offline: boolean;
  retry: () => void;
  /** El dispositivo tiene conexión a internet. */
  online: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  demo: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  cart: Cart;
  cartCount: number;
  cartTotal: number;
  /** Devuelve false si el carrito tiene productos de otro local y la persona no quiso reemplazarlo. */
  addToCart: (shop: Pick<Shop, 'id' | 'name'>, product: Product, choices?: string[]) => boolean;
  setQty: (key: string, qty: number) => void;
  replaceCart: (cart: Cart) => void;
  clearCart: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  push: PushState;
  enablePush: () => Promise<void>;
  canInstall: boolean;
  install: () => void;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fuera de AppProvider');
  return v;
};

/** Se suscribe a los avisos en vivo de pedidos (nuevo pedido o cambio de estado). */
export function useOrderEvents(handler: (e: OrderEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e: Event) => ref.current((e as CustomEvent<OrderEvent>).detail);
    window.addEventListener('pickgo:order', fn);
    return () => window.removeEventListener('pickgo:order', fn);
  }, []);
}

function loadCart(): Cart {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Cart;
      if (Array.isArray(c.lines) && c.lines.every((l) => typeof l.key === 'string')) return c;
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return EMPTY_CART;
}

export function beep() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.15);
    });
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    setTimeout(() => void ctx.close(), 700);
  } catch {
    /* el navegador bloqueó el audio */
  }
}

// ---------- notificaciones push ----------
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(key: string) {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function detectPush(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on';
  return 'off';
}

async function subscribePush(key: string) {
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api('/push/subscribe', 'POST', sub.toJSON());
}

export function AppProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const first = useRef(true);
  const [intro, setIntro] = useState(SHOW_INTRO);
  const [config, setConfig] = useState<{ demo: boolean; push_key: string | null }>({ demo: false, push_key: null });
  const [cart, setCart] = useState<Cart>(loadCart);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [push, setPush] = useState<PushState>('unsupported');
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-1), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadMe = useCallback(() => {
    setBoot('loading');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // La animación de la bolsa se ve una sola vez, al abrir la app; después, las cargas son un simple "Cargando".
    const intro = first.current && SHOW_INTRO;
    setIntro(intro);
    const minimum = new Promise((r) => setTimeout(r, intro && !reduced ? SPLASH_MS : 0));
    first.current = false;
    void api<User>('/me')
      .then((u): 'ready' => {
        setUser(u);
        return 'ready';
      })
      .catch((e) => {
        // Solo un 401 significa "sin sesión". Un corte de red no debe verse como si te hubieran sacado de la cuenta.
        if (e instanceof ApiError && e.status === 401) {
          setUser(null);
          return 'ready' as const;
        }
        return 'offline' as const;
      })
      .then(async (state) => {
        await minimum;
        setBoot(state);
      });
  }, []);

  useEffect(() => {
    api<{ demo: boolean; push_key: string | null }>('/config')
      .then(setConfig)
      .catch(() => {});
    loadMe();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    // Al tocar una notificación, el service worker pide abrir el pedido dentro de la app.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string' && e.data.url.startsWith('/')) navigate(e.data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstall);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [navigate, loadMe]);

  // Si la app abrió sin conexión, reintenta sola cuando vuelve la señal.
  useEffect(() => {
    if (online && boot === 'offline') loadMe();
  }, [online, boot, loadMe]);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [cart]);

  // Avisos en vivo: el servidor empuja cada pedido nuevo y cada cambio de estado.
  const userId = user?.id;
  const role = user?.role;
  useEffect(() => {
    if (!userId || (role !== 'student' && role !== 'shop')) return;
    const es = new EventSource('/api/events');
    es.addEventListener('order', (ev) => {
      const detail = JSON.parse((ev as MessageEvent<string>).data) as OrderEvent;
      const o = detail.order;
      if (role === 'shop') {
        if (detail.type === 'new') {
          toast(`Nuevo pedido ${o.code} para las ${o.slot.slice(11)}`, 'ok');
          beep();
        } else if (o.status === 'cancelado') toast(`El pedido ${o.code} fue cancelado`, 'info');
      } else if (o.status !== 'recibido' && o.status !== 'entregado') {
        const text =
          o.status === 'listo'
            ? `Tu pedido ${o.code} está listo. Pasa a retirarlo.`
            : o.status === 'cancelado'
              ? `${o.shop_name} canceló tu pedido ${o.code}.`
              : o.status === 'preparando'
                ? `${o.shop_name} aceptó tu pedido ${o.code} y lo está preparando.`
                : `Pedido ${o.code}: ${STATUS_LABEL[o.status].toLowerCase()}.`;
        toast(text, o.status === 'cancelado' || o.status === 'no_retirado' ? 'error' : 'ok');
        if (o.status === 'listo') {
          beep();
          navigator.vibrate?.([200, 100, 200]);
        }
      }
      window.dispatchEvent(new CustomEvent('pickgo:order', { detail }));
    });
    // Tras recuperar la conexión o volver a la app, las pantallas recargan sus datos.
    const refresh = () => window.dispatchEvent(new Event('pickgo:refresh'));
    let wasDown = false;
    es.onerror = () => {
      wasDown = true;
    };
    es.onopen = () => {
      if (wasDown) refresh();
      wasDown = false;
    };
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      es.close();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [userId, role, toast]);

  // Si ya había permiso de notificaciones, la suscripción se asocia sola a la cuenta que entra.
  const pushKey = config.push_key;
  useEffect(() => {
    let alive = true;
    void (async () => {
      let state = await detectPush().catch((): PushState => 'unsupported');
      if (userId && pushKey && state === 'off' && Notification.permission === 'granted') {
        await subscribePush(pushKey)
          .then(() => (state = 'on'))
          .catch(() => {});
      } else if (userId && pushKey && state === 'on') {
        await subscribePush(pushKey).catch(() => {});
      }
      if (alive) setPush(state);
    })();
    return () => {
      alive = false;
    };
  }, [userId, pushKey]);

  const enablePush = useCallback(async () => {
    if (!pushKey) return toast('Los avisos no están disponibles en este momento.', 'error');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPush(perm === 'denied' ? 'denied' : 'off');
        return;
      }
      await subscribePush(pushKey);
      setPush('on');
      toast('Avisos activados', 'ok');
    } catch {
      toast('No pudimos activar los avisos en este dispositivo.', 'error');
    }
  }, [pushKey, toast]);

  const value = useMemo<AppState>(() => {
    const cartCount = cart.lines.reduce((n, l) => n + l.qty, 0);
    const cartTotal = cart.lines.reduce((n, l) => n + l.qty * l.price, 0);
    return {
      user,
      loading: boot === 'loading',
      intro,
      offline: boot === 'offline',
      retry: loadMe,
      online,
      theme,
      setTheme: (t) => {
        try {
          localStorage.setItem(THEME_KEY, t);
        } catch {
          /* almacenamiento no disponible */
        }
        setThemeState(t);
      },
      demo: config.demo,
      setUser,
      logout: async () => {
        // Este dispositivo deja de recibir avisos de la cuenta que sale.
        const sub = await currentSubscription().catch(() => null);
        if (sub) {
          await api('/push/unsubscribe', 'POST', { endpoint: sub.endpoint }).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
        await api('/auth/logout', 'POST').catch(() => {});
        setUser(null);
        setCart(EMPTY_CART);
      },
      cart,
      cartCount,
      cartTotal,
      addToCart: (shop, product, choices = []) => {
        const other = cart.shopId !== null && cart.shopId !== shop.id && cart.lines.length > 0;
        if (other && !window.confirm(`Tu carrito tiene productos de ${cart.shopName}. ¿Vaciarlo y pedir en ${shop.name}?`))
          return false;
        setCart((c) => {
          const base = c.shopId !== shop.id ? { shopId: shop.id, shopName: shop.name, lines: [] } : c;
          const picked = product.options.flatMap((g) => g.choices.filter((ch) => choices.includes(ch.id)));
          const key = `${product.id}:${picked.map((ch) => ch.id).sort().join(',')}`;
          const found = base.lines.find((l) => l.key === key);
          const lines = found
            ? base.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l))
            : [
                ...base.lines,
                {
                  key,
                  productId: product.id,
                  choices: picked.map((ch) => ch.id),
                  detail: picked.map((ch) => ch.name).join(', '),
                  image: product.image,
                  name: product.name,
                  emoji: product.emoji,
                  price: product.price + picked.reduce((n, ch) => n + ch.price, 0),
                  qty: 1,
                },
              ];
          return { ...base, lines };
        });
        return true;
      },
      setQty: (key, qty) =>
        setCart((c) => {
          const lines = c.lines
            .map((l) => (l.key === key ? { ...l, qty: Math.min(20, qty) } : l))
            .filter((l) => l.qty > 0);
          return lines.length ? { ...c, lines } : EMPTY_CART;
        }),
      replaceCart: setCart,
      clearCart: () => setCart(EMPTY_CART),
      toast,
      push,
      enablePush,
      canInstall: !!installEvent,
      install: () => {
        void installEvent?.prompt();
        setInstallEvent(null);
      },
    };
  }, [user, boot, intro, loadMe, online, theme, config.demo, cart, toast, push, enablePush, installEvent]);

  return (
    <Ctx.Provider value={value}>
      {!online && boot === 'ready' && (
        <div className="offline-bar" role="status">
          Sin conexión. Lo que ves puede estar desactualizado.
        </div>
      )}
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Carga datos, expone estado de carga y error, y recarga sola al volver a la app o recuperar conexión. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(() => {
    ref
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  useEffect(() => {
    window.addEventListener('pickgo:refresh', reload);
    return () => window.removeEventListener('pickgo:refresh', reload);
  }, [reload]);
  return { data, error, reload, setData };
}

/** Vuelve a dibujar cada cierto tiempo, para cuentas regresivas. */
export function useTick(ms = 20000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
