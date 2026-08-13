# Code map

Where things live. Open files from here instead of searching. One line per file or per group.

Dependencies flow one way: `apps` depend on `packages`, `packages` never depend on `apps`.
Test files sit next to the code they cover and are not listed separately.

## packages/core

Pure TypeScript, zero runtime dependencies. No I/O, no ambient clock, no uninjected randomness.
Runs identically in the browser offline and on the server during sync.

### FSRS scheduling (`src/fsrs/`)

| File            | Holds                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `types.ts`      | `CardState`, `Rating`, `ReviewLog`, `SchedulingState`, `newCard`, the `RATING` constants                    |
| `parameters.ts` | The 21 FSRS weights, `SchedulerConfig`, learning steps, desired retention, clamping                         |
| `math.ts`       | Raw memory formulas: forgetting curve, interval from stability, interval modifier                           |
| `memory.ts`     | Stability and difficulty updates: `initialStability`, `recallStability`, `nextDifficulty`, `postLapseFloor` |
| `scheduler.ts`  | The public surface: `review`, `preview`, `replay`, `retrievability`                                         |
| `random.ts`     | `createSeededRandom`, the injectable `RandomSource`                                                         |

Reference implementation checks live in `differential.test.ts`, invariants in `properties.test.ts`,
a frozen output set in `snapshot.test.ts`.

### Workload management (`src/workload/`)

This is the part the project exists for. FSRS decides _when_, this decides _how much_.

| File             | Holds                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `types.ts`       | `WorkloadCard`, `WorkloadReview`, `DailyLoad`, card directions and states                     |
| `config.ts`      | `WorkloadConfig` and every default: horizon, throttle window, backlog trigger, balance window |
| `answer-time.ts` | Seconds per card, estimated per direction from the review log, trimmed mean                   |
| `forecast.ts`    | Minutes per day over the horizon, including reviews today's answers will generate             |
| `budget.ts`      | Per weekday minute budgets, carry over between days                                           |
| `throttle.ts`    | `marginalCostOfNewCard`, `newCardAllowance`. Admits new cards only if the forecast fits       |
| `balance.ts`     | Shifts a due date within a window to the least loaded day                                     |
| `backlog.ts`     | Detects a pile up, orders it by salvage value, builds a recovery plan                         |
| `session.ts`     | `buildSession`: assembles what the user actually sees in one sitting                          |
| `cards.ts`       | `freshCard`, `reviewCard`, the `CardShape` adapter between FSRS and workload types            |

### Supporting

| File                          | Holds                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `src/time/day.ts`             | Day boundaries in a named time zone with a configurable cutoff hour. Never assumes UTC |
| `src/simulation/learner.ts`   | Simulated student: answer speed, accuracy, whether they study today                    |
| `src/simulation/simulate.ts`  | Multi day run producing `SimulationResult`, absences, new card policies                |
| `src/index.ts`                | The barrel. Anything not exported here is private to the package                       |
| `demo/main.ts`                | Prints three scheduling scenarios to the console                                       |
| `sim/main.ts`, `sim/chart.ts` | Runs the simulator and writes the SVG charts in `docs/assets/`                         |

## packages/shared

Zod schemas and types used by both sides of the wire.

| File                   | Holds                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `src/rating.ts`        | `ratingSchema`, the four ratings                                                           |
| `src/uuid.ts`          | UUID v7 generation and parsing. Time sortable ids                                          |
| `src/note-types.ts`    | The three built in note types (`vocab`, `basic`, `cloze`), their fields and card templates |
| `src/deck-settings.ts` | Per deck settings schema, defaults, and inheritance from the parent deck                   |
| `src/preferences.ts`   | Locale, theme, plan, time zone, day cutoff hour                                            |
| `src/password.ts`      | The password policy: ten character floor, the small list of the worst ones                 |
| `src/recovery-code.ts` | The recovery code alphabet, grouping, and how a typed one is read back                     |
| `src/i18n/`            | `en.ts`, `ru.ts` and `translate`. Every user visible string, in both languages             |

### The wire contract (`src/api/`)

Both ends validate against these, so a request the server would refuse is one the client refuses first,
offline, without a round trip to find out. The api's OpenAPI document is generated from the same
objects, which is what stops it drifting away from the code.

