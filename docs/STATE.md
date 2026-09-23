# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update this document at the end of a substantial implementation session when the current state has
materially changed.

Last updated: 2026-09-22, rich Study and interaction responsiveness slice.

## Current release slice

`work/rich-study-responsiveness` builds on merged `f4c2fa4`. Production now checks vocabulary terms
locally with conservative Unicode/case/whitespace normalization, explicit accepted alternatives, and
separate close-spelling feedback. The learner still chooses every rating. Listening uses target-language
speech playback with replay and a reveal fallback for missing or unusable voices. Both directions use
existing independent Card identities and explicit manual enabling; progressive unlocking remains deferred.

The shared learning card centers the prompt, then moves it above a drawn divider and revealed answer
inside a stable reading surface. Note participation is a status badge with separate readiness text and
equal-weight Study it again / Already know this actions. Practice completion draws its ring and counts
its percentage without delaying any control, with an immediate final result under reduced motion.
Future Study and per-Deck availability uses the actual shared eligibility boundary and localized time.

Note status, reset, move and tag changes share immediate cache projections and field/entity-local
rollback. Overlapping writes serialize per entity while unrelated writes proceed. Late autosave responses
preserve pending intent. Deck name/settings edits patch only their fields instead of broadly refetching.
Fresh Study admission remains server-confirmed. The maintained interaction contract is in architecture.md;
the bounded completion-ring motion exception is scoped in design-system.md.

Verification: the 39-check phone/desktop/WebKit interaction pass and the 9-check real-database Study
suite passed, including new directions, server confirmation, retry/Undo, reset and unchanged identity.
The default 5,000-note phone benchmark passed at 57.1 fps against the unchanged 55 fps threshold.
The six changed Study visual references were inspected. Today phone typography also differed on the
unchanged baseline implementation; hosted references are preserved separately from local Windows images.
Four Study visual checks, four Practice phone/WebKit checks, and 55 focused projection, motion,
answer-contract and eligibility tests passed. Typechecks, production web build, lint, core isolation
and design-token checks passed.

Physical-iPhone keyboard/audio acceptance and protected PR/production verification remain outstanding.
Phase 8 offline sync, Phase 9 progressive unlocking and statistics are outside this slice.

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
Phase 7 Daily Study is the current milestone. Its backend/core session foundation provides a
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

1. Re-run the gesture-heavy acceptance pass on the physical iPhone and production domain after preview delivery.
2. Complete physical-device acceptance of typed production, listening and the shared interaction contract.
3. Continue review-history presentation and accessibility work without weakening session fairness or replay.

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
  Existing notes move only through list selection; full direction/ladder controls remain intentionally
  deferred to the study-time direction and preset UX in Phase 7.
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
| 2026-08    | Use one Playwright worker                                                    | Frame-rate tests must not compete for the measured CPU                                                        |
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
