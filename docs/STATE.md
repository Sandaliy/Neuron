# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-08-12, phase 4.5 committed as `1bbe845`. Production database migrated.

## Now

**Phase 4.5 is built, passing and committed.** Authentication is email and password only. Google is
gone. Recovery codes, optional TOTP and the whole mail path exist, the last of them switched off.

Phase 4 was committed the same session as `d52fbbc`, and six commits going back to `83f2b5f` that had
never left this machine were pushed. `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass: 573 tests,
none skipped. The six that used to skip now run, because `pnpm db:role` was finally run.

## Done

| Phase | What it produced                                                                                          | Doc                            |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0     | pnpm monorepo, TypeScript, ESLint, Prettier, Vitest, GitHub Actions on Node 24                            | `phase-0.md`                   |
| 0.5   | Better Auth, Neon Postgres, deployed to Vercel and verified end to end online                             | `phase-0.5.md`                 |
| 1     | FSRS-6 scheduler in `packages/core`, checked against the reference implementation                         | `phase-1.md`                   |
| 2     | Workload manager: answer time, forecast, budget, throttle, balancing, backlog, session builder, simulator | `phase-2.md`                   |
| 2.5   | Reran the simulator under realistic load, changed the metric, rewrote the claims                          | `phase-2.5.md`                 |
| 3     | Twelve tables, row level security, repository layer, isolation tests                                      | `phase-3.md`, `phase-3-run.md` |
| 4     | Two database roles, the whole api, sync, the review endpoint, rate limiting in Postgres                   | `phase-4.md`                   |
| 4.5   | Google removed, recovery codes, optional TOTP, the mail seam, the admin reset script                      | `phase-4.5.md`                 |

## What phase 4.5 changed

**Recovery codes are the credential, not a step towards one.** Ten at registration, single use, argon2id
hashed with the same parameters as a password. With no mail sender there is no way to prove somebody
owns an address, so recovery rests on something they hold. Anybody with a code is in the account without
the password, and the text next to the codes says that in both languages.

**Registration is open behind two temporary guards.** `AUTH_REGISTRATION_OPEN` closes it with one switch
in Vercel. `AUTH_MAX_REGISTRATIONS_PER_DAY` caps successful registrations per address at three a day,
counting successes rather than attempts, which is what the rate limiter already counts.

**TOTP is optional and cannot lock anyone out.** Enrollment is inactive until a code from the app is
typed back, and turning it on issues a second, separate set of codes for a lost phone. Better Auth
accepts any code inside the skew window; `src/auth/totp-replay.ts` pins the step a code came from and
refuses anything at or below it, so a code works exactly once.

**The mail seam is built and switched off.** `src/mailer.ts` holds the interface and a log mailer.
Verification and password reset are written in full behind `AUTH_REQUIRE_EMAIL_VERIFICATION` and driven
end to end by tests that run with it on, reading the token out of the log mailer.

## Next

1. **Walk through the checks** in `phase-4.5.md`, which cover registering, spending a code, the switch,
   and the second factor. Checks 5, 7 and 8 are already done. Phase 4 is deployed and answering, so the
   rest can be done against the live api now.
2. **Phase 5**, the first screens. Sign in, the ten codes with their warning, sign in by code, the QR
   enrollment, the library tree, two languages, two themes.

## Open threads

- **The deploy works, as of 12 August.** Root Directory is `apps/api`, `apps/api/vercel.json` pins the
  `@vercel/hono` builder, and `https://neuron-api-parkour-clan.vercel.app/health` answers with the
  phase 4 shape. GitHub is connected, so every push to `main` deploys to production and every failure
  sends an email. Run `vercel build` before pushing. The deployment section of `CLAUDE.md` has the rest.
- **The two registration guards are temporary.** Both exist only because there is no email verification.
  Remove them in phase 11 rather than leaving them to rot.
- **The password policy is a length floor and about forty entries.** `packages/shared/src/password.ts`.
  A real check needs a breach corpus, which is a service call or a large file to ship. Phase 11.
- **Mail is not delivered.** `MAILER=log` writes to the server log and sends nothing. Needs a domain and
  a provider. Two details are written up in `docs/architecture.md`: the reset token is a row, consumed,
  stored as a digest, and the verification token is a signed JWT that expires but is not consumed.
- **The codes for a lost phone are encrypted, not hashed.** Better Auth's two factor plugin has to list
  what is left, so it cannot hash them. The account recovery codes are hashed. Both are auth role only.
- **`sync_conflicts` is written and never read.** The screen belongs with the interface. The rows have to
  start being written now, because a conflict that was not recorded cannot be recovered afterwards.
