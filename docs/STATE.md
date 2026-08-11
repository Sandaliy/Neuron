# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-08-11, phase 4 written and not yet committed.

## Now

**Phase 4 is built and passing, and is sitting uncommitted in the working tree.** It touches
authentication, the database schema and the deployment configuration, all three of which `CLAUDE.md`
says to ask about before committing, so it is waiting for that.

What is finished: the two holes from phase 3, authentication, rate limiting, every route, the review
endpoint, sync, the error shape, the generated api description, and the removal of the spike page.

What is left, and needs the person rather than the machine:

1. **Google OAuth in the Google Cloud console**, about twenty minutes. `phase-4.md` part 1 walks
   through it. The code is already written and inert: the api runs without the credentials and gains
   the provider the moment `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` appear in `.env`.
2. **`pnpm db:role`**, one command. Phase 4 splits the database into two restricted roles, and this
   writes both connection strings. Until it runs, `DATABASE_URL_AUTH` is missing and the api will
   refuse to start with a message saying so.
3. **`pnpm db:migrate`** against the real database. The test database is already migrated.
4. **Deploy**, which is a walkthrough rather than a command. See `phase-4-deploy.md`.

## Done

| Phase | What it produced                                                                                          | Doc                            |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0     | pnpm monorepo, TypeScript, ESLint, Prettier, Vitest, GitHub Actions on Node 24                            | `phase-0.md`                   |
| 0.5   | Better Auth, Neon Postgres, deployed to Vercel and verified end to end online                             | `phase-0.5.md`                 |
| 1     | FSRS-6 scheduler in `packages/core`, checked against the reference implementation                         | `phase-1.md`                   |
| 2     | Workload manager: answer time, forecast, budget, throttle, balancing, backlog, session builder, simulator | `phase-2.md`                   |
| 2.5   | Reran the simulator under realistic load, changed the metric, rewrote the claims                          | `phase-2.5.md`                 |
| 3     | Twelve tables, row level security, repository layer, isolation tests                                      | `phase-3.md`, `phase-3-run.md` |
| 4     | Two database roles, the whole api, sync, the review endpoint                                              | `phase-4.md`                   |

## What phase 4 changed

**Two database roles instead of one.** `neuron_app` reaches the collection and ten columns of `user`.
`neuron_auth` reaches the four Better Auth tables and nothing else. One role could not tell the
authentication path from a route handler, because any flag the application could set to say so is a
flag it could set at any other time. Email addresses and password hashes are now unreachable from
application code, and the isolation tests say so rather than the documentation claiming it.

**Account deletion no longer deletes.** It anonymises the person, drops their credentials and
sessions, marks the row, and soft deletes the collection. The rows go thirty days later in
`pnpm db:erase`, which holds the owner credential. That is the only code in the project that removes a
review, and the append only trigger now checks that the deleting role owns the table rather than
trusting a string any connection could set.

**Rate limiting counts in Postgres.** The in memory version was one counter per serverless instance,
which is not a limit. Keys are hashed, so the table says how often something was tried and nothing
about who. Signing in is limited per address and per account, and the wait doubles each window that
goes over.

**The review endpoint recomputes.** The client works out the new card state locally, because that is
what makes the app work offline, so the server does it again and stores its own. The review id comes
from the client, so a retry is harmless. Both are tested at the route.

**Sync.** `GET /sync?since=` is one ordered stream across every table, ending on a revision boundary so
a cut off download can be resumed. `POST /sync` is one transaction: entities merge by last write wins
with the loser kept in `sync_conflicts`, reviews are appended and cannot conflict, and a client clock
more than five minutes ahead is pulled back.

## Open threads

- **Google OAuth is not connected.** The code is there and switched off. Needs the console work.
- **`DATABASE_URL_AUTH` is not in `.env` yet.** `pnpm db:role` writes it. Until then `pnpm dev` will
  not start, and six tests skip with a message saying why.
