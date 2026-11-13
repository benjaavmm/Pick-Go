import '@fontsource-variable/nunito';
import '@fontsource/caveat-brush';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login, Register, RegisterShop } from './pages/auth';
import { ShopLayout, ShopMenu, ShopOrders, ShopSettings } from './pages/shop';
import { Checkout, Home, OrderDetail, Orders, Profile, ShopPage, StudentLayout } from './pages/student';
import { AppProvider, useApp } from './state';
import './styles.css';

function Routing() {
  const { user, loading } = useApp();
  if (loading) return <div className="splash">Pick&amp;Go</div>;
  if (!user)
    return (
      <Routes>
        <Route path="/registro" element={<Register />} />
        <Route path="/registro-local" element={<RegisterShop />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  if (user.role === 'shop')
    return (
      <Routes>
        <Route element={<ShopLayout />}>
          <Route path="/panel" element={<ShopOrders />} />
          <Route path="/panel/menu" element={<ShopMenu />} />
          <Route path="/panel/ajustes" element={<ShopSettings />} />
        </Route>
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routing />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
