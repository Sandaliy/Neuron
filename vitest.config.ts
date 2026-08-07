import { defineConfig } from 'vitest/config';

// Tests live next to the code they cover. Each package is a project so that a
// single run at the workspace root covers everything, and `--project <name>`
// narrows it down to one package.
export default defineConfig({
  test: {
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
        test: {
          name: 'api',
          root: 'apps/api',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
