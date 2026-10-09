# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-10-10, Phase 7 closed after merged PR #41 and final physical-iPhone acceptance.

## Current release

Phase 7 is complete on protected `main`. PR #41, Fix final Phase 7 Study and Practice acceptance
issues, merged on 2026-10-09 at `703890b`. Its CI checks (including browser and Windows visual
contracts) and both Vercel checks passed. The owner confirmed final physical-iPhone production
acceptance after that merge: Study, Practice, Today, Library, navigation, keyboard, progress,
configuration recovery and interaction improvements are accepted.

The cumulative releases through PR #41 provide:

- Daily Study with deterministic time-based workload planning, explainable admission, review priority,
  related-direction separation, difficulty spacing and fair retries. Cards remain independently scheduled directions.
- Recognition, Recall, Typing and Listening, plus configurable persistent per-Deck non-SRS Practice.
  Entry, answer/check/reveal, explicit grading/classification and completion form a complete loop.
- Current-session Study Undo through append-only compensation and visit-local LIFO Practice Undo
  through versioned, retry-safe commands, available through completion. Practice writes no Reviews
  or Card schedules; unseen Notes count as neither Learning nor Known.
- One effective target language per Study sitting. Persistent Deck participation defines the shared
  workload universe; language/direction filter after admission. Spent time and introductions consume
  the same default budget across languages, including subsequently paused Decks. Explicit temporary
  Deck scope retains its separate semantics. Planning writes no schedules or Reviews.
- Device-local compatible system voices with deterministic discovery/fallback, supporting Card display
  and saved Study setup through the authenticated visit. Ending a sitting clears one-off time, scope
  and override; language, direction and display remain for that visit, not as a new account plan.
- Anchored learning geometry and application-owned pre-focus keyboard-ready composition. Native
  Return/Done and Check share the non-empty submit path; drafts survive non-submit blur.
- Stable route-owned navigation/history and learning-return scroll, collection hierarchy and counts,
  responsive confirmed projections, authoritative readiness gates, stationary glass and restrained motion.
- PR #41 prevents pending voice discovery from expanding Today setup on ordinary return, measures
  active Practice Known progress across repeat/resume/Undo, and makes unavailable recipes actionable
  while preserving the saved run until explicit replacement confirmation.

Phase 8 Offline Collection and Synchronization is the next active milestone for planning. No service
worker, IndexedDB collection or general offline mutation queue is implemented by this closure pass.
Phase 9 triage/waves/progressive direction admission and Phase 10 personal plans/progress remain later work.

## Performance monitor diagnosis and policy

The standalone workflow is manual-only via `workflow_dispatch`; it is informational and is not a
required main-branch check. Required CI/Vercel protections and controlled performance tests are unchanged.
The real 55 FPS acceptance budget, 4× CPU slowdown, summaries, threshold warnings and artifacts remain.
Use `PERFORMANCE_ENFORCE_THRESHOLD=true` with `PERFORMANCE_BENCHMARK=true` for controlled acceptance.

