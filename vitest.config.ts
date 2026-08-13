import { defineConfig } from 'vitest/config';

// Tests live next to the code they cover. Each package is a project so that a
// single run at the workspace root covers everything, and `--project <name>`
// narrows it down to one package.
export default defineConfig({
  test: {
    // Every test name is printed, not just the failures. A run is the only
    // report on the scheduler that someone who does not read code can use, so
    // the names have to say what was checked, and the notes a test attaches to
    // itself (the size of the differential run, for one) have to be visible.
    reporters: ['verbose'],
    projects: [
      {
        test: {
          name: 'core',
          root: 'packages/core',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'shared',
          root: 'packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        // The browser half. jsdom rather than a real browser: what is worth
        // testing here is the wiring, and the two things a real browser would
        // add, layout and paint, are checked by hand at 375 px instead.
        test: {
          name: 'web',
          root: 'apps/web',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['src/testing/setup.ts'],
          globals: true,
        },
      },
      {
        test: {
          name: 'api',
          root: 'apps/api',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          // Some of these talk to a real Postgres in another country, so a
          // round trip is tens of milliseconds and a test that makes a few
          // hundred of them needs more than the default five seconds.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // Brings the test database up to the schema and empties it once,
          // before any file runs.
          globalSetup: ['src/db/testing/global-setup.ts'],
        },
      },
    ],
  },
});
