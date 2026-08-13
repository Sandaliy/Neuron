import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where the api answers while developing.
 *
 * In production nothing proxies here: `vercel.json` rewrites `/api` to the api
 * deployment, and the browser only ever sees the web origin. Locally that job
 * falls to this proxy, for the same reason. Two origins would mean the browser
 * withholding the session cookie, and a sign in that ends in an immediate sign
 * out.
 */
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwind()],

  server: {
    // Bound to every interface so the app can be opened from a phone on the
    // same network. Mobile is the primary target, and it cannot be checked
    // from a desktop browser window narrowed to 375 px.
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        // The Host header is passed through unchanged. Better Auth compares
        // the request against its configured base url, and rewriting the host
        // here would make every request look like it came from somewhere else.
        changeOrigin: false,
      },
    },
  },

  build: {
    // Enough to notice a dependency that doubles the bundle, low enough to be
    // uncomfortable before it matters.
    chunkSizeWarningLimit: 600,
  },
});
