# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-10-16. Phase 8.4 stabilization PR #53 merged at `5d9c680` after its
required checks passed. The owner confirms installed production iPhone acceptance of offline access
and the reported interaction regressions. This closes the Phase 8.4 device blocker. It is owner
acceptance, not an instrumented native frame-rate measurement.

Phase 8.5 PR #54 merged at `d69c69f` on 2026-10-15 after required CI and production migration
checks passed. The owner confirms that offline Study works on the installed iPhone PWA. Device
acceptance nevertheless exposed connectivity instability and a reported incomplete-history restriction;
the stabilization on `work/connectivity-study-readiness` must pass protected delivery and renewed
physical acceptance before Phase 8 expands. A complete downloaded collection can plan and start
Study locally through the familiar Today/setup/card interfaces. The API and downloaded planner share
one deterministic planning pipeline over `packages/core`; a lazily created, shell-cached worker performs local cloning,
validation, replay and forecasting. Online planning keeps its existing transaction/read topology.

New admission requires matching downloaded account settings/revision, complete usable history and
explainable local workload. Missing history, unresolved Review recovery and unreconciled Note edits
restrict new material, including override, and exclude affected work. Valid pending Review/Undo
intents are deduplicated and replayed before each new sitting. Answers and visit-local Undo keep the
existing durable outbox, causal delivery, exact retries and server reconciliation. No database version,
SQL migration, persisted event format or scheduling policy changes. Reload retains committed work,
not a sitting or its Undo stack. Other devices' later changes reconcile after authenticated reconnection.

The post-merge main run `38775107806` measured 47.9 FPS in sustained full-glass swipe movement. Matched
hosted controls reproduce 50.3–53.5 FPS with continuous trace screenshots and 60 FPS without them.
Keeping DOM/network/action traces while excluding continuous screenshot recording passes nine hosted
cases at 60 FPS; nine unrecorded controls also pass. Failure screenshots, original gestures, assertions,
4× CPU throttle, 55 FPS threshold, glass appearance and the protected gate remain. No product rendering
regression was confirmed. See `interaction-performance.md` for evidence and platform limits.

PR #54's earlier implementation checkpoints are retained in the domain/performance documents.
The stabilization passes fifteen PostgreSQL/RLS planner comparisons and twenty-two snapshot guards,
including legacy origins, later-dated roots, Undo, Restart, deletion/purge and genuine missing history.
The full unit/PostgreSQL suite passes 1,139 tests across 101 files. Six built-PWA Chromium/mobile
WebKit journeys pass with real HTTP and PostgreSQL, covering connectivity plus cold Study,
answer/Undo, reopen, lost responses and authoritative reconciliation. The browser selection/gate
contracts pass 31 cases. The final built serial interaction gate passes 616 cases with fourteen
explicit opt-in skips. All five enforced performance cases and 66 Windows visuals pass; eleven
inspected Settings/readiness and dialog-background references changed intentionally. Sustained
active swipes measure about 60 FPS in all three glass modes against the unchanged 55 FPS requirement.
Protected CI and renewed physical-iPhone acceptance remain pending delivery.
The Chromium-only large-data measurement retains its explicit WebKit skip: no large-WebKit
performance result is claimed.

The acceptance repair separates transport reachability, temporary server silence, usable downloaded
content and authenticated authority. The old two-second account deadline falsely disconnected slow
successful requests; per-navigation validation, coupled probe deadlines and canceling retries
amplified churn. Checks now join one bounded request, reuse recent healthy transport evidence and
retry automatically after loss. A passive check after 1.5 seconds of pending HTTP changes no presentation.
Without successful API progress, active HTTP permits local access at three seconds and standalone
account silence at four, without a false global Offline label. The original validation remains
eligible until its eight-second bound.
Only matching authenticated validation restores online writes/delivery. Mounted content and caches
survive transitions; fixed content-free lifecycle stages retain check, silence and recovery timings.
The read-only authenticated server planner retains its existing parallel startup prefetch and
matching-context checks; it does not gain write authority from that request.
An additional failing real-PWA reproduction confirms that API-wide HTTP server errors previously
left qualified local Study unavailable. Read/planner errors now use bounded account corroboration;
healthy account validation preserves an isolated endpoint error, while corroborated server failure
permits local use without a false network-disconnected label.

