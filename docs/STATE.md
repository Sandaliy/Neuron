# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-09-06, after Phase 6 production recovery merged and hosted FPS measurement split from
the blocking browser gate.

## Now

Phase 6 production recovery is merged to `main`. The release contains writable decks, note editing
and browsing, shared card planning, chunked imports, and persistent Deleted/Restore UI for soft-deleted
decks and notes. The 5,000-note list now passes the unchanged 55 fps budget after memoizing unchanged
rows. Five isolated Chromium phone runs at 375 by 812, device scale 2 and CPU throttling 4 measured
60.0, 59.3, 60.0, 60.0 and 60.0 fps. The Phase 6 collection and recovery slice is merged and
verified in production.

The stabilized `main` branch has protected pull-request delivery, required CI and Vercel checks, and
isolated preview data. Production web, API `/health`, and `/db-check` passed after the recovery deployment.

## Done

| Phase    | What it produced                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- |
| 0 to 0.5 | Monorepo, shared tooling, Better Auth, Neon Postgres, and Vercel deployment                    |
| 1 to 2.5 | FSRS-6, time-budget scheduling, backlog control, and simulator evidence                        |
| 3 to 4.5 | Data model, RLS, repository layer, API, sync, recovery codes, and optional TOTP                |
| 5        | Web shell, authentication screens, library tree, Today, themes, and two languages              |
| 5.5      | Design tokens, component gallery, glass and motion rules, phone fixes, and screenshot coverage |

## Next

1. Complete real-iPhone acceptance for the merged Phase 6 collection flows.
2. Continue the remaining Phase 6 direction-control, browser and screenshot coverage, mobile-keyboard
   acceptance, and large-import acceptance work as separate workstreams and release slices where useful.
3. Run the full milestone gates when closing Phase 6.

## Open threads

- The long-lived Preview database is intentionally empty and shared by preview deployments. Resetting it
  or moving to one database branch per pull request remains a later automation task.
- The note-list performance fix preserves selection across virtual mounts, refreshed row data and native
  keyboard activation. Targeted browser checks pass in both themes at phone and desktop widths.
- Phase 6 lacks complete browser and screenshot coverage for notes and imports. Keyboard navigation and
  the mobile on-screen keyboard still need direct checks.
- Import duplicates use a default plus row overrides in the bounded preview. Only a unique same-type
  match can merge. Ambiguous or incompatible matches inherit Skip instead of Merge, with visible reasons.
  Merge fills schema-defined blanks and grammar leaves under a write lock, preserves existing metadata,
  cards and reviews, and refuses card removal. In-page Resume reuses the original row IDs and decisions.
  Undo removes batch-created notes/cards only; merged additions stay, as stated in completion and undo copy.
  Targeted database and browser tests cover these boundaries. Full Phase 6 acceptance remains pending.
- Existing-note type conversion uses a separate empty target draft, schema validation and explicit Apply.
  Cancel leaves the saved note unchanged; same-type fields and tags still autosave. Shared reconciliation
  replaces cross-type cards with new IDs and fresh schedules. Answered-card removal requires explicit
  confirmation, with review rows preserved. Real database tests verify rollback of note/cards/revisions;
  focused phone/desktop browser tests cover all target schemas, cancellation, confirmation and retry.
  Existing notes move only through list selection, and full direction/ladder controls are absent.
- The note list exposes exact source filtering and per-row live-card summaries. Persistent Deleted/Restore
  UI now covers soft-deleted decks and notes.
- Server restore integrity is verified by 22 real-database regression cases. Decks restore individually,
  parent-first. Note restore uses explicit card deletion provenance, preserves schedules and reviews,
  and reports cards left deleted. Historical and independently deleted cards remain deleted. Sync follows
  the same dependency and provenance boundaries. Migration 0011 adds the conservative false default
  without historical attribution. Broader Phase 6 acceptance and final milestone closure remain pending.
- `stash@{0}` remains a backup of earlier Phase 6 local work. Keep it until the phase has landed safely.
- The production API is in `iad1` while users and web requests enter through Europe. Region alignment
  remains deferred because the database must move with the API.
- Mail delivery is disabled. `MAILER=log` is the only configured sender.
- `sync_conflicts` records losing versions but the web app has no recovery screen.
- The production web bundle is about 596 KB before gzip. Code splitting remains deferred.
- Dependency alerts include `nanoid` 3.3.17 and the Drizzle tooling version of `esbuild`.

## Decisions

| Date       | Decision                                                                     | Why                                                                                                           |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Keep scheduling pure and deterministic in `packages/core`                    | Browser and server projections must match while offline                                                       |
| 2026-08    | Treat a deck and folder as one entity                                        | Studying a parent includes its subtree                                                                        |
| 2026-08    | Keep reviews append only                                                     | Card state can be rebuilt from the review log                                                                 |
| 2026-08    | Require user context in repositories and RLS in Postgres                     | User isolation must survive a route bug                                                                       |
| 2026-08    | Use recovery codes and optional TOTP without Google sign in                  | The current product has no mail or social identity provider                                                   |
| 2026-08    | Keep theme and language device-first                                         | Preference changes must not wait on the network                                                               |
| 2026-08    | Keep reusable visual contracts, docs, mockup, gallery, and code aligned      | Global design references should describe the reusable system, not every screen-level adjustment               |
| 2026-08    | Use one Playwright worker                                                    | Frame-rate tests must not compete for the measured CPU                                                        |
| 2026-09-03 | Protect `main` and deliver production changes through `work/*` pull requests | Production must receive only checked changes                                                                  |
| 2026-09-03 | Keep the prompt in `docs/card-generation-prompt.md`                          | It defines the product contract used by all three card generation modes                                       |
| 2026-09-03 | Run screenshot CI on Windows                                                 | The committed baselines use the same system fonts as the Windows runner                                       |
| 2026-09-03 | Use one empty, long-lived Neon Preview database                              | Preview work must never read or write production user data                                                    |
| 2026-09-03 | Pair web and api previews by their Vercel branch URL                         | A pull request tests both applications together while keeping cookies on the web origin                       |
| 2026-09-03 | Keep current state and future direction in separate documents                | `STATE.md` stays concise while `ROADMAP.md` controls milestone intent                                         |
| 2026-09-03 | Treat old plans as historical input                                          | Current code, migrations, tests, and maintained domain documents take precedence                              |
| 2026-09-06 | Ship coherent user-value slices instead of every individual task             | Keep `main` protected while avoiding CI/deploy cost for every small change; milestones may ship incrementally |
| 2026-09-06 | Group related work into coherent user-value releases                         | Avoid CI/deploy cost for every small task while allowing useful milestone work to ship incrementally          |
