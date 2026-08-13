import path from 'node:path';

import js from '@eslint/js';
import prettierCompat from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Globals the DOM lib declares and the server does not have.
 *
 * Deliberately not a blanket ban on everything the DOM lib adds: `Request`,
 * `Response`, `Headers`, `URL` and `fetch` all exist on the Node runtime and
 * Hono is built on them. These are the ones that only ever exist in a page.
 */
const BROWSER_ONLY_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'history',
  'screen',
  'alert',
  'confirm',
  'prompt',
  'requestAnimationFrame',
  'matchMedia',
];

const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.turbo/**',
  // What `vercel build` leaves behind. Running that build is part of the push
  // checks, so without this the next lint reads its bundled output.
  '**/.vercel/**',
  '**/*.d.ts',
];

/**
 * Builds the ESLint configuration for the whole workspace.
 *
 * It takes the repository root so that the dependency direction rules can be
 * expressed as absolute paths and stay correct no matter which directory the
 * command is run from.
 *
 * @param {{ rootDir: string }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNeuronEslintConfig({ rootDir }) {
  const appsDir = path.join(rootDir, 'apps');
  const packagesDir = path.join(rootDir, 'packages');
  const coreDir = path.join(packagesDir, 'core');

  return tseslint.config(
    { ignores },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
      plugins: { 'import-x': importX },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/consistent-type-imports': 'error',
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
            pathGroups: [{ pattern: '@neuron/**', group: 'internal', position: 'before' }],
            pathGroupsExcludedImportTypes: ['builtin'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        'import-x/no-duplicates': 'error',
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSEnumDeclaration',
            message: 'Use a union of string literals or a const object instead of an enum.',
          },
        ],
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-var': 'error',
        'prefer-const': 'error',
        'object-shorthand': 'error',
      },
    },

    // Configuration files and scripts run in Node.
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.config.ts'],
      languageOptions: { globals: globals.node },
    },

    // packages/core is the scheduling algorithm. It has to produce identical
    // results in the browser and on the server, so it depends on nothing:
    // not on other workspace packages, not on the apps, not on Node or the DOM.
    {
      files: ['packages/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@neuron/*', '@neuron/*/**'],
                message: 'packages/core must not depend on another workspace package.',
              },
              {
                group: ['**/apps/**', '**/packages/!(core)/**'],
                message: 'packages/core must not reach into apps or into another package.',
              },
              {
                group: ['node:*', 'fs', 'path', 'crypto', 'os'],
                message: 'packages/core must run unchanged in the browser, so no Node built-ins.',
              },
            ],
          },
        ],
        'import-x/no-restricted-paths': [
          'error',
          {
            basePath: rootDir,
            zones: [
              {
                target: coreDir,
                from: appsDir,
                message: 'packages/core must not import from apps.',
              },
              {
                target: coreDir,
                from: packagesDir,
                except: [coreDir],
                message: 'packages/core must not import from another package.',
              },
            ],
          },
        ],
      },
    },

    // The simulator is a development tool. It sits outside src, never ships,
    // and has to write a CSV and four charts, so it is the one place in the
    // package allowed to reach for Node. It still may not touch another
    // workspace package, and the isolation check in scripts/ still covers
    // everything under src.
    {
      files: ['packages/core/sim/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@neuron/*', '@neuron/*/**'],
                message: 'packages/core must not depend on another workspace package.',
              },
              {
                group: ['**/apps/**', '**/packages/!(core)/**'],
                message: 'packages/core must not reach into apps or into another package.',
              },
            ],
          },
        ],
      },
    },

    // apps/api runs on the server, where none of these exist.
    //
    // The api's tsconfig pulls in the DOM lib, because Hono is typed against
    // the web Request and Response and the fetch handler signature comes from
    // there. That lib also tells the compiler that `window` and `localStorage`
    // exist, which on Vercel Functions they do not. A typo would then typecheck
    // cleanly, build cleanly, deploy, and throw on the first request that
    // reached it. This rule is the barrier the type checker cannot be.
    {
      files: ['apps/api/**/*.ts'],
      rules: {
        'no-restricted-globals': [
          'error',
          ...BROWSER_ONLY_GLOBALS.map((name) => ({
            name,
            message: `${name} does not exist on the server. The DOM lib in apps/api/tsconfig.json only makes the compiler believe it does.`,
          })),
        ],
      },
    },

    // apps/web is the browser half, so the same globals are simply available.
    {
      files: ['apps/web/**/*.{ts,tsx}'],
      languageOptions: {
        globals: globals.browser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { 'react-hooks': reactHooks },
      rules: {
        ...reactHooks.configs.recommended.rules,
      },
    },

    // Prettier owns formatting. This turns off every rule that would argue.
    prettierCompat,
  );
}