The history guard now follows the existing canonical captured origin instead of assuming zero-based
Review counts, and retains purged Card workload attribution without admitting those Cards. Both
defects were reproduced against complete persisted histories; a read-only content-free application
database audit confirms the relevant legacy/purge patterns. Original schedules, Review identities,
replay and admission policy are unchanged. A completed pull refreshes existing account metadata when
delivery advanced the revision. Settings distinguishes a browsing download from verified Study data;
genuine uncertainty still restricts new material/override and retains recoverable work.

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

Phase 8.0 is merged through PR #43 at `ec1c980`. The owner confirmed that production migration 0017
was applied and verified. The release adds shared Note/Card planning and history protection to sync,
durable exact-delivery receipts, explicit Review outcomes and revision-consistent pulls.

Phase 8.1 merged through PR #44 at `4264426` on 2026-10-10. It adds versioned account-scoped IndexedDB collection persistence,
atomic pull-page/cursor application, resumable complete hydration and read-only offline Folder/Deck/
Note browsing. A versioned service worker caches the shell and static assets, never authenticated APIs.
Remembered offline accounts remain distinct from validated sessions; explicit sign-out, account
switching and reconnect rejection revoke local UI access. Storage failures retain online usability.
Production acceptance on installed iPhone and desktop found unusable hydration and intrusive global
status banners. The real PostgreSQL/browser reproduction identifies migration 0012's MD5-derived Deck
IDs: PostgreSQL stores them as UUIDs, but RFC-only UUID validation rejected the sync page before its
IndexedDB commit. Fresh UUIDv7-only browser fixtures did not cover this persisted identity contract.
PR #46 merged the repair at `8140122`; it validates canonical PostgreSQL identities without rewriting
them, keeps page/cursor commits atomic, stabilizes background retries and retains completed downloads
during incremental failure. Status and deliberate recovery live in Settings; download states never
precede screen headers. A connection indicator sits outside content flow beside navigation.
The owner confirmed installed-iPhone production acceptance: a completed collection reopens and is
browsable offline after restarting the PWA.

PR #47 merged the in-session continuity and browsing parity follow-up on 2026-10-10 at `e63c64d`.
A failed collection GET confirms transport availability through `/account`, including when browser
connectivity hints remain online. HTTP errors, aborted reads and isolated mutation/sync failures do
not establish an outage. Account validation must succeed before online operations resume; late
responses from an earlier connectivity visit cannot restore them.
Library and Deck lists keep their mounted presentation, expansion/search/filter state and query data
while reads switch to the completed local snapshot. Shared hierarchy rows, breadcrumbs, Note rows,
field labels and headers provide offline parity. Server controls unmount; occupied control space is
retained for the current visit. Note reading mounts no editor/autosave controller. Missing, incomplete
or unreadable snapshots present an honest unavailable state. The owner accepted offline reopening,
Library/Deck/Note browsing, visual parity and in-session connectivity transitions on the installed iPhone.

Phase 8.2 merged through PR #48 at `b2644236`. Completed local snapshots
can supply first-entry Library/Deck/Note content while authoritative requests continue. Local provenance
keeps autosave, Study readiness, Practice progress and other server operations behind their existing
authority gates. A revision-keyed derived projection shares validation/scans, and Note counts use a
single pass; router preloading, virtualization and scroll restoration retain their existing contracts.

