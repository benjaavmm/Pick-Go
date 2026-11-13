import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, STATUS_LABEL, type Order, type Product, type Shop, type User } from './lib';

export interface CartLine {
  productId: number;
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

interface AppState {
  user: User | null;
  loading: boolean;
  demo: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  cart: Cart;
  cartCount: number;
  cartTotal: number;
  /** Devuelve false si el carrito tiene productos de otro local y la persona no quiso reemplazarlo. */
  addToCart: (shop: Pick<Shop, 'id' | 'name'>, product: Product) => boolean;
  setQty: (productId: number, qty: number) => void;
  replaceCart: (cart: Cart) => void;
  clearCart: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
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
    if (raw) return JSON.parse(raw) as Cart;
  } catch {
    /* almacenamiento no disponible */
  }
  return EMPTY_CART;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => void ctx.close();
  } catch {
    /* el navegador bloqueó el audio */
  }
}

function systemNotify(title: string, body: string) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden)
      new Notification(title, { body, icon: '/icon.svg' });
  } catch {
    /* sin soporte de notificaciones */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [cart, setCart] = useState<Cart>(loadCart);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  useEffect(() => {
    api<{ demo: boolean }>('/config')
      .then((c) => setDemo(c.demo))
      .catch(() => {});
    api<User>('/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

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
    if (!userId) return;
    const es = new EventSource('/api/events');
    es.addEventListener('order', (ev) => {
      const detail = JSON.parse((ev as MessageEvent<string>).data) as OrderEvent;
      const o = detail.order;
      if (role === 'shop') {
        if (detail.type === 'new') {
          const text = `Nuevo pedido ${o.code} para las ${o.slot.slice(11)}`;
          toast(text, 'ok');
          beep();
          systemNotify('Nuevo pedido', text);
        } else if (o.status === 'cancelado') {
          toast(`El pedido ${o.code} fue cancelado`, 'info');
        }
      } else if (o.status !== 'recibido') {
        const text =
          o.status === 'listo'
            ? `Tu pedido ${o.code} está listo. Pasa a retirarlo en ${o.shop_name}.`
            : o.status === 'cancelado'
              ? `Tu pedido ${o.code} en ${o.shop_name} fue cancelado.`
              : `Pedido ${o.code}: ${STATUS_LABEL[o.status].toLowerCase()}.`;
        toast(text, o.status === 'cancelado' ? 'error' : 'ok');
        if (o.status === 'listo') {
          beep();
          navigator.vibrate?.([200, 100, 200]);
        }
        systemNotify('Pick&Go', text);
      }
      window.dispatchEvent(new CustomEvent('pickgo:order', { detail }));
    });
    return () => es.close();
  }, [userId, role, toast]);

  const value = useMemo<AppState>(() => {
    const cartCount = cart.lines.reduce((n, l) => n + l.qty, 0);
    const cartTotal = cart.lines.reduce((n, l) => n + l.qty * l.price, 0);
    return {
      user,
      loading,
      demo,
      setUser,
      logout: async () => {
        await api('/auth/logout', 'POST').catch(() => {});
        setUser(null);
        setCart(EMPTY_CART);
      },
      cart,
      cartCount,
      cartTotal,
      addToCart: (shop, product) => {
        const other = cart.shopId !== null && cart.shopId !== shop.id && cart.lines.length > 0;
        if (other && !window.confirm(`Tu carrito tiene productos de ${cart.shopName}. ¿Vaciarlo y pedir en ${shop.name}?`))
          return false;
        setCart((c) => {
          const base = other || c.shopId !== shop.id ? { shopId: shop.id, shopName: shop.name, lines: [] } : c;
          const found = base.lines.find((l) => l.productId === product.id);
          const lines = found
            ? base.lines.map((l) => (l.productId === product.id ? { ...l, qty: Math.min(20, l.qty + 1) } : l))
            : [
                ...base.lines,
                { productId: product.id, name: product.name, emoji: product.emoji, price: product.price, qty: 1 },
              ];
          return { ...base, lines };
        });
        return true;
      },
      setQty: (productId, qty) =>
        setCart((c) => {
          const lines = c.lines
            .map((l) => (l.productId === productId ? { ...l, qty: Math.min(20, qty) } : l))
            .filter((l) => l.qty > 0);
          return lines.length ? { ...c, lines } : EMPTY_CART;
        }),
      replaceCart: setCart,
      clearCart: () => setCart(EMPTY_CART),
      toast,
    };
  }, [user, loading, demo, cart, toast]);

  return (
    <Ctx.Provider value={value}>
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

/** Carga datos, expone estado de carga y error, y permite recargar. */
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
  return { data, error, reload, setData };
}
