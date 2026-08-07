import { Hono } from 'hono';

import { registerRoutes } from './create-app.js';

/**
 * The entry point Vercel deploys. It has to create the Hono app here, because
 * the builder looks for an entry file that imports hono directly.
 *
 * Local development starts from dev.ts instead, since there the environment
 * has to be read out of .env before anything else runs.
 */
export default registerRoutes(new Hono());
