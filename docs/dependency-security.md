# Dependency security review

Milestone 11 maintenance, reviewed 2026-11-05 from protected main `2a11670`.
This change updates dependencies and verification only. It adds no database migration or product feature.

## Audit and exposure

`pnpm audit --json` reports 55 findings before the update and 8 afterwards: 1 critical, 3 high,
1 moderate and 3 low. These are package/advisory findings, not 55 distinct remotely exploitable bugs.
No report is suppressed. The command still exits unsuccessfully for the findings retained below.

`pnpm audit --prod --json` reports 53 before and 7 afterwards. A workspace production audit also
includes dependencies of the configuration package and automatically installed optional peers.
For example, Better Auth's optional Drizzle Kit and Vitest peers make development tools appear below
runtime dependency paths. Audit classification alone does not establish deployed request exposure.

The GitHub Dependabot alert endpoint returned HTTP 403 with an alerts-disabled response. Counts here
come from npm's advisory data through pnpm, rather than an accessible GitHub alert inventory.

| Package and installed update                           | Applicable path and reason                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono` 4.13.0 → 4.13.16                                | API runtime and the development Node adapter. Fixes query parsing, body parsing, static serving, JSX and SSG advisories. Neuron handles JSON and uses Hono's request/query APIs; it does not use Hono JSX or SSG.                                                     |
| `zod` 4.4.3 → 4.6.7                                    | API, shared request/persistence schemas, Better Auth and lint tooling. Fixes [oversized-collection validation resource consumption](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The separate Zod 3 configuration dependency remains below.                    |
| `vite` 8.2.1 → 8.2.4                                   | Web development, preview and build tooling, including Vitest peers. Fixes six development-server/file-access/editor findings. No framework major or Vite minor upgrade.                                                                                               |
| `vitest` and its `@vitest/*` packages 4.1.10 → 4.1.12  | Workspace tests. Fixes redirect-mock file traversal and unauthenticated manual-mock registration. Neuron runs tests through the CLI, with no exposed UI test server.                                                                                                  |
| `@hono/node-server` 2.1.0 → 2.1.6                      | API development server. Fixes double-decoding in static serving; Neuron does not serve static files through this adapter.                                                                                                                                             |
| `drizzle-kit` 0.31.10 → 0.31.11                        | Migration tooling. The supported patch [warns about silently skipped migrations](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit%400.31.11); it still retains the retired loader described below. ORM 0.45.2 stays unchanged.                    |
| `nanoid` 3.3.17 → 3.3.20                               | Vite → PostCSS → Nano ID. Fixes [zero-size custom-generator looping](https://github.com/advisories/GHSA-2v37-7h3g-55p8). This is build tooling, and PostCSS calls the ordinary generator with a fixed positive size.                                                  |
| `esbuild` 0.18.20 → 0.25.12 on the retired loader edge | Drizzle Kit → `@esbuild-kit/esm-loader` 2.6.5 → `@esbuild-kit/core-utils` 3.3.2 → esbuild. Fixes [development-server CORS exposure](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). The loader calls transform APIs, not esbuild's server. |
| `path-to-regexp` 6.1.0 → 6.3.0                         | `@vercel/config` 0.7.0 → `@vercel/routing-utils` 6.5.0 → legacy parser. Fixes [backtracking expression generation](https://github.com/advisories/GHSA-9wv6-86v2-598j). Current rewrite patterns do not have the vulnerable multiple-parameter segment.                |
| `undici` 8.10.0 → 8.12.2                               | jsdom 30.0.1 → Undici, used by browser unit tests. Removes 19 WebSocket, HTTP, cache, TLS and resource-consumption findings without changing the jsdom major.                                                                                                         |
| `brace-expansion` 5.0.9 → 5.0.12                       | ESLint/TypeScript lint packages → minimatch → brace expansion. Fixes three recursion/expansion resource-consumption findings.                                                                                                                                         |
| `seroval` 1.6.2 → 1.6.11                               | React Router → router-core → Seroval, also through seroval-plugins. Fixes six serialization/deserialization findings. Neuron is a client-rendered application, with no TanStack server-function or hydration-payload endpoint. Router versions stay unchanged.        |
| `source-map-js` 1.2.1 → 1.2.2                          | PostCSS and CSS tooling. Fixes indexed source-map offset resource consumption.                                                                                                                                                                                        |

PostCSS 8.5.25 → 8.5.32, picomatch 4.0.5 → 4.0.7, Rolldown/bindings 1.2.3 → 1.2.16 and
`@oxc-project/types` 0.143.0 → 0.156.0 follow
Vite's supported compatible dependencies. No unrelated direct dependency is refreshed.
Both manifests that declare Zod agree on `^4.6.7`; direct security updates raise their minimum versions.

## Scoped overrides and removed workaround

`pnpm-workspace.yaml` contains two overrides:

- `@esbuild-kit/core-utils@3.3.2>esbuild: 0.25.12`. The latest stable Drizzle Kit 0.31.11 retains
  the retired loader; the latest loader 2.6.5 and core-utils 3.3.2 have no supported parent fix.
  Use the patched esbuild line already installed by Drizzle Kit. Keep this override until a supported
  parent removes or updates that edge, then remove it with transformation and migration checks.
- `@vercel/routing-utils>path-to-regexp: 6.3.0`. Even routing-utils 6.6.1, used by the latest config
  SDK 0.14.1, retains an exact 6.1.0 legacy-parser dependency alongside its patched alias.
  Updating the parent would retain the alert. The scoped patch preserves the parser's major API;
  regression checks exercise API wildcard and application fallback conversion.

Neither override changes other esbuild or route-parser consumers. The installed esbuild versions are
0.25.12 and 0.28.1; no 0.18.20 remains. The obsolete `minimumReleaseAgeExclude` entry for
`tsx@4.23.9` is removed: that release was published on 2026-08-06 and installs under the normal policy.
The package manager, Node engine declarations and native-build allowlist are unchanged.

## Retained findings and upgrade decisions

| Remaining finding                                                                                                                                                                                                                                 | Actual impact and next action                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth 1.6.26: [device approval](https://github.com/advisories/GHSA-q84f-53jg-9ppm), [OAuth Proxy](https://github.com/advisories/GHSA-r4xp-prcw-77qf), [OAuth/Magic Link state confusion](https://github.com/advisories/GHSA-965c-763c-88jm) | Two high and one critical package findings. `apps/api/src/auth.ts` enables password authentication, two-factor and Neuron's recovery plugin. Device authorization, OAuth, OAuth Proxy and Magic Link are absent, so their required exploit conditions are not present. Reassess before enabling any of those features.                                                                                    |
| Better Auth and its Drizzle/Kysely adapters: [PostgreSQL rate-limit concurrency](https://github.com/advisories/GHSA-44jh-23m7-hpcf)                                                                                                               | Three low package findings for one advisory. Better Auth retains its default memory storage, which the advisory excludes. Neuron's separate PostgreSQL limiter calls the atomic `rate_limit_take` function; it does not use the affected adapter rate-limit records. Kysely is not the configured adapter.                                                                                                |
| Zod 3.25.76 through `@vercel/config` 0.7.0                                                                                                                                                                                                        | One high finding for the collection-validation advisory above. The SDK validates author-controlled deployment configuration, outside application request/persisted-data validation. The latest SDK still requires Zod 3; forcing Zod 4 would cross its supported API contract. Runtime and shared schemas use fixed Zod 4.6.7.                                                                            |
| minimatch 10.2.6 through ESLint, import-x and typescript-eslint                                                                                                                                                                                   | One [moderate glob amplification finding](https://github.com/advisories/GHSA-g3hv-75wg-m249). It requires attacker-controlled glob patterns and `optimizationLevel >= 2`. These are trusted repository lint inputs, outside application runtime. Current supported parent releases still require minimatch 9/10; the fix is 11.0.1. Await supported parents instead of applying a blanket major override. |

Better Auth 1.7.7 or later resolves its retained advisories, but [the 1.7 release changes account
identity and requires an `Account.issuer` schema/backfill migration](https://github.com/better-auth/better-auth/releases/tag/v1.7.0).
That upgrade needs a separate authentication/migration review covering existing password accounts,
sessions, reset/recovery flows and two-factor state. It is deliberately deferred under this task's
no-migration constraint. No advisory ignore list or audit-level filtering is introduced.

The retired esbuild-kit packages continue to emit two deprecation warnings. They are recorded rather
than hidden; replacing Drizzle's loader through an unsupported package alias is avoided.

## Reproduction and compatibility

Use the repository-pinned pnpm 11.20.0 and Node 24, then:

```sh
pnpm install --frozen-lockfile
pnpm audit --json
pnpm audit --prod --json
pnpm -r why nanoid esbuild zod undici seroval path-to-regexp
node --test scripts/dependency-compatibility.test.mjs
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm db:check
pnpm --filter @neuron/api db:verify-journal
node node_modules/vitest/vitest.mjs run --config apps/api/vitest.release.config.ts
pnpm build
pnpm --filter @neuron/web test:screens:ci
pnpm --filter @neuron/web test:screens:ci --project=phone-performance
```

The database commands require disposable PostgreSQL owner/application/authentication connections;
the tests must never target a live collection. Local verification uses PostgreSQL 17 and Neon's
WebSocket proxy, matching CI, with a separate database for the main suite. Release-safety tests own
additional throwaway databases. Preview build verification runs with `VERCEL_ENV=preview`.
For generation compatibility, copy the migration directory to a temporary location and generate against
that copy. Use a relative output path on Windows; Drizzle's absolute-output path handling is unsuitable.
The generation check must report no schema changes and leave the tracked migrations untouched.

`scripts/dependency-compatibility.test.mjs` runs in CI and tests the two override boundaries: synchronous
and asynchronous TypeScript transformation through the installed Drizzle loader, and Vercel rewrite
conversion with nested/encoded API paths and client navigation fallback. A separate clean Linux
container also installs the frozen lockfile, runs those checks and builds both production and preview
profiles. Their configured development-route flags are verified as false and true respectively.

Verified before PR delivery: all 1,311 tests in 120 files passed with PostgreSQL 17 configured,
including authentication, RLS, repositories, routes, sync, offline projections and scheduling/replay.
All 14 release-safety tests passed. Typecheck, lint, formatting, migration check, applied-journal
verification, owner-free Preview verification and temporary schema generation passed. The generation
reported no schema changes. The frozen Windows install and a fresh Linux install/build passed, as did
all 40 command/gate/override checks. The full built-app interaction gate passed 835 cases; 18 opt-in
live-browser cases skipped and are not passing evidence. All 12 phone-performance checks passed, with
59–60 FPS against the 55 FPS scroll budget at 4× CPU and triage taps below 100 ms. Hosted CI and
deployment status are recorded in the pull request.
