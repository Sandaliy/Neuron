# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-10-08, navigation reliability and interaction continuity prepared for protected review.

## Current release slice

PR #28, Restore learning experience, is merged into `main`. Its required CI and Vercel checks passed
before merge, and the release is deployed to production. A physical-iPhone production acceptance pass
has also been completed. The visual direction is successful: the new Study surface and animations are an
improvement, and Typing and Listening are reachable and functional in production.

Deck Study skills now enable missing Typing/Listening Cards on existing and future eligible Notes using
the existing ladder. Existing identities, schedules and Reviews are preserved. Practice persists Typing
and Listening response modes without scheduled-learning writes. Mark as known and Return to study alter
participation only; Restart learning remains the explicit reset with immutable history.

Study and Practice share a focused reading surface with prominent prompt/answer typography, visible
reveal, integrated spelling feedback and no competing global navigation. Typing now enters an
application-owned keyboard-ready composition before native focus while the learning frame stays anchored
to the layout viewport. Enter checks locally and restores feedback/rating space.
Library uses clearer Folder/Deck hierarchy and account-bound live Note counts. Browse Card summaries
support immediate participation/move projections; fresh workload admission remains server-owned.

The iPhone pass identified the stabilization work below. Phase 8 offline sync and Phase 9 progressive
unlocking and statistics remain outside this slice.

Daily Study readiness stabilization shipped in PR #30, merged into `main` and deployed to production.
Confirmed answers separate other first-appearance directions of the same Note until the next local
study day while precise retries remain eligible. Today and per-Deck summaries share that admission
rule, and Today shows an updating state after confirmed answers until server-owned admission returns.
Physical-iPhone production acceptance of completed-session Today reconciliation remains outstanding.

PR #33 is merged at `b4f3c53`. Its layout-viewport anchored learning frame and pre-focus keyboard-ready
composition are accepted on the physical iPhone and remain the baseline. Study Undo traverses only the
active session's answers, with serialized append-only compensation.

PR #34 is merged into protected `main` at `bf9cce8`. It keeps
header/progress anchors stable, unifies native Return and Check, and preserves drafts through blur.
Practice starts at 0 learning / 0 known, measures classified progress, and provides visit-local,
versioned multi-step Undo without Review/schedule writes. Recipe settings stay at entry/resume. Today
uses a discoverable Study setup disclosure. Scheduled and Practice Listening now check the typed heard
term, reveal context afterwards, and leave the learner's rating/classification explicit. Listening
setup exposes Deck-language recovery and deterministic compatible system voices with device-local choice.

PR #35 is merged into protected `main` at `bc75c05`. Study
uses one effective target language per sitting. Persistent Daily Study Deck participation remains the
workload universe; language and direction filter the sitting after a shared forecast/admission decision.
Today's introductions and spent answer time consume the same automatic capacity across languages,
including introductions in a subsequently paused Deck. Explicit temporary Deck scope retains its own
existing semantics and resets when the sitting ends. Planning writes no Card schedules or Reviews.

Today metrics describe the selected language and mode, with an aggregate indication from the shared
plan. Quiet setup contains a Folder/leaf Deck picker and session-local meaning/support choices. Reveals
separate the main answer from labeled supporting content. Card encounters start fresh, including on
Undo, and device-local voices remain compatible with the active target language. Apple system effects
are excluded; automatic selection avoids Albert, while deliberate ordinary-voice preferences remain
available. The normal picker shows a small recommended set with More voices for other compatible
ordinary voices, without inferring undocumented quality tiers. Practice entry/resume
uses classified progress, a quiet recipe/setup affordance and numeric active counters; its persistence
and Undo protocol remain unchanged.

Local scheduler/shared/web verification passed 595 tests and 25 real-Postgres Study/learning tests.
The final built-app serial interaction gate passed 326 tests across phone, desktop and WebKit, with
4 skips recorded separately; WebKit accounts for 58 passing tests. The opt-in real API/database browser
flow passed. All 58 phone/desktop visual tests passed; affected setup, hierarchy, voice, reveal and
Practice screenshots were inspected, with only six intentional Today references refreshed. Typechecks,
lint, formatting and production build passed. Hosted PR checks and physical acceptance remain separate
from local evidence.

