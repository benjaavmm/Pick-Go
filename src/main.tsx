import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import '@fontsource-variable/jetbrains-mono';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminAccount, AdminCampuses, AdminLayout, AdminOverview, AdminShops } from './pages/admin';
import { Login, Privacy, Register, RegisterShop } from './pages/auth';
import { ShopLayout, ShopMenu, ShopOrders, ShopSettings, ShopStatsPage } from './pages/shop';
import { Checkout, Home, OrderDetail, Orders, Profile, ShopPage, StudentLayout } from './pages/student';
import { AppProvider, useApp } from './state';
import { ErrorBoundary, Logo } from './ui';
import './styles.css';

function Routing() {
  const { user, loading } = useApp();
  const { pathname } = useLocation();
  // Cada pantalla parte arriba, también al entrar o salir de la cuenta.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, user?.id]);
  if (loading)
    return (
      <div className="splash">
        <Logo size="xl" />
      </div>
    );
  if (!user)
    return (
      <Routes>
        <Route path="/registro" element={<Register />} />
        <Route path="/registro-local" element={<RegisterShop />} />
        <Route path="/privacidad" element={<div className="app"><Privacy /></div>} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  if (user.role === 'admin')
    return (
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/institucion" element={<AdminOverview />} />
          <Route path="/institucion/locales" element={<AdminShops />} />
          <Route path="/institucion/sedes" element={<AdminCampuses />} />
          <Route path="/institucion/cuenta" element={<AdminAccount />} />
        </Route>
        <Route path="/privacidad" element={<div className="app"><Privacy back="/institucion/cuenta" /></div>} />
        <Route path="*" element={<Navigate to="/institucion" replace />} />
      </Routes>
    );
  if (user.role === 'shop')
    return (
      <Routes>
        <Route element={<ShopLayout />}>
          <Route path="/panel" element={<ShopOrders />} />
          <Route path="/panel/menu" element={<ShopMenu />} />
          <Route path="/panel/metricas" element={<ShopStatsPage />} />
          <Route path="/panel/ajustes" element={<ShopSettings />} />
        </Route>
        <Route path="/privacidad" element={<div className="app"><Privacy back="/panel/ajustes" /></div>} />
        <Route path="*" element={<Navigate to="/panel" replace />} />
      </Routes>
    );
  return (
    <Routes>
      <Route element={<StudentLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/local/:id" element={<ShopPage />} />
        <Route path="/carrito" element={<Checkout />} />
        <Route path="/pedidos" element={<Orders />} />
        <Route path="/pedidos/:id" element={<OrderDetail />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="/privacidad" element={<Privacy back="/perfil" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// El service worker solo se registra en la app compilada: en desarrollo estorbaría con la recarga en caliente.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AppProvider>
          <Routing />
        </AppProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