The first offline write is renaming an existing Folder or Deck. An account-bound IndexedDB outbox
atomically saves the visible name intent and original observed server row/revision. Authenticated
matching-account reconnection delivers the original operation ID/payload through a compare-and-set
endpoint backed by immutable retry receipts. Remote changes/deletion/purge produce retained conflicts,
not silent overwrites. Settings exposes saved names, original versions, retry and explicit recovery.
Compatible upgrades preserve stores; Rebuild refuses unresolved work or an unreadable/future database.
Browser eviction can still remove device storage; saved locally and synchronized are distinct states.
Phase 8.2 browser/database verification passes, including real PostgreSQL retry/RLS coverage,
Chromium/mobile WebKit persistence and conflict recovery, the full built interaction gate, Windows
visual contracts and the unchanged 55 FPS budgets. The owner confirms that offline rename/outbox
functionality works. Initial installed-iPhone production acceptance found provisional read-only Deck
presentation, shifting controls, interrupted navigation and degraded motion across unrelated screens.
These findings prompted the stabilization delivered through PR #49.

The stabilization separates local provenance from connectivity and authenticated authority. Online
Decks retain their normal geometry with server-dependent controls disabled until authoritative data
arrives. Zero-freshness seeds retry after interrupted navigation; cached query answers avoid local
snapshot work, ordinary browsing omits unused Cards, validation yields between bounded batches, and
unchanged account state does not notify global observers. The shell preserves the top safe area at
every breakpoint and covers it above scrolling content. Durable database/outbox formats and rename
delivery/conflict contracts are preserved. PR #49 merged on 2026-10-11 at `4565b1c`; required CI,
the unchanged browser/screenshot gate and both Vercel checks passed. After merging, the owner confirmed
that the application feels good on the real iPhone. This closes the reported production interaction
acceptance blocker. The device report is owner acceptance, not an instrumented per-interaction trace.
See `interaction-performance.md` for measured evidence and platform limits.
See `offline-collection.md` for the storage, lifecycle, recovery and later-write boundaries.
Phase 8.3 adds durable fields/tags drafts for downloaded existing vocab/basic/cloze Notes in the same
Note Editor. Raw invalid drafts remain on-device; valid content uses matching-account entity-revision
delivery and immutable receipts. Unsent edits coalesce; delivery freezes exact retry identity/payload,
and newer working edits become a new operation after acknowledgement. Remote conflicts retain local
and original versions with explicit fresh-revision recovery. Shared Note/Card planning preserves retained
Card identities/schedules/Reviews and refuses every Card removal. Local Note events avoid collection
store scans/global notifications while typing; local content cannot seed authoritative learning pools.
No SQL migration or IndexedDB version change is needed. See `offline-collection.md` for recovery,
unsupported transitions and the physical-iPhone acceptance checklist. PR #50 merged at `b6dfab7`;
the owner confirmed physical-iPhone acceptance of offline editing,
persistence after PWA reopening, authenticated synchronization and server reconciliation.
Release verification passed all 1,088 unit/PostgreSQL tests, package typechecks, source lint,
isolation/design checks, formatting and the production web build. The built serial phone/desktop gate
passed 520 interactions with six selection skips; all 66 unchanged Windows visuals and all five enforced
4× CPU performance cases passed. Dedicated Chromium/mobile WebKit Note cases passed 36 of 36.
Real offline/PWA and learning journeys passed separately in Chromium and mobile WebKit.
All 62 affected WebKit offline cases and the committed touch-swipe regression passed.
Phase 8.4 adds account-scoped durable Review/Undo intents before advance or exit, immutable exact
retry and explicit causal acknowledgement/rejection. An admitted server-planned sitting continues
offline through its existing Cards and time/workload limits. Undo remains visit-local LIFO and ends
with exit/reload. Reload retains delivery intents, not a resumed sitting. New Study admission waits
for authenticated reconciliation; explicit rejected-session recovery archives retain all undelivered
events without claiming synchronization. Settings summarizes saved work and bounds optional receipt
details without deleting receipts, drafts, conflicts or archives. The server response addition uses
existing Review rows and submitted times; no SQL migration is required. IndexedDB upgrades to v3.
Release verification passes all 1,095 unit/PostgreSQL tests, including restricted-role Review/Undo,
RLS and canonical replay coverage. The final built serial phone/desktop gate passes 560 interactions
with ten opt-in selection skips; all 77 targeted mobile WebKit cases, both real-PWA Review journeys,
66 unchanged Windows visuals and five enforced 55 FPS cases pass.
See `offline-study.md` for guarantees, recovery and physical-iPhone acceptance steps, and
`interaction-performance.md` for the matched PR #49 measurements.
Phase 8.5 local Study planning is described above and in `offline-study.md`. Offline Note creation,
persistent Practice synchronization and offline Import application remain unimplemented.
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

