# Project state

Where the project stands now, short enough to read at the start of every session. History lives in git
and in the domain documents; this file says what is true today and what is next. Rewrite a section when
it stops being true instead of appending to it.

Last updated: 2026-11-06.

## Release

Phases 0 to 8.6, the 2026-10-30 quality pass, offline Practice, offline Import preparation, offline
Note and Folder/Deck creation, Phase 9.0 triage and Phase 9.1 learning waves are on protected `main`.
Browser verification (#70) preserves literal focused filters and removes only the three duplicate
desktop swipe executions. Deleted browsing (#75) adds search, sorting and bounded recovery windows.
Find Notes (#76) adds account-wide Library search with live collection visibility. The product has:

- Daily Study with deterministic time-based planning, explainable new-card admission, current-session
  Undo and durable answers that survive offline sittings, reload and lost responses.
- Practice: configurable, schedule-free, persistent per Deck.
- Writable Folders/Decks/Notes, import with resume and undo, soft deletion with Deleted/Restore.
- Library Find Notes searches across live Decks and names their locations. Search, filters, sort and
  list position survive a visit to the Note editor. Complete downloaded collections support local
  search, with the same query retained when the account reconnects.
- Library Tags & Sources discovers exact saved values with live Note counts and opens the existing
  filtered Note browser. Online aggregation is bounded and account-scoped. A complete download counts
  the same local Note projection, including device-saved work, with explicit synchronization provenance.
- Possible duplicates (#80) adds read-only normalized-term groups beside Tags & Sources (#79).
  Both retain their Library entries, editor return state and complete-download projection. Groups and
  members use bounded account-scoped reads; inspection changes no Note, Card or Review identity.
- Library Find Folders & Decks searches collection names at every depth, including collapsed Folders.
  Results show kind and full location; opening a collection and returning keeps the query, measured
  list position and keyboard focus. A complete download supports immediate offline search. Pending
  creations keep their saved-on-device identity and cannot open dependencies before synchronization.
- Deleted searches Note content and original locations or collection names and hierarchy. Recovery
  retains supporting ancestors, parent requirements and permanent-deletion confirmation. Large lists
  use measured virtual rows with keyboard and dialog continuity.
- Offline: a complete downloaded collection browses, renames, edits existing Notes and plans Study
  locally. Answers, renames and Note edits travel through account-bound outboxes with exact retries and
  retained conflicts. Practice runs offline with durable ordered delivery and explicit two-device
  conflict choice. Import preparation works offline with account-local drafts and resumable delivery
  checkpoints; applying an Import still requires a connection. Settings > Offline & sync shows saved
  work and recovery.
- Offline creation: new Notes save into downloaded Decks and new Folders/Decks into downloaded Folders.
  Each keeps one device-chosen id and is delivered once; the server makes Note Cards. A pending Folder
  or Deck holds nothing until the server has it: no Notes, no children, no moves.
- Triage (9.0): a Deck with 20 or more Notes offers a sweep that marks Notes Known, Unsure or New, with
  Undo, a decisions list and resume. Known is the `known` status; Unsure and New are a mark beside an
  active status (migration 0018). Triage writes no Card or Review and skips Notes with an answered Card.
- Learning waves (9.1): a Deck's Notes in Study are cut into waves of 50 in file order, Unsure first
  inside each wave. The time-based throttle still decides how many start. The Deck screen shows the
  current wave, what Study lets in today or why it lets in none, when the next wave starts and what waits
  after it; Today's rows name the wave instead of every new Note.

Recent Notes (#81) adds Recently added (`createdAt`) and Recently changed (`updatedAt`) to Library's
existing Note browser, with dates, locations, filters and editor return. Migration 0019 adds read indexes
with no-wait locking and local execution/idle limits; runtime schema compatibility alone does not prove
these indexes were applied, so release verification also checks their journal hash and validity.
The category/duplicate journey commits its search and waits for Note rows before opening the editor.
Installed-iPhone acceptance remains open. See `recent-notes.md` for semantics and acceptance steps.

Not built: offline Import application, rank-ordered waves, Phase 9 progressive directions and the
problem-card area, Phase 10 personal plans, mail delivery, a `sync_conflicts` recovery screen.

Owner acceptance on the installed iPhone is the gate for interaction work. The last full acceptance was
Phase 8.4 (PR #53) and offline Study (PR #54/#55). PR #56 was not accepted: the app still felt slow,
inconsistent and cumbersome, which started the quality pass below. Everything since needs
installed-iPhone acceptance.

## Integration, merged 2026-11-01

| PR  | Commit    | What it changed                                                                                              |
| --- | --------- | ------------------------------------------------------------------------------------------------------------ |
| #66 | `6b9c6f2` | The seed creates canonical Cloze slots; a read-only tool inventories legacy slot-0 Cloze Cards.              |
| #67 | `7605770` | New Notes offline, delivered once under their own id.                                                        |
| #69 | `893a49c` | Triage, migration 0018. Offline triage leaves out unsent Notes and delivers after this device's Note writes. |
| #68 | `756a1f3` | New Folders and Decks offline. Note and Folder/Deck save failures keep separate messages.                    |
| #72 | `4e60772` | CI runs the 33 database test files (RLS, repositories, routes) that it used to skip.                         |

## Quality pass, merged 2026-10-30

| PR  | What it changed                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #57 | api functions run in `fra1` next to the Frankfurt database instead of `iad1`. Every query used to cross the Atlantic: Study planning made about 21 sequential queries, 2.4 s. Production reads `fra1::fra1`, `/health` and `/db-check` answer 200.                                                                                                    |
| #58 | A Review delivery that fails without a server answer retries by itself (2, 5, 15, 30, 60 s). Today says "sending", "waiting" or "not accepted" instead of sending the learner to Settings.                                                                                                                                                            |
| #60 | One motion system (screens arrive by direction, dialogs, menus, toasts, card advance and Undo, disclosures and Library folders), no focus ring after a tap, choices drawn as switch rows, a faithful drag preview, Deleted and headers matching Library, readable toasts, dialog glass without the colour boost, a Study tap that waits for its plan. |
| #59 | This file, the browser test index, `test:screens:ci`.                                                                                                                                                                                                                                                                                                 |

## Next

1. Installed-iPhone acceptance of the integrated release: the scenarios in "Acceptance on the iPhone"
   below, then the quality pass and earlier offline features (screen and card motion, folders and
   disclosures, Study start after a setup change, offline Practice on two devices, offline Import drafts).
   Include Deleted search, category choices, long-list scrolling, parent-dependent restore and purge
   confirmation. Include Find Notes filters, editor return, downloaded results and reconnection.
   Include collection search with duplicate names, long paths, collection return and offline results.
   Include Tags & Sources counts, long values, keyboard/Back return, pending Note tags and creations,
   reconnection and account switching. Browser results do not replace installed-device acceptance.
   Include Possible duplicates alongside categories: cross-Deck terms, editor return, local edits,
   pending Notes, reconnection and account switching. See `possible-duplicates.md`.
2. Rank order for waves. Waves follow file order today; a frequency list imported out of order would
   need waves by its rank column, which is a per-Deck choice for the owner.
3. Phase 9 continues: progressive directions from demonstrated stability, then the problem-card area.
4. Dark-theme depth: cards sit close to the canvas, and with Liquid glass on cards they render darker
   than it. A lighter glass attempt was rejected; any next attempt is shown as screenshots first.
5. A refused Review answer still pauses all new online Study. Narrowing that to the affected cards is a
   learning-semantics decision for the owner.

## Acceptance on the iPhone

- Import a list of a few hundred words, sweep part of it in triage, mark some Unsure. The Deck screen
  shows Wave 1 with Unsure first, and Today's row says `wave 1: N new`. Study starts the Unsure words
  first; the number of new words matches what Today promised.
- Answer a session, return to the Deck: started rises, waiting falls. When reviews fill the minutes,
  the card says none comes in today and why.
- Offline: mark a word Known in triage, then open Today. It is not offered. Reconnect: the decision is
  sent and the plan agrees.
- Offline: create a Deck, then a Note in an existing Deck. The new Deck opens nothing until it syncs;
  the Note is not in triage until the server has it. Reconnect: both arrive once.

## Open threads

- Account export (#71) remains under critical review. Settings prepares a versioned server snapshot
  with stored triage and immutable history; device-only work and archive import/restore are excluded.
  Hosted streaming and installed-iPhone Files/Share acceptance remain open. See `account-export.md`.

- Practice/search interaction repair (#84, `7b6db0c`) is on protected `main`.
  It retains synchronous search drafts and search scroll position, adds Practice keyboard/focus support
  and guards the local intent/acknowledgement race, including Recent Notes #81 and its follow-up #83.
  Browser keyboard geometry cannot replace Home Screen iPhone/VoiceOver acceptance; performance
  evidence and remaining limits are in `interaction-performance.md`.

- Preliminary offline duplicate keys retain the inherited UTF-16 prefix difference from PostgreSQL
  for very long supplementary-Unicode terms. Server groups remain authoritative; see
  `possible-duplicates.md`. The existing normalization and Import contract are unchanged.
- PR #71 User Data Export and PR #74 Large Import Hardening remain outside this integration pass for
  separate critical review.
- Study passes over Cards whose Note no longer produces a displayable face, so a sitting can finish.
  Legacy cloze Cards at slot 0 can still count as ready, use a new-card place, or remain overdue.
- Local new-card admission offline is conservative over the last complete download and this device's
  events; it cannot see other devices' offline work. Reconnection keeps server authority.
- Hosted CI has shown one unreproduced desktop navigation scroll assertion and occasional Chromium
  context crashes. Assertions and failure artifacts are kept; see `interaction-performance.md`.
- The Preview database is one empty, long-lived Neon database shared by all previews.
- Dependency alerts: `nanoid` 3.3.17 and the Drizzle tooling `esbuild`.
- Triage decisions not yet delivered are not listed in Settings > Offline & sync. The server plan has
  not heard of them; this device's offline plan applies them conservatively. See `offline-collection.md`.
- Legacy Cloze Cards at slot 0 are inventoried by `docs/legacy-cloze-assessment.md`, not repaired. The
  repair policy there needs owner approval before any migration.

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
| 2026-11-01 | Triage is a mark beside status; Known is the `known` status | No second status model, no change to Study admission       |
| 2026-11-01 | Triage never classifies a Note with an answered Card        | Study's evidence outranks a pre-learning guess             |
| 2026-11-01 | New Notes get their id on the device, Cards on the server   | One identity across retries; schedules stay authoritative  |
| 2026-11-01 | Waves of 50 order new material; the throttle sets how much  | Finite and visible without a daily quota                   |
| 2026-11-01 | Unsure first inside its wave (owner decision)               | Settles uncertainty early, moves nothing past one wave     |
| 2026-11-01 | CI runs the database tests against PostgreSQL 17            | Green CI had been skipping every RLS and repository test   |