Physical-iPhone acceptance is required for final Study setup, multi-language switching, voice filtering,
three consecutive Listen → Type cards, and Practice ergonomics, including native Done and header
stability. Browser evidence cannot prove native keyboard or audio quality. External TTS remains
deferred. Navigation/tab selection are covered by the stabilization slice below.

PR #36 is merged into protected `main` at `8be13a4`. Library
Folders show descendant Deck counts and aggregate Note counts; leaf Decks separate their Note totals
from due/new Card counts. Quiet Folder surfaces, open Deck rows, wrapping names, common Folder/Deck
icons and the existing indentation guide align Library, Study multi-selection and Import destinations.
Destination search retains matching ancestors and omits unrelated branches. Note rows describe New,
Partly started, Learning or Practiced progress, with an accessible count breakdown for independently
scheduled Cards. Practiced is not a due or mastery claim; explicit Known/Set aside/Draft participation
remains separate. Missing progress data does not claim zero Cards. Today places its shared aggregate
Ready label on the right below the estimate, above the setup divider. Persistence, optimistic
reconciliation, scheduling, workload admission and Review history are unchanged.

This slice passed 335 shared/web unit tests, 278 built-app serial phone/desktop interaction tests and
8 focused WebKit tests. Four opt-in live API tests were skipped. All 62 built-app phone/desktop visual
tests passed; both-theme hierarchy, destination, progress and narrow Today screenshots were inspected,
with only eight intentional Library references added or refreshed. Four large-list performance tests
passed the enforced 55 fps budget at 4× CPU slowdown: 5,000 Notes measured 60.0 fps with 12 mounted rows,
and 500 Decks measured 58.7 fps in both row treatments. Lint, typechecks, formatting and production build
passed. Hosted checks and physical-iPhone acceptance of hierarchy touch/drag, moves, selection, pickers
and the Today aggregate placement remain required separately.

Navigation stabilization is prepared on `work/navigation-reliability`, without merge authorization.
Each committed route explicitly owns its main tab, including Notes, Import and Deleted under Library.
The screen key follows the committed match rather than a pending address; the accessible current tab,
label weight and aligned selection pill share that destination. Existing tokenized tab motion remains.
New Note drafts, unapplied type conversions and known autosave failures require Keep editing or explicit
Discard changes before leaving. Ordinary existing-Note edits still flush without blocking navigation.
Returning from Study or Practice restores the entry scroll position after the normal layout is ready;
Practice classifications and persistence remain unchanged. Browser coverage exercises direct routes,
nested collection paths, history, rapid switching, menu cleanup, pending writes and learning returns.

Local verification passed 335 shared/web unit tests, 298 built-app serial phone/desktop interaction
tests and all 30 focused navigation checks across phone, desktop and WebKit. Four opt-in live API tests
were skipped. The broad WebKit run passed 69 of 70 tests; the existing root-insertion drag test selected
a Folder instead of the root insertion point once. That test passed isolated on all three projects and
in four clean-main WebKit trials, so the broad-run failure remains unattributed and unresolved. The
final focused run passed 33 tests including those isolated drag checks. All 66 phone/desktop visual
tests passed; affected main screens and the four new draft-dialog references were reviewed in both
themes. Four performance tests passed the enforced 55 fps budget at 4× CPU slowdown: 5,000 Notes measured
60.0 fps with 12 mounted rows, and 500 Decks measured 58.7 fps in both glass scopes. Web typechecking,
production build, source lint excluding generated browser reports, formatting, core isolation and
design-token checks passed. Hosted checks and physical-device acceptance remain separate evidence.

