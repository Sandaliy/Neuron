import { createApp } from './create-app.js';

/**
 * The entry point Vercel looks for. It builds the app once per instance and
 * exports it, and every route in it becomes a Vercel Function.
 *
 * The file is deliberately this small. Local development starts from dev.ts
 * instead, because there the environment has to be read from .env first.
 */
export default createApp();