- **`apps/web` is empty.** A README and nothing else until phase 5, so every check is by hand against
  the api. `phase-4-deploy.md` gives the by hand version.
- **`prettier --check` fails on twelve files**, all older than this session, mostly line endings on a
  Windows checkout. Was twenty four; everything touched since has been formatted.
- **No custom domain.** Deliberate, see the decision log.

## Decisions

Why things are the way they are. Do not relitigate these without a reason.

| Date       | Decision                                                                               | Why                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Host on Vercel, not Cloudflare                                                         | Cloudflare's free tier CPU time limit makes password sign in impossible                                                                                                                     |
| 2026-08    | A deck and a folder are one entity                                                     | Studying a folder means studying its subtree. Each deck stores its ancestors as an array, so a subtree query is one statement, not a recursive walk                                         |
| 2026-08    | `reviews` is append only                                                               | Card state is a projection of the log and can always be rebuilt. This is tested, not promised                                                                                               |
| 2026-08    | Two barriers around user data                                                          | The repository layer cannot be called without a user context, and row level security compares rows independently. Code correctness is not the only defence                                  |
| 2026-08    | `packages/core` takes `now` and the RNG as parameters                                  | It must produce identical results in the browser offline and on the server during sync                                                                                                      |
| 2026-08-08 | The metric is peak load and predictability, not words per year                         | Volume scales with time invested and no policy beats that. What breaks people is the day that turns into 140 minutes without warning. Measured on 50 new cards a day, not Anki's default 20 |
| 2026-08-08 | Dropout is presented as an assumption with a sensitivity sweep                         | A simulated student does not quit. Modelling that would produce a result driven by assumptions rather than data                                                                             |
| 2026-08-11 | Authentication gets its own database role                                              | One role cannot tell "part of signing in" from "a route handler". A credential the application does not hold can                                                                            |
| 2026-08-11 | Deleting an account marks it, and a task run as the owner removes it thirty days later | The request path then has no route to a deleted review at all, which is stronger than a flag the request path is trusted not to set                                                         |
| 2026-08-11 | Rate limiting lives in Postgres, not Redis                                             | Traffic is three people. A second service to run, pay for and notice the failure of is not worth a counter                                                                                  |
| 2026-08-11 | A sync page ends on a revision boundary, never inside one                              | Cutting inside one leaves a client holding half a transaction and believing it had all of it                                                                                                |
| 2026-08-11 | A client may push `suspendedAt` on a card and nothing else                             | Everything about the schedule is derived from the review log. A client that could push a stability would not need to forge a review                                                         |
| 2026-08-12 | Google sign in is removed, not deferred                                                | Email and password is the only way in. Twenty minutes in a console, a second provider to keep working, and an account linking rule, for three people who all have passwords                 |
| 2026-08-12 | A recovery code is a full credential and is hashed like a password                     | Nothing ever needs to read one back. A scheme that can produce the original means a copy of the table plus the key is a set of working logins                                               |
| 2026-08-12 | An accepted TOTP code pins its step, and lower steps are refused                       | The skew window exists for clocks, not for replay. Without this a code read over somebody's shoulder keeps working for another minute and a half                                            |
| 2026-08-12 | The password reset token is stored as a digest                                         | Better Auth stores it as a row identifier in the clear, so anybody who could read that table could reset any password in it                                                                 |
| 2026-08-12 | The message catalogue lives in `packages/shared/src/i18n/`                             | The api sends codes and never sentences, so the sentence for a code has to exist somewhere both ends agree on. `ru` is typed against `en`, so a missing key does not compile                |
| 2026-08-12 | Test files share one database and never truncate it                                    | Emptying between tests pulls rows out from under the file running beside it. Every person and caller address is minted unique instead, and every query is scoped                            |
| 2026-08-12 | Database pools hold at most two sockets                                                | The driver defaults to ten. A serverless invocation handles one request, and the test run opens enough pools that ten each exhausts the Neon endpoint                                       |
| 2026-08-12 | `vercel build` runs before every push to `main`                                        | The builder type checks with compiler options of its own, so four commits whose deploys failed had passed `pnpm typecheck` locally. Only the builder catches those                            |
| 2026-08-12 | Vercel Authentication is off for the api                                               | Phase 5 calls this api from users' browsers, and an SSO page in front of it would block every one of them. Every route except `/health` still refuses a request with no session               |

## Verification commands

```
pnpm typecheck
pnpm lint
pnpm test
cd apps/api && vercel build --prod
```

All four must pass before any unit of work counts as done, and all four before a push to `main`. The
full list is in `CLAUDE.md`.
