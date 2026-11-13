import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Nada incrustado como data: en el CSS, para que la política de seguridad (CSP) pueda ser estricta.
    assetsInlineLimit: 0,
    // Compatibilidad con celulares de varios años: Chrome 80+, Safari/iOS 13.1+, Firefox 78+.
    target: ['es2019', 'chrome80', 'safari13.1', 'firefox78'],
    cssTarget: ['chrome80', 'safari13.1', 'firefox78'],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
});
