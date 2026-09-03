# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-09-04, after Phase 6 note-type conversion verification.

## Now

Phase 6 is active and unpublished on `work/phase-6`. The branch contains writable decks, note editing
and browsing, shared card planning, and chunked imports. The 5,000-note list now passes the unchanged
55 fps budget after memoizing unchanged rows. Other Phase 6 delivery checks remain pending.

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

1. Continue Phase 6 on `work/phase-6`, keeping `stash@{0}` as the backup.
2. Add note and import browser and screenshot coverage.
3. Check keyboard navigation and the mobile on-screen keyboard.
4. Land Phase 6 through a pull request and verify both production applications.
5. Update the root and API README files, then remove merged remote branches.

## Open threads

- Existing-note type conversion uses a separate empty target draft, schema validation and explicit Apply.
  Cancel leaves the saved note unchanged; same-type fields and tags still autosave. Shared reconciliation
  replaces cross-type cards with new IDs and fresh schedules. Answered-card removal requires explicit
  confirmation, with review rows preserved. Real database tests verify rollback of note/cards/revisions;
  focused phone/desktop browser tests cover all target schemas, cancellation, confirmation and retry.
- Import duplicates use a default plus row overrides in the bounded preview. Only a unique same-type
  match can merge. Ambiguous or incompatible matches inherit Skip instead of Merge, with visible reasons.
  Merge fills schema-defined blanks and grammar leaves under a write lock, preserves existing metadata,
  cards and reviews, and refuses card removal. In-page Resume reuses the original row IDs and decisions.
  Undo removes batch-created notes/cards only; merged additions stay, as stated in completion and undo copy.
  Targeted database and browser tests cover these boundaries. Full Phase 6 acceptance remains pending.
- The long-lived Preview database is intentionally empty and shared by preview deployments. Resetting it
  or moving to one database branch per pull request remains a later automation task.
- Five isolated 5,000-note runs measured 60.0, 59.3, 60.0, 60.0 and 60.0 fps after row memoization,
  up from about 35.4 fps. The Chromium phone contract remains 375 by 812, device scale 2, CPU
  throttling 4, 180 measured frames, 24 pixels per frame and a 55 fps threshold.
- The note-list fix preserves selection across virtual mounts, refreshed row data and native keyboard
  activation. Targeted browser checks pass in both themes at phone and desktop widths.
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
