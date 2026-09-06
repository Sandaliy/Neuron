import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where the api answers while developing.
 *
 * In a Vercel deployment `vercel.ts` rewrites `/api` to the api deployment for
 * the same environment, and the browser only ever sees the web origin. Locally
 * that job falls to this proxy, for the same reason. Two origins would mean the
 * browser withholding the session cookie, and a sign in that ends in an
 * immediate sign out.
 */
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8787';

/**
 * Whether this build carries the routes under `/dev`.
 *
 * Vercel sets `VERCEL_ENV` to `production` only for the production deployment,
 * so a branch preview keeps the component gallery and the app people use does
 * not. Locally it is always on.
 */
const DEV_ROUTES = process.env.VERCEL_ENV !== 'production';

export default defineConfig({
  plugins: [react(), tailwind()],

  define: {
    __DEV_ROUTES__: JSON.stringify(DEV_ROUTES),
  },

  server: {
    // Bound to every interface so the app can be opened from a phone on the
    // same network. Mobile is the primary target, and it cannot be checked
    // from a desktop browser window narrowed to 375 px.
    host: true,
    port: 5173,
    fs: {
      /*
       * The card generation prompt is imported as text out of `docs/`, which is
       * above this app. The dev server refuses to serve anything outside its own
       * root unless it is told; the build does not care. Without this the
       * production bundle works and the dev server answers 403, which is the
       * worst way round for a thing to break.
       */
      allow: ['..', '../..'],
    },
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
