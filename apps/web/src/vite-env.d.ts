/// <reference types="vite/client" />

/**
 * Whether the routes under `/dev` exist in this build.
 *
 * Defined by `vite.config.ts` from the deployment environment: true while
 * developing and on a branch preview, false on the production build.
 */
declare const __DEV_ROUTES__: boolean;