Inspection on 2026-10-10 found one failure among 47 available benchmark runs, rather than repeated
recent red runs. [Run 37982185333](https://github.com/Sandaliy/Neuron/actions/runs/37982185333) measured
5,000 Notes at 60.0 FPS (14 mounted rows) and Panels only at 58.7 FPS. All-glass Decks and mixed
collections measured 37.5 and 36.4 FPS, with worst frames of 666.6 and 700.0 ms. The actual failure was
`performance.spec.ts:206`, a background-color assertion, not enforced FPS. The trace records chosen
full glass changing to effective off during scroll; runtime frame adaptation explains why the final
row no longer matches the glass surface. The preceding PR #40 hosted run passed all five tests,
including glass at 58.1/58.4 FPS. PR #41 did not change those collection styles or frame adaptation.

An unchanged built-app controlled run on merged PR #41 passed all five tests on 2026-10-10 with the
55 FPS threshold enforced: Notes 60.0, Panels only 59.3, all-glass Decks 59.3, mixed collections 59.7 FPS.
This supports a hosted-run sampling/adaptation anomaly rather than a confirmed product regression;
the cause of that runner's slow frames is unproven. Preserve the hosted miss as diagnostic evidence.
Manual dispatch avoids automatic noise without masking failures or weakening assertions.

## Now

Phase 6 is complete on `main`. The release contains writable decks, note editing and browsing, shared
card planning, chunked imports, and persistent Deleted/Restore UI for soft-deleted decks and notes. The
5,000-note list passes the unchanged 55 fps budget, and the shipped collection, recovery, import, and
keyboard UX passed real-iPhone acceptance. A real non-production 5,000-note import also passed after a
committed chunk response was intentionally lost: resume produced 5,000 notes and cards, one batch, no
duplicates, a usable destination deck, and the documented undo boundary remained true.
The completed collection release also separates organizational Folders from leaf study Decks. Migration
0012 preserves legacy mixed nodes as same-ID Folders and moves their own Notes into deterministic
same-named child Decks while retaining Note, Card, and Review IDs and history. Server-owned deletion
operations govern subtree recovery; permanent deletion retains immutable Reviews and history-safe
tombstones. Library, destination pickers, Deleted, and import copy use the new model.

The stabilized `main` branch has protected pull-request delivery, required CI and Vercel checks, and
isolated preview data. PR #12 and the follow-up safety fix PR #13 are merged. Trusted main-only
production migration verification is active: the production journal was current after merge, so the
workflow verified it and skipped migration. Production Vercel compatibility checks use the restricted
`neuron_app` and `neuron_auth` roles; `/health` and `/db-check` are schema-aware and healthy. The
owner-only `DATABASE_URL_OWNER` credential remains confined to the protected GitHub
`production-migrations` environment and is absent from Vercel and runtime environments.
Phase 7 Daily Study is complete and physically accepted. Its backend/core session foundation provides a
deterministic time-based first-appearance plan, workload-backed and explainable new-card admission,
an explicit one-off override that does not change long-term settings, and a fair due-preserving retry
pool. Study now plans visibly from one-off time and scheduled-direction choices, keeps reveal and advance
local after the plan arrives, offers append-only current-session Undo, and ends with a useful summary.
Practice provides configurable front/back rounds without Review or schedule writes. The collection slice
adds atomic exact-position touch/mouse placement, committed swipe deletion, targeted rapid recovery,
compact headers and navigation paths, and live-dependency filtering so deleted collections cannot enter
Today or Study.

## Done

| Phase    | What it produced                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0 to 0.5 | Monorepo, shared tooling, Better Auth, Neon Postgres, and Vercel deployment                                              |
| 1 to 2.5 | FSRS-6, time-budget scheduling, backlog control, and simulator evidence                                                  |
| 3 to 4.5 | Data model, RLS, repository layer, API, sync, recovery codes, and optional TOTP                                          |
| 5        | Web shell, authentication screens, library tree, Today, themes, and two languages                                        |
| 5.5      | Design tokens, component gallery, glass and motion rules, phone fixes, and screenshot coverage                           |
| 6        | Writable collections, recovery, import, Folder/Deck integrity, and real-device acceptance                                |
| 7        | Complete Daily Study and persistent Practice, language-scoped modes, stabilized interactions and final iPhone acceptance |

## Next

1. Start a fresh Phase 8 planning conversation from the post-PR #41 accepted baseline and maintained
   architecture/sync contracts. Resolve IndexedDB evolution, shell updates and queue ownership before implementation.
2. Plan offline mutation/review replay, conflict recovery, authentication expiry, storage-loss recovery
   and cross-device convergence with failure-focused integrity tests. Preserve server authority and RLS.
3. Keep Phase 9 large-collection triage/waves/progressive admission and Phase 10 personal workload
   customization/statistics separate. Earlier design is appropriate only for concrete storage/sync prerequisites.

## Open threads

- The long-lived Preview database is intentionally empty and shared by preview deployments. Resetting it
  or moving to one database branch per pull request remains a later automation task.
- The note-list performance fix preserves selection across virtual mounts, refreshed row data and native
  keyboard activation. Targeted browser checks pass in both themes at phone and desktop widths.
- Browser checks and real-iPhone acceptance cover the shipped collection, recovery, import, and keyboard
  flows.
- Import duplicates use a default plus row overrides in the bounded preview. Only a unique same-type
  match can merge. Ambiguous or incompatible matches inherit Skip instead of Merge, with visible reasons.
  Merge fills schema-defined blanks and grammar leaves under a write lock, preserves existing metadata,
  cards and reviews, and refuses card removal. In-page Resume reuses the original row IDs and decisions.
  Undo removes batch-created notes/cards only; merged additions stay, as stated in completion and undo copy.
  Targeted database and browser tests cover these boundaries. Large-import interruption/resume acceptance
  passed against the non-production database at 5,000 notes.
- Existing-note type conversion uses a separate empty target draft, schema validation and explicit Apply.
  Cancel leaves the saved note unchanged; same-type fields and tags still autosave. Shared reconciliation
  replaces cross-type cards with new IDs and fresh schedules. Answered-card removal requires explicit
  confirmation, with review rows preserved. Real database tests verify rollback of note/cards/revisions;
  focused phone/desktop browser tests cover all target schemas, cancellation, confirmation and retry.
  Existing notes move through list selection. Explicit Deck skills and per-session direction choices
  are implemented; automatic progressive unlocking remains deferred.
- The note list exposes exact source filtering and per-row live-card summaries. Persistent Deleted/Restore
  UI now covers soft-deleted decks and notes.
- Server restore integrity is verified by 22 real-database regression cases. Decks restore individually,
  parent-first. Note restore uses explicit card deletion provenance, preserves schedules and reviews,
  and reports cards left deleted. Historical and independently deleted cards remain deleted. Sync follows
  the same dependency and provenance boundaries. Migration 0011 adds the conservative false default
  without historical attribution.
- Collection restoration uses explicit deletion operation IDs, never timestamps or revision equality.
  Independently deleted descendants remain deleted. Legacy deletions without provenance restore
  individually. Note restoration retains `deleted_with_note` attribution for Cards. Permanent
  deletion prevents restoration through repositories and sync without rewriting Reviews.
- `stash@{0}` remains a historical backup of earlier Phase 6 local work.
- Public production routing markers include `iad1`, while the production database is in Frankfurt
  (`aws-eu-central-1`). Confirm deployment region and authenticated timing before proposing region
  alignment or compute wake-up changes; database relocation is not established as necessary.
- Windows WebKit/desktop full-glass motion profiles have sampled long frames despite passing geometry checks.
  Final iPhone acceptance closes the native-device findings; those platform-specific measurements and the
  hosted glass benchmark anomaly remain diagnostic limitations, not evidence of a resolved compositor issue.
- Mail delivery is disabled. `MAILER=log` is the only configured sender.
- `sync_conflicts` records losing versions but the web app has no recovery screen.
- Web route modules are split. Frequent signed-in screens preload through the router alongside
  missing reads; authentication and recovery retain their existing lazy boundaries.
- Dependency alerts include `nanoid` 3.3.17 and the Drizzle tooling version of `esbuild`.

## Decisions

| Date       | Decision                                                                     | Why                                                                                                           |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Keep scheduling pure and deterministic in `packages/core`                    | Browser and server projections must match while offline                                                       |
| 2026-09-11 | Distinguish Folders and leaf Decks in the existing hierarchy                 | Folders organize and provide defaults; only Decks own Notes.                                                  |
| 2026-08    | Keep reviews append only                                                     | Card state can be rebuilt from the review log                                                                 |
| 2026-08    | Require user context in repositories and RLS in Postgres                     | User isolation must survive a route bug                                                                       |
| 2026-08    | Use recovery codes and optional TOTP without Google sign in                  | The current product has no mail or social identity provider                                                   |
| 2026-08    | Keep theme and language device-first                                         | Preference changes must not wait on the network                                                               |
| 2026-08    | Keep reusable visual contracts, docs, mockup, gallery, and code aligned      | Global design references should describe the reusable system, not every screen-level adjustment               |
| 2026-09-24 | Isolate CPU-sensitive Playwright work                                        | Frame-rate and Windows visual tests use one worker; interaction tests may run concurrently                    |
| 2026-09-25 | Separate browser, visual, and performance triggers by risk                   | Fast required smoke/targeted checks; broad suites retain distinct triggers                                    |
| 2026-09-03 | Protect `main` and deliver production changes through `work/*` pull requests | Production must receive only checked changes                                                                  |
| 2026-09-16 | Represent recent Undo as an append-only cancellation event                   | Canonical replay removes the target while preserving every later immutable answer                             |
| 2026-09-03 | Keep the prompt in `docs/card-generation-prompt.md`                          | It defines the product contract used by all three card generation modes                                       |
| 2026-09-03 | Run screenshot CI on Windows                                                 | The committed baselines use the same system fonts as the Windows runner                                       |
| 2026-09-03 | Use one empty, long-lived Neon Preview database                              | Preview work must never read or write production user data                                                    |
| 2026-09-03 | Pair web and api previews by their Vercel branch URL                         | A pull request tests both applications together while keeping cookies on the web origin                       |
| 2026-09-03 | Keep current state and future direction in separate documents                | `STATE.md` stays concise while `ROADMAP.md` controls milestone intent                                         |
| 2026-09-03 | Treat old plans as historical input                                          | Current code, migrations, tests, and maintained domain documents take precedence                              |
| 2026-09-06 | Ship coherent user-value slices instead of every individual task             | Keep `main` protected while avoiding CI/deploy cost for every small change; milestones may ship incrementally |
| 2026-09-06 | Group related work into coherent user-value releases                         | Avoid CI/deploy cost for every small task while allowing useful milestone work to ship incrementally          |
