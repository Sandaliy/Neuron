# Project state

Where the project stands now, short enough to read at the start of every session. History lives in git
and in the domain documents; this file says what is true today and what is next. Rewrite a section when
it stops being true instead of appending to it.

Last updated: 2026-10-31.

## Release

Phases 0 to 8.6, the 2026-10-30 quality pass, offline Practice and offline Import preparation are on
protected `main`. The product has:

- Daily Study with deterministic time-based planning, explainable new-card admission, current-session
  Undo and durable answers that survive offline sittings, reload and lost responses.
- Practice: configurable, schedule-free, persistent per Deck.
- Writable Folders/Decks/Notes, import with resume and undo, soft deletion with Deleted/Restore.
- Offline: a complete downloaded collection browses, renames, edits existing Notes and plans Study
  locally. Answers, renames and Note edits travel through account-bound outboxes with exact retries and
  retained conflicts. Practice runs offline with durable ordered delivery and explicit two-device
  conflict choice. Import preparation works offline with account-local drafts and resumable delivery
  checkpoints; creating Notes and applying an Import still require a connection. Settings > Offline &
  sync shows saved work and recovery.

Not built: offline Note creation or Import application, Phase 9 progressive directions,
Phase 10 personal plans, mail delivery, a `sync_conflicts` recovery screen.

Owner acceptance on the installed iPhone is the gate for interaction work. The last full acceptance was
Phase 8.4 (PR #53) and offline Study (PR #54/#55). PR #56 was not accepted: the app still felt slow,
inconsistent and cumbersome, which started the quality pass below. The quality pass, offline Practice,
and offline Import preparation still need installed-iPhone acceptance.

## Quality pass, merged 2026-10-30

| PR  | What it changed                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #57 | api functions run in `fra1` next to the Frankfurt database instead of `iad1`. Every query used to cross the Atlantic: Study planning made about 21 sequential queries, 2.4 s. Production reads `fra1::fra1`, `/health` and `/db-check` answer 200.                                                                                                    |
| #58 | A Review delivery that fails without a server answer retries by itself (2, 5, 15, 30, 60 s). Today says "sending", "waiting" or "not accepted" instead of sending the learner to Settings.                                                                                                                                                            |
| #60 | One motion system (screens arrive by direction, dialogs, menus, toasts, card advance and Undo, disclosures and Library folders), no focus ring after a tap, choices drawn as switch rows, a faithful drag preview, Deleted and headers matching Library, readable toasts, dialog glass without the colour boost, a Study tap that waits for its plan. |
| #59 | This file, the browser test index, `test:screens:ci`.                                                                                                                                                                                                                                                                                                 |

## Next

1. Owner acceptance of the quality pass and recent offline features on the installed iPhone: screen
   and card motion, folders and disclosures, choice rows, Study start after a setup change, and
   reconnecting after an offline sitting; start and finish Practice offline, close and reopen, reconnect,
   and choose between runs after practicing one Deck on two devices; prepare and reopen an Import draft
   offline, then connect to check duplicates and apply or resume it.
2. Dark-theme depth: cards sit close to the canvas, and with Liquid glass on cards they render darker
   than it. A lighter glass attempt was rejected; any next attempt is shown as screenshots first.
3. A refused Review answer still pauses all new online Study. Narrowing that to the affected cards is a
   learning-semantics decision for the owner.

## Open threads

- Study now passes over Cards whose Note no longer produces a displayable face, so a sitting can
  finish. Legacy cloze Cards at slot 0 can still count as ready, use a new-card place, or remain overdue;
  repairing those records or changing planning semantics remains an owner decision.
- Local new-card admission offline is conservative over the last complete download and this device's
  events; it cannot see other devices' offline work. Reconnection keeps server authority.
- Hosted CI has shown one unreproduced desktop navigation scroll assertion and occasional Chromium
  context crashes. Assertions and failure artifacts are kept; see `interaction-performance.md`.
- The Preview database is one empty, long-lived Neon database shared by all previews.
- Dependency alerts: `nanoid` 3.3.17 and the Drizzle tooling `esbuild`.

## Where things are explained

| Topic                                                     | Document                     |
| --------------------------------------------------------- | ---------------------------- |
| Code locations                                            | `map.md`                     |
| Data model, security, deployment region, release ordering | `architecture.md`            |
| FSRS and workload                                         | `algorithm.md`               |
| Visual system, motion, words                              | `design-system.md`           |
| Offline collection and outboxes                           | `offline-collection.md`      |
| Offline Study, delivery and recovery                      | `offline-study.md`           |
| Measured performance and its limits                       | `interaction-performance.md` |
| Browser tests by product area, and how to run them        | `apps/web/tests/README.md`   |
| Milestones                                                | `ROADMAP.md`                 |

## Decisions

| Date       | Decision                                                    | Why                                                        |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 2026-08    | Keep scheduling pure and deterministic in `packages/core`   | Browser and server projections must match while offline    |
| 2026-08    | Keep reviews append only                                    | Card state can be rebuilt from the review log              |
| 2026-08    | Require user context in repositories and RLS in Postgres    | User isolation must survive a route bug                    |
| 2026-08    | Use recovery codes and optional TOTP without Google sign in | The product has no mail or social identity provider        |
| 2026-08    | Keep theme and language device-first                        | Preference changes must not wait on the network            |
| 2026-09-03 | Protect `main`; deliver through `work/*` pull requests      | Production receives only checked changes                   |
| 2026-09-03 | Run screenshot CI on Windows                                | Baselines use the Windows runner's system fonts            |
| 2026-09-03 | One empty, long-lived Neon Preview database                 | Previews never touch production data                       |
| 2026-09-06 | Ship coherent user-value slices, not every task             | CI and deploy cost per change                              |
| 2026-09-11 | Folders organise; only leaf Decks own Notes                 | One hierarchy without mixed nodes                          |
| 2026-09-16 | Undo is an append-only cancellation event                   | Replay removes the target and keeps every later answer     |
| 2026-09-24 | Frame-rate and visual tests run on one worker               | CPU contention made them measure the runner                |
| 2026-10-30 | api functions in `fra1`                                     | The database is in Frankfurt; a query costs one round trip |
| 2026-10-30 | Screens animate their arrival by direction                  | Owner acceptance: navigation felt abrupt with no motion    |
| 2026-10-30 | Visual changes are shown to the owner before merging        | Two restyles in a row were rejected on sight               |