| File         | Holds                                                                         |
| ------------ | ----------------------------------------------------------------------------- |
| `common.ts`  | Ids, instants, cursors, page sizes: the pieces every other schema is built of |
| `errors.ts`  | Every error code, and the status each one is answered with                    |
| `decks.ts`   | Deck shapes, the tree with its counts, create, update, move, reorder          |
| `notes.ts`   | Note shapes, the browse query, create, update, bulk status                    |
| `cards.ts`   | Card shapes, the due query, unlocking a direction                             |
| `study.ts`   | Presets and imports                                                           |
| `reviews.ts` | Submitting an answer, one or a batch, and what comes back                     |
| `sync.ts`    | The revision stream, and what a client may push for each kind of row          |
| `account.ts` | Who is signed in, preferences, and leaving                                    |
| `auth.ts`    | Registering, signing in, recovery codes, TOTP, verification and reset         |

## packages/config

| File                                                         | Holds                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `tokens.css`                                                 | Design tokens. The only place a color value may appear |
| `eslint.base.js`, `prettier.config.js`, `tsconfig.base.json` | Shared tooling config                                  |

## apps/api

Hono on the Node runtime, deployed to Vercel Functions. Drizzle over Postgres on Neon.

### Entry and middleware

| File                    | Holds                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | The Vercel entry point. Creates the Hono instance, because the builder requires it here                                   |
| `src/create-app.ts`     | `registerRoutes` builds everything from the environment, `mountCollection` mounts the routes onto parts a test can supply |
| `src/dev.ts`            | Local start. Reads `.env` before anything else runs                                                                       |
| `src/env.ts`            | Environment parsing and validation                                                                                        |
| `src/auth.ts`           | Better Auth setup, over the authentication connection. Do not hand roll sessions or password hashing anywhere else        |
| `src/mailer.ts`         | The `Mailer` interface, `LogMailer`, and the variable that chooses. No provider is configured                             |
| `src/context.ts`        | `requireSession`: refuses anything without one, hands the rest their repositories                                         |
| `src/errors.ts`         | `ApiError`, the mapping from thrown things to codes, and the one response shape                                           |
| `src/validation.ts`     | `readBody`, `readQuery`, `readParams`. Nothing reaches a handler unparsed                                                 |
| `src/rate-limit.ts`     | The limiter, counting in Postgres. The four rules live here too                                                           |
| `src/serialise.ts`      | Rows into what goes over the wire, and the deck tree with its counts rolled up                                            |
| `src/note-cards.ts`     | Which directions a new note starts with, from the deck's ladder                                                           |
| `src/openapi.ts`        | The api described, generated from the schemas in `packages/shared`                                                        |
| `src/testing/server.ts` | The real routes over the real database, behind a stubbed session. Only the session is replaced                            |

### Authentication (`src/auth/`)

What Neuron adds to Better Auth. Everything here runs on the authentication connection, so none of it is
reachable from a route handler.

| File                 | Holds                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `plugin.ts`          | The Better Auth plugin: recovery endpoints, the registration guards, the password policy hook     |
| `recovery-codes.ts`  | Generating, hashing, counting and spending the ten account recovery codes                         |
| `hashing.ts`         | One set of argon2id parameters for every secret, and the constant time miss for unknown addresses |
| `registration.ts`    | The per address daily cap on successful registrations                                             |
| `totp-replay.ts`     | Which step a code came from, and claiming it so the same code cannot be used twice                |
| `reset-tokens.ts`    | Storing the password reset token as a digest instead of in the clear                              |
| `testing/harness.ts` | A real server, a real cookie jar, and the helpers the authentication tests share                  |

The tests next to these are the only ones that do not stub the session: `registration.test.ts`,
`sessions.test.ts`, `recovery.test.ts`, `totp.test.ts`, `email-verification.test.ts`,
`account-deletion.test.ts`, `admin-reset.test.ts`.

### Routes (`src/routes/`)

One file per resource. Every handler reaches the database only through the repositories the session
middleware put on the request, and answers only in the shape `src/errors.ts` decides.

| File         | Endpoints                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `decks.ts`   | The tree with its counts, create, rename, settings, move, reorder, soft delete, restore                   |
| `notes.ts`   | Browse with filters and a cursor, create with its opening cards, edit, move, bulk status, delete, restore |
| `cards.ts`   | What is due, suspend, unsuspend, reset, and opening a direction under `/notes/:id/cards`                  |
| `study.ts`   | Presets, and imports that can be taken back whole                                                         |
| `reviews.ts` | `POST /reviews` and the batch form. The hot path, and the one that recomputes rather than believes        |
| `sync.ts`    | `GET /sync` by revision, `POST /sync` as one transaction                                                  |
| `account.ts` | Who is signed in, preferences, and leaving                                                                |