## Required browser CI

The CI optimization keeps `Browser and screenshot tests` as the protected required check.
A short selection job feeds independent phone and desktop interaction runners, each with one worker,
and the selected Windows visual job. The aggregate requires both interactions and any selected visuals
to succeed; missing, failed, cancelled or skipped required suites fail closed. Visual diagnostics do
not wait for interaction completion. Existing change-aware selection, test coverage, browser binaries,
assertions, retries and baselines remain unchanged. This adds runner setup/download duplication in
exchange for concurrent execution without sharing rendering resources.

[Clean hosted run 38012456570](https://github.com/Sandaliy/Neuron/actions/runs/38012456570) passed in
5m27s versus PR #44's 18m11s. Phone/desktop interactions took 4m12s/4m21s concurrently, retaining
426 passes and four skips; all 66 visuals passed in an independent 2m07s Windows job. Chromium
installation took 22s/24s, compared with 7m29s in PR #44; external download stalls remain possible.
The deliberate phone assertion failure in
[probe run 38012451111](https://github.com/Sandaliy/Neuron/actions/runs/38012451111) made the required
gate fail, retained interaction reports and allowed visuals to finish. That probe also caught an
unchanged desktop navigation scroll assertion (1159 instead of 1200 at `navigation.spec.ts:116`);
the clean hosted run and local full gate passed it. Its cause remains unproven; assertions are intact.
Local full interactions (426 passes, four skips), 66 visuals and 31 selection/gate checks passed.
The CI optimization merged through PR #45 on 2026-10-10.

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

1. Deliver the Phase 8.5 connectivity/readiness stabilization through the protected PR workflow after relevant database, built-PWA,
   interaction, visual and unchanged performance checks. Inspect hosted checks once after the final push.
2. Obtain renewed installed production iPhone acceptance: stable mobile/home navigation, automatic
   reconnection, one Check connection action, verified Study history, offline sittings and reconciliation.
3. Keep Offline Practice, Note creation, Import application and Phase 9 direction unlocking outside
   this slice. Any material protocol, persistence or scheduling expansion requires owner approval.

## Open threads

- PR #54 offline Study works on the owner's iPhone; connectivity/readiness acceptance remains blocked
  pending the stabilization and renewed device check. Phase 8.4 was accepted after PR #53; retain its
  earlier failure evidence and content-free lifecycle diagnostics for future native investigations.
- Local new-card admission is a conservative decision over the last complete download and this
  device's committed events. It cannot observe other devices' subsequent offline work. Reconnection
  retains server authority and never silently acknowledges rejected events.
- PR #50/#51 first attempts crashed in Chromium context creation with identical native fault offsets.
  The post-merge Study failure is a separate local-acceptance versus server-delivery assertion race.
  Routed fixtures now block incidental service workers; explicit real-worker PWA coverage remains.
  Preserve native-crash uncertainty, failure artifacts, all assertions and the fail-closed required gate.

- Extended Windows mobile WebKit coverage passed 160 of 161 cases after isolating service-worker
  fixture interception. One exact inside-Folder drag assertion failed and passed an unchanged isolated
  rerun. Its trace is retained; the full extended run is not green. Protected CI and owner iPhone
  acceptance passed independently. See `interaction-performance.md`; preserve the drag assertion.
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