- **Email verification and password reset are deferred.** Both need a mail sender, which needs a
  verified domain, which is deferred. Written up under Known limitations in `docs/architecture.md`.
  Phase 11 closes them.
- **`sync_conflicts` is written and never read.** The screen that shows a merge conflict belongs with
  the interface. The rows have to start being written now, because a conflict that was not recorded
  cannot be recovered afterwards.
- **`apps/web` is empty.** It holds a README and nothing else. With `/spike` deleted there is no page
  at all until phase 5, so checking Google sign in from a browser has to wait or be done by hand
  against the api. `phase-4-deploy.md` gives the by hand version.
- **`prettier --check` fails on twenty four files** that were already failing before phase 4, mostly
  from line endings on a Windows checkout. Left alone, to keep the phase 4 diff readable.
- **No custom domain.** Deliberate, see the decision log.

## Decisions

Why things are the way they are. Do not relitigate these without a reason.

| Date       | Decision                                                                               | Why                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Host on Vercel, not Cloudflare                                                         | Cloudflare's free tier CPU time limit makes password sign in impossible                                                                                                                     |
| 2026-08    | A deck and a folder are one entity                                                     | Studying a folder means studying its subtree. Each deck stores its ancestors as an array, so a subtree query is one statement, not a recursive walk                                         |
| 2026-08    | `reviews` is append only                                                               | Card state is a projection of the log and can always be rebuilt. This is tested, not promised                                                                                               |
| 2026-08    | Two barriers around user data                                                          | The repository layer cannot be called without a user context, and row level security compares rows independently. Code correctness is not the only defence                                  |
| 2026-08    | The due query index was chosen by measurement                                          | `src/db/bench/main.ts` measures it. Intuition was not trusted                                                                                                                               |
| 2026-08    | `packages/core` takes `now` and the RNG as parameters                                  | It must produce identical results in the browser offline and on the server during sync                                                                                                      |
| 2026-08    | Day boundary is a named time zone with a configurable cutoff hour                      | Carried over from phase 1 and fixed in phase 2. UTC was wrong                                                                                                                               |
| 2026-08-08 | The metric is peak load and predictability, not words per year                         | Volume scales with time invested and no policy beats that. What breaks people is the day that turns into 140 minutes without warning. Measured on 50 new cards a day, not Anki's default 20 |
| 2026-08-08 | Dropout is presented as an assumption with a sensitivity sweep                         | A simulated student does not quit. Modelling that would produce a result driven by assumptions rather than data                                                                             |
| 2026-08    | Google sign in and a custom domain are deferred                                        | Agreed at phase 0.5. Google OAuth arrives in phase 4, the domain is still deferred                                                                                                          |
| 2026-08-11 | Authentication gets its own database role                                              | One role cannot tell "part of signing in" from "a route handler". A credential the application does not hold can. This is what phase 3 left open and phase 4 closed                         |
| 2026-08-11 | Deleting an account marks it, and a task run as the owner removes it thirty days later | The request path then has no route to a deleted review at all, which is stronger than a flag the request path is trusted not to set                                                         |
| 2026-08-11 | Rate limiting lives in Postgres, not Redis                                             | Traffic is three people. A second service to run, pay for and notice the failure of is not worth a counter                                                                                  |
| 2026-08-11 | The fuzz generator is seeded from the review id                                        | A retry then recomputes exactly what the first attempt did, and a client seeding the same way agrees with the server instead of triggering a resync on every card                           |
| 2026-08-11 | A sync page ends on a revision boundary, never inside one                              | A transaction takes one revision and can write several rows under it. Cutting between them would leave a client holding half a transaction and believing it had all of it                   |
| 2026-08-11 | A client may push `suspendedAt` on a card and nothing else                             | Everything about the schedule is derived from the review log. A client that could push a stability would not need to forge a review                                                         |

## Verification commands

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass before any unit of work counts as done. The full list is in `CLAUDE.md`.
