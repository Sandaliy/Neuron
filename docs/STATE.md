# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-08-13, phase 5 merged to main as `1b891a3`. Both projects deployed.

## Now

**Phase 5 is built, passing and live.** The app is at
[neuron-web-parkour-clan.vercel.app](https://neuron-web-parkour-clan.vercel.app). Sign up, sign in,
the ten codes, recovery by code, the second factor, settings, the read only library tree and Today.
Two themes, two languages.

`pnpm typecheck`, `pnpm lint` and `pnpm test` all pass: 616 tests, none skipped. The branch preview
went green before anything reached `main`, which is the working method from now on.

Checked against the live deployment, not only locally: registering sets the session cookie on the web
host with `__Secure-` and `HttpOnly`, and a second request carrying only that cookie is accepted. The
account used for the check was deleted afterwards.

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
| 5     | The web app: shell, design system, two themes, two languages, every auth screen, library tree, Today      | `phase-5.md`                   |

## What phase 5 changed

**The api answers under `/api`, and `/health` still answers at the root.** The browser has to see one
origin or it will not send the session cookie, so `apps/web/vercel.json` forwards `/api` to the api
deployment with one path preserving rule. Better Auth already lived at `/api/auth`; the collection
lived at the root, and no single rule covers both. Moving it was cheaper than two rules nobody would
understand a month later.

**The design system is enforced, not described.** `scripts/check-design-tokens.mjs` runs in `pnpm lint`
and fails on a colour literal or a spacing value off the scale anywhere in `apps/web/src`. Tailwind is
wired to `packages/config/tokens.css` with the default palette and spacing scale switched off, so the
only utilities that exist are the ones the design system allows and the number in the class is the
pixel value.

**The theme is decided twice on purpose.** A plain script in `index.html` sets it before the stylesheet
loads, so no load ever flashes the wrong colours, and `src/theme/theme.ts` holds the same rule for the
running app. `theme.test.ts` runs both against the same cases so they cannot drift.

**Contrast is measured, not asserted.** `contrast.test.ts` reads the tokens and computes every text
pair. Dark: 16.68 and 5.82 to 1. Light: 17.30 and 4.89 to 1. A label on the accent needs a different
answer in each theme, so `--accent-text` is the page background in dark and white in light.

**Today shows due and new as two facts.** A collection imported an hour ago has nothing due and plenty
new, and one number saying "nothing is waiting" reads as a broken app. The minutes estimate uses
`DEFAULT_ANSWER_SECONDS` from `packages/core` and says "about", because measuring needs the review log
and the client has none until sync lands in phase 8.

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

1. **Walk through the checks** in `phase-5.md`, in order. The first one, that the session survives a
   reload, has been done from here against the live address; the rest need a real phone and a real
   authenticator app.
2. **Phase 6**, the cards themselves: the note editor, the three note types, import from JSON and CSV
   with a preview, duplicate detection, and taking an import back whole.

## Open threads

- **Two deploys work, as of 13 August.** `neuron-api` from `apps/api`, `neuron-web` from `apps/web`,
  both connected to GitHub. `https://neuron-api-parkour-clan.vercel.app/health` answers, and the app is
  at `https://neuron-web-parkour-clan.vercel.app`. `APP_ORIGIN` and `BETTER_AUTH_URL` on the api both
  point at the web origin now, in Production and Preview. Vercel Authentication is off on both, or the
  preview and the app would both sit behind an SSO page. Push a branch and let the preview build it;
  merge to `main` only once it is green. The deployment section of `CLAUDE.md` has the rest.
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
- **No service worker, so the app needs a connection.** Offline and the install prompt both land in
  phase 8, together. A half built service worker serves a stale page that survives a reload, which is
  the one failure a person testing this cannot diagnose.
- **The library is read only.** Making, renaming and moving decks is phase 6. The tree proves the
  chain: database, repository, api, client, screen.
- **The Today estimate is not a forecast yet.** It multiplies the due count by one default answer time.
  The real thing needs the review log on the client, which arrives with sync in phase 8.
- **`prettier --check` fails on twelve files**, all older than this session, mostly line endings on a
  Windows checkout. Was twenty four; everything touched since has been formatted.
- **No custom domain.** Deliberate, see the decision log.

## Decisions

Why things are the way they are. Do not relitigate these without a reason.

| Date       | Decision                                                                               | Why                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Host on Vercel, not Cloudflare                                                         | Cloudflare's free tier CPU time limit makes password sign in impossible                                                                                                                       |
| 2026-08    | A deck and a folder are one entity                                                     | Studying a folder means studying its subtree. Each deck stores its ancestors as an array, so a subtree query is one statement, not a recursive walk                                           |
| 2026-08    | `reviews` is append only                                                               | Card state is a projection of the log and can always be rebuilt. This is tested, not promised                                                                                                 |
| 2026-08    | Two barriers around user data                                                          | The repository layer cannot be called without a user context, and row level security compares rows independently. Code correctness is not the only defence                                    |
| 2026-08    | `packages/core` takes `now` and the RNG as parameters                                  | It must produce identical results in the browser offline and on the server during sync                                                                                                        |
| 2026-08-08 | The metric is peak load and predictability, not words per year                         | Volume scales with time invested and no policy beats that. What breaks people is the day that turns into 140 minutes without warning. Measured on 50 new cards a day, not Anki's default 20   |
| 2026-08-08 | Dropout is presented as an assumption with a sensitivity sweep                         | A simulated student does not quit. Modelling that would produce a result driven by assumptions rather than data                                                                               |
| 2026-08-11 | Authentication gets its own database role                                              | One role cannot tell "part of signing in" from "a route handler". A credential the application does not hold can                                                                              |
| 2026-08-11 | Deleting an account marks it, and a task run as the owner removes it thirty days later | The request path then has no route to a deleted review at all, which is stronger than a flag the request path is trusted not to set                                                           |
| 2026-08-11 | Rate limiting lives in Postgres, not Redis                                             | Traffic is three people. A second service to run, pay for and notice the failure of is not worth a counter                                                                                    |
| 2026-08-11 | A sync page ends on a revision boundary, never inside one                              | Cutting inside one leaves a client holding half a transaction and believing it had all of it                                                                                                  |
| 2026-08-11 | A client may push `suspendedAt` on a card and nothing else                             | Everything about the schedule is derived from the review log. A client that could push a stability would not need to forge a review                                                           |
| 2026-08-12 | Google sign in is removed, not deferred                                                | Email and password is the only way in. Twenty minutes in a console, a second provider to keep working, and an account linking rule, for three people who all have passwords                   |
| 2026-08-12 | A recovery code is a full credential and is hashed like a password                     | Nothing ever needs to read one back. A scheme that can produce the original means a copy of the table plus the key is a set of working logins                                                 |
| 2026-08-12 | An accepted TOTP code pins its step, and lower steps are refused                       | The skew window exists for clocks, not for replay. Without this a code read over somebody's shoulder keeps working for another minute and a half                                              |
| 2026-08-12 | The password reset token is stored as a digest                                         | Better Auth stores it as a row identifier in the clear, so anybody who could read that table could reset any password in it                                                                   |
| 2026-08-12 | The message catalogue lives in `packages/shared/src/i18n/`                             | The api sends codes and never sentences, so the sentence for a code has to exist somewhere both ends agree on. `ru` is typed against `en`, so a missing key does not compile                  |
| 2026-08-12 | Test files share one database and never truncate it                                    | Emptying between tests pulls rows out from under the file running beside it. Every person and caller address is minted unique instead, and every query is scoped                              |
| 2026-08-12 | Database pools hold at most two sockets                                                | The driver defaults to ten. A serverless invocation handles one request, and the test run opens enough pools that ten each exhausts the Neon endpoint                                         |
| 2026-08-12 | `vercel build` runs before every push to `main`                                        | The builder type checks with compiler options of its own, so four commits whose deploys failed had passed `pnpm typecheck` locally. Only the builder catches those                            |
| 2026-08-12 | Vercel Authentication is off for the api                                               | Phase 5 calls this api from users' browsers, and an SSO page in front of it would block every one of them. Every route except `/health` still refuses a request with no session               |
| 2026-08-13 | The whole api moved under `/api`, except `/health`                                     | The browser must see one origin or it withholds the session cookie. Auth was at `/api/auth` and the collection at the root, and one forwarding rule cannot cover both shapes                  |
| 2026-08-13 | A branch preview replaces the local `vercel build --prod`                              | The local build took fifty minutes and printed nothing, so it was going to be skipped. The preview runs the same builder with the same options, and a failure there sends no production email |
| 2026-08-13 | Tailwind's default palette and spacing scale are switched off                          | The only utilities that exist are the design tokens, and the number in a class is the pixel value. A lint check fails on a colour literal, so the rule cannot be broken by accident           |
| 2026-08-13 | The theme is applied by a plain script in `index.html`, before the stylesheet          | Applied from React instead, every load paints one frame of the wrong theme. The same rule in TypeScript is run against the same cases by one test, so the two copies cannot drift             |
| 2026-08-13 | Theme and language live in local storage and on the account                            | Local storage is what the first paint can read; the account is what makes the choice follow somebody to a second device. The account wins once a session exists                               |
| 2026-08-13 | The recovery codes are held in `sessionStorage` until the box is ticked                | A reload is the one exit a browser always keeps. Codes in tab storage for a few minutes is a smaller risk than a pull to refresh destroying the only credential an account has                |

## Verification commands

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass before any unit of work counts as done. Then push a branch and wait for the Vercel
preview to go green before merging to `main`. The full list is in `CLAUDE.md`.
