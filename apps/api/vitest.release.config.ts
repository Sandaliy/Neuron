import { defineConfig } from 'vitest/config';

/**
 * The migration regression owns its throwaway databases from creation through
 * deletion, so it deliberately does not use the normal API database setup.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/db/release/release-safety.test.ts'],
    root: import.meta.dirname,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
});