The reported intermittent installed-iPhone wrong-tab symptom was not reproduced in automated browsers.
Missing collection tab ownership and learning-return scroll loss were reproduced and fixed. Physical
iPhone acceptance remains required for rapid tab switching, app background/return, native Back, keyboard
dismissal around draft confirmation, and Study/Practice return ergonomics. Library hierarchy and styling
still await user visual feedback; this slice does not redesign them or begin Offline & Sync.

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
Phase 7 Daily Study is shipped. Its backend/core session foundation provides a
deterministic time-based first-appearance plan, workload-backed and explainable new-card admission,
an explicit one-off override that does not change long-term settings, and a fair due-preserving retry
pool. Study now plans visibly from one-off time and scheduled-direction choices, keeps reveal and advance
local after the plan arrives, offers append-only current-session Undo, and ends with a useful summary.
Practice provides configurable front/back rounds without Review or schedule writes. The collection slice
adds atomic exact-position touch/mouse placement, committed swipe deletion, targeted rapid recovery,
compact headers and navigation paths, and live-dependency filtering so deleted collections cannot enter
Today or Study.

## Done

| Phase    | What it produced                                                                               |
| -------- | ---------------------------------------------------------------------------------------------- |
| 0 to 0.5 | Monorepo, shared tooling, Better Auth, Neon Postgres, and Vercel deployment                    |
| 1 to 2.5 | FSRS-6, time-budget scheduling, backlog control, and simulator evidence                        |
| 3 to 4.5 | Data model, RLS, repository layer, API, sync, recovery codes, and optional TOTP                |
| 5        | Web shell, authentication screens, library tree, Today, themes, and two languages              |
| 5.5      | Design tokens, component gallery, glass and motion rules, phone fixes, and screenshot coverage |
| 6        | Writable collections, recovery, import, Folder/Deck integrity, and real-device acceptance      |

## Next

1. Repeat physical-iPhone production acceptance of completed-session Today reconciliation after PR #30.
2. Complete remaining physical-iPhone acceptance of merged language-scoped Study/configuration and
   learning presentation, including the PR #34 Listen → Type and Practice interaction contracts.
3. Reassess system speech quality after device acceptance before considering external TTS.
4. Complete physical-iPhone acceptance of merged PR #36 Library hierarchy, learner-facing
   Note/Card progress, consistent destination/Study pickers and Today aggregate placement.
5. Complete protected review and installed-iPhone acceptance of navigation/tab selection, nested Back,
   draft protection and learning-return continuity.

## Open threads

- The long-lived Preview database is intentionally empty and shared by preview deployments. Resetting it
  or moving to one database branch per pull request remains a later automation task.
- The note-list performance fix preserves selection across virtual mounts, refreshed row data and native
  keyboard activation. Targeted browser checks pass in both themes at phone and desktop widths.
- Browser checks and real-iPhone acceptance cover the shipped collection, recovery, import, and keyboard
  flows.
- PR #28's Typing/Listening learning experience passed required CI and Vercel checks, was deployed, and
  passed physical-iPhone production acceptance. That pass found the Today refresh/readiness, keyboard,
  Listening interaction, hierarchy/status language, TTS setup/quality, response-mode discoverability,
  broader flow, navigation-motion, and tab-selection issues listed under Next. The Today findings are
  addressed by deployed PR #30, pending physical-device verification.
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
- The production API is in `iad1` while users and web requests enter through Europe. Region alignment
  remains deferred because the database must move with the API.
- Mail delivery is disabled. `MAILER=log` is the only configured sender.
- `sync_conflicts` records losing versions but the web app has no recovery screen.
- The production web bundle is about 596 KB before gzip. Code splitting remains deferred.
- Dependency alerts include `nanoid` 3.3.17 and the Drizzle tooling version of `esbuild`.
- `drizzle-kit check` could not run locally because Node returned `uv_os_get_passwd ENOMEM`; the
  escalation retry was rejected by automatic approval review. The generated journal and snapshot chain
  is internally consistent; the real-database migration suite still requires a throwaway test database.

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
