import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// HTTPS is required for WebXR `immersive-ar` even on LAN. The basic-ssl
// plugin generates a self-signed cert at startup so the Quest 3 browser
// can hit https://<lan-ip>:5173. Quest will show a cert warning on first
// connect — tap "Advanced → Proceed" once.
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [basicSsl()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: true,
    // Allow connections from any LAN host (Quest comes in as the device IP).
    // Vite 5 disables host header validation when host: '0.0.0.0' but be explicit.
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
