import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            // Suppress benign client-side aborts/resets on tab reload
            if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
            console.warn('[Vite Proxy]', err.message);
          });
        }
      }
    }
  }
});
