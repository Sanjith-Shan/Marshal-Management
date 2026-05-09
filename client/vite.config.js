import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HTTPS is opt-in via the HTTPS=1 env var (set by `npm run dev:quest`).
// Default `npm run dev` runs over plain HTTP so the desktop browser
// doesn't have to click through a self-signed cert warning.
// HTTPS is required only for WebXR `immersive-ar` over LAN — turn it on
// when you want to load the page on a Quest 3.
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, 'public'),
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: useHttps,
    cors: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true }
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true
  }
});
