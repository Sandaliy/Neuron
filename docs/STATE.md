# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-09-03, after repository stabilization and preview isolation.

## Now

Phase 6 is implemented in part on the unpublished `phase-6-notes-and-import` branch. It is nine
commits ahead of the main commit it started from. The branch adds writable decks, note editing and
browsing, chunked imports, and card generation planning. It is paused until this delivery work lands.

Three tracked Phase 6 files and the local planning files are saved in `stash@{0}` as
`wip: phase 6 local changes before stabilization`. Do not drop that stash.

Pull request #1 stabilized delivery. It removed the obsolete Phase 4 runbook, tracked the canonical
card-generation prompt, repaired database-free tests, and made formatting, builds, migration checks,
secret scanning, and browser screenshots required CI gates. Production health passed after the merge.

GitHub ruleset `22151759` protects `main`. It applies to the repository owner, requires a current pull
request and the three CI jobs plus both Vercel checks, and blocks deletion and force pushes.

Preview deployments are isolated from production data. The Neon `preview` branch contains the schema
but no production rows, and the empty `neuron_preview` database has its own restricted application and
authentication credentials. The api's Preview environment holds those credentials and a separate
Better Auth secret. The web deployment sends `/api` to the api preview for the same Git branch.

## Done

| Phase    | What it produced                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- |
| 0 to 0.5 | Monorepo, shared tooling, Better Auth, Neon Postgres, and Vercel deployment                    |
| 1 to 2.5 | FSRS-6, time-budget scheduling, backlog control, and simulator evidence                        |
| 3 to 4.5 | Data model, RLS, repository layer, API, sync, recovery codes, and optional TOTP                |
| 5        | Web shell, authentication screens, library tree, Today, themes, and two languages              |
| 5.5      | Design tokens, component gallery, glass and motion rules, phone fixes, and screenshot coverage |

## Next

1. Resume `phase-6-notes-and-import` in a separate task and restore `stash@{0}`.
2. Measure the note list at 375 px and remove or replace the failed containment experiment.
3. Reach the agreed frame-rate target and add note and import browser and screenshot coverage.
4. Check keyboard navigation and the mobile on-screen keyboard.
5. Land Phase 6 through a pull request and verify both production applications.
6. Update the root and API README files, then remove merged remote branches.

## Open threads

- The long-lived Preview database is intentionally empty and shared by preview deployments. Resetting it
  or moving to one database branch per pull request remains a later automation task.
- Phase 6 measures about 60 fps for 500 plain rows, 43.7 fps with glass, and 35.4 to 35.6 fps for
  5,000 virtualized notes. The phase target is 55 fps. Clipping and containment did not help.
- Phase 6 lacks complete browser and screenshot coverage for notes and imports. Keyboard navigation and
  the mobile on-screen keyboard still need direct checks.
- The production API is in `iad1` while users and web requests enter through Europe. Region alignment
  remains deferred because the database must move with the API.
- Mail delivery is disabled. `MAILER=log` is the only configured sender.
- `sync_conflicts` records losing versions but the web app has no recovery screen.
- The production web bundle is about 596 KB before gzip. Code splitting remains deferred.
- Dependency alerts include `nanoid` 3.3.17 and the Drizzle tooling version of `esbuild`.

## Decisions

| Date       | Decision                                                        | Why                                                                                     |
| ---------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 2026-08    | Keep scheduling pure and deterministic in `packages/core`       | Browser and server projections must match while offline                                 |
| 2026-08    | Treat a deck and folder as one entity                           | Studying a parent includes its subtree                                                  |
| 2026-08    | Keep reviews append only                                        | Card state can be rebuilt from the review log                                           |
| 2026-08    | Require user context in repositories and RLS in Postgres        | User isolation must survive a route bug                                                 |
| 2026-08    | Use recovery codes and optional TOTP without Google sign in     | The current product has no mail or social identity provider                             |
| 2026-08    | Keep theme and language device-first                            | Preference changes must not wait on the network                                         |
| 2026-08    | Keep visual tokens, docs, mockup, gallery, and code aligned     | The approved reference must describe the shipped interface                              |
| 2026-08    | Use one Playwright worker                                       | Frame-rate tests must not compete for the measured CPU                                  |
| 2026-09-03 | Land every task through a `work/*` pull request with auto-merge | `main` must be protected and production must receive only checked changes               |
| 2026-09-03 | Pause Phase 6 while stabilization lands                         | Mixing product work with CI and repository policy would make review and rollback unsafe |
| 2026-09-03 | Keep the prompt in `docs/card-generation-prompt.md`             | It defines the product contract used by all three card generation modes                 |
| 2026-09-03 | Run screenshot CI on Windows                                    | The committed baselines use the same system fonts as the Windows runner                 |
| 2026-09-03 | Use one empty, long-lived Neon Preview database                 | Preview work must never read or write production user data                              |
| 2026-09-03 | Pair web and api previews by their Vercel branch URL            | A pull request tests both applications together while keeping cookies on the web origin |