### Schema (`src/db/schema/`)

Seventeen tables. `index.ts` also exports `USER_OWNED_TABLES`, `AUTH_TABLES`, `WRITE_ORDER` and the two
lists of `user` columns the application role may touch, so a new table cannot be silently left out of
the checks that prove isolation works.

| File                     | Tables                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`                | `user`, `session`, `account`, `verification`, `two_factor`, `recovery_codes`, `registration_counts`. Reached over a second connection, as a role of their own |
| `decks.ts`               | `decks`. Folder and deck are the same entity. Ancestors stored as an array for subtree queries                                                                |
| `notes.ts`               | `notes`. The fact, with all its fields                                                                                                                        |
| `note-types.ts`          | `note_types`. Built in types belong to nobody, so this has its own policy                                                                                     |
| `cards.ts`               | `cards`. One review direction of a note, with its FSRS state                                                                                                  |
| `reviews.ts`             | `reviews`. Append only. Never updated, never deleted                                                                                                          |
| `study.ts`               | `study_presets`, `import_batches`                                                                                                                             |
| `sync.ts`                | `sync_conflicts`. The version that lost a merge, kept whole                                                                                                   |
| `rate-limits.ts`         | `rate_limits`. Counters only, no user data, reachable through one function                                                                                    |
| `columns.ts`, `owned.ts` | Shared column builders: the id, timestamp and `user_id` columns every owned table carries                                                                     |

### Repositories (`src/db/repositories/`)

The only way into the database. No exported function takes a bare handle, no method takes a user id.
The user is supplied once when the set is built. Do not write ad hoc queries in route handlers.

| File            | Holds                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `index.ts`      | `createRepositories(db, userId)`, the `Repositories` interface, `transaction`                             |
| `session.ts`    | `nameUser`, `transactionRunner`, `nextRev`. Names the user on the transaction so the policies can compare |
| `decks.ts`      | Deck tree operations, reorder, restore, `DeckCycle` and `DeckNotFound`                                    |
| `notes.ts`      | Note create, the browse query with its cursor, bulk status, restore, `UnknownNoteType`                    |
| `note-types.ts` | The built in types, and turning a type id into the name the wire carries                                  |
| `cards.ts`      | Card reads including the due query, the per deck counts, suspend, reset                                   |
| `reviews.ts`    | Recording a review, idempotent by id, and reading a log that respects a reset                             |
| `study.ts`      | Presets and import batches                                                                                |
| `sync.ts`       | The revision stream out, and the merge coming in                                                          |
| `account.ts`    | The user's own row: preferences, and soft deleting a collection                                           |
| `mapping.ts`    | Converts between database rows and `packages/core` types (`toReviewLog`, rating words)                    |

### Database plumbing (`src/db/`)

| File                                             | Holds                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `client.ts`                                      | `createDb` for the application role, `createAuthDb` for Better Auth    |
| `health.ts`                                      | `readDatabaseTime`, used by `/db-check`                                |
| `stable-id.ts`                                   | Deterministic ids for seeded and built in rows                         |
| `system-note-types.ts`                           | The built in note type rows                                            |
| `tooling.ts`                                     | Shared helpers for the scripts below                                   |
| `migrate/main.ts`                                | Applies migrations                                                     |
| `seed/main.ts`, `seed/data.ts`                   | Seeds a database with sample decks and notes                           |
| `role/main.ts`                                   | Gives both restricted roles a password and writes their connections    |
| `erase/main.ts`                                  | The only code that removes a review. Runs as the owner, thirty days on |
| `admin/reset-password.ts`                        | `pnpm admin:reset-password`. The last way in, run by hand as the owner |
| `bench/main.ts`                                  | Measures the due query, which is how the index was chosen              |
| `test-db/main.ts`                                | Prepares the Neon `test` branch                                        |
| `testing/database.ts`, `testing/global-setup.ts` | Test harness. Wipes the test database before each run                  |
| `isolation.test.ts`                              | Proves what each role can and cannot reach, straight at the database   |

Migrations are in `drizzle/`, numbered. `0002_isolation.sql` is the row level security one,
`0005_auth_isolation.sql` is the split into two roles, and `0007_auth_rework.sql` puts the recovery codes
and the two factor secrets on the authentication side of that split.

## apps/web

React 19 on Vite, deployed as `neuron-web`. Every request goes to the origin the page came from:
`vercel.json` forwards `/api` to the api deployment in production, the Vite proxy does it in
development. An absolute url to the api anywhere here would cost the session cookie.

### The frame (`src/app/`)

| File                   | Holds                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `shell.tsx`            | The layout every signed in screen sits in, and the navigation bar along the bottom of a phone |
| `session-gate.tsx`     | Asks the api who is signed in, and tells apart no session, a recovery session, and no server  |
| `preferences-sync.tsx` | Adopts the account's theme and language, but only on a device that never chose                |
| `failure.tsx`          | What a thrown component and an unknown address look like. Never a stack trace                 |

### Screens (`src/features/`)

| Path                      | Holds                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `auth/sign-up.tsx`        | Registering, then the ten codes, which it does not navigate away from                           |
| `auth/sign-in.tsx`        | Email and password, and the hand off to the second factor when there is one                     |
| `auth/recovery.tsx`       | Signing in with a code, then the new password that session owes                                 |
| `auth/recovery-codes.tsx` | The codes, the warning, copy, download, and the box that has to be ticked. Held across a reload |
| `auth/two-factor.tsx`     | The six digit challenge, with the lost phone codes on the same screen                           |
| `auth/code-input.tsx`     | One field, not six boxes: it takes a paste and submits itself when full                         |
| `auth/password-field.tsx` | The policy from `packages/shared`, judged when leaving the field rather than on every keystroke |
| `settings/settings.tsx`   | Theme, language, password, codes, the second factor, and leaving                                |
| `settings/totp.tsx`       | Enrollment in three steps that cannot be skipped, and removal                                   |
| `library/library.tsx`     | The deck tree, read only, with the open folders remembered                                      |
| `today/today.tsx`         | What is due, what is new, and the estimate that says "about"                                    |

### The design system (`src/ui/`)

Radix primitives styled with the tokens. No prebuilt kit: they carry a look, and this should not have
one that somebody recognises.

| File                                                        | Holds                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `button.tsx`                                                | Three variants, 44 px tall at the smallest                                              |
| `dialog.tsx`                                                | Takes `dismissable`. `false` is what makes the recovery codes screen impossible to skip |
| `segmented.tsx`                                             | The theme and language switches: native radios, so the arrow keys are the browser's own |
| `input.tsx`, `form-field.tsx`, `checkbox.tsx`, `switch.tsx` | The form parts, with the error wired to the control                                     |
| `toast.tsx`                                                 | Short confirmations, above the bottom bar and above the home indicator                  |
| `states.tsx`                                                | Skeleton, empty and error. A list never renders as a blank area                         |
| `spinner.tsx`                                               | For a button that is waiting. A screen gets a skeleton instead                          |

### The wiring (`src/lib/`, `src/i18n/`, `src/theme/`)

| File                    | Holds                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| `lib/api.ts`            | One request, the error envelope unpacked, and the code turned into a message key |
| `lib/auth-client.ts`    | Better Auth over the same origin, and its own codes mapped onto the shared ones  |
| `lib/account.ts`        | Who is signed in. One query, and the session check for the whole app             |
| `lib/decks.ts`          | The tree in one request, and adding up the roots                                 |
| `lib/storage.ts`        | Local storage that cannot throw, because Safari's private mode does              |
| `lib/viewport.ts`       | Where the on-screen keyboard is, as CSS variables a sheet is positioned against  |
| `preferences/device.ts` | A preference that belongs to the device: read at import, applied before React    |
| `preferences/sync.ts`   | Tells the account row, one request at a time, and discards the answer            |
| `i18n/locale.ts`        | Which language is on. The catalogue itself is in `packages/shared`               |
| `theme/theme.ts`        | Which theme is on, and the copy of that rule `index.html` runs first             |
| `theme/use-theme.ts`    | The theme as a device preference, and the hook that reads it                     |
| `styles/global.css`     | Tailwind wired to the tokens: the only utilities that exist are the ones allowed |
| `scripts/icons.mjs`     | Draws the icons in `public/` from the same tokens                                |

## Documentation

| File                        | Holds                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `docs/STATE.md`             | Current phase, open threads, decision log. Read this first                  |
| `docs/architecture.md`      | Why the structure is what it is, and the known limitations                  |
| `docs/algorithm.md`         | FSRS and the workload manager explained in full, with the simulator results |
| `docs/design-principles.md` | The visual system                                                           |
| `docs/copy-audit.md`        | Every interface string in both languages, and what looks wrong with it      |
| `docs/assets/*.svg`         | Charts produced by `sim/main.ts`                                            |
