# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-09-26, Daily Study readiness stabilization in protected PR preparation.

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
reveal, integrated spelling feedback and no competing global navigation. Existing visual-viewport
geometry drives compact Typing; Enter checks locally, blurs and restores feedback/rating space.
Library uses clearer Folder/Deck hierarchy and account-bound live Note counts. Browse Card summaries
support immediate participation/move projections; fresh workload admission remains server-owned.

The iPhone pass identified the stabilization work below. Phase 8 offline sync and Phase 9 progressive
unlocking and statistics remain outside this slice.

Daily Study readiness stabilization is implemented on a work branch for protected PR delivery.
Confirmed answers separate other first-appearance directions of the same Note until the next local
study day while precise retries remain eligible. Today and per-Deck summaries share that admission
rule, and Today shows an updating state after confirmed answers until server-owned admission returns.
Real-database, browser and protected CI results must be recorded before calling the slice shipped;
physical-iPhone production acceptance of this fix remains outstanding.

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
local after the plan arrives, offers append-only recent-answer Undo, and ends with a useful summary.
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

1. Deliver and validate Daily Study readiness stabilization through protected PR checks, then repeat
   physical-iPhone production acceptance of completed-session Today reconciliation.
2. Stabilize the real iPhone keyboard transition, which can resize or shift the Study card inconsistently.
3. Revisit Listening's main interaction (possibly Listen → Type), the buried TTS language setup and voice
   quality, and the deeply buried Study response-mode choice.
4. Refine Folder/Deck visual hierarchy and replace implementation-oriented Note/Card summaries such as
   `mixed` and `3 in review` with learner-facing language.
5. Make broader key flows feel less developer-oriented, consider lightweight navigation motion, and
   investigate why the bottom tab can occasionally mark Library active on Today or Settings.

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
  addressed by the current readiness slice pending protected delivery and physical-device verification.
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
