# Browser tests

Playwright against the web app, with the api answered by routed fixtures (`fixtures.ts`) unless a file
says it is live. Several files are named after the pull request that introduced them rather than what
they cover, so this index is the way in. Put a new test in the file for its product area, not in a new
file named after the change.

## By product area

`content-quality.spec.ts` covers the read-only vocabulary inspector: four explicit checks, overlapping
counts over 6,500 mixed Notes, search/Deck filters, bounded pages, continuous typing, keyboard/editor
return, corrections leaving a category, long mobile text, complete/incomplete downloads, saved edits,
pending Notes, reconnection and a late response during account switching. It runs in both Chromium
interaction viewports and mobile WebKit. `performance.spec.ts` measures its existing 55 FPS scroll
budget at 4x CPU and reports complete-download projection separately, including Note/Card-store reads.
`apps/api/src/routes/content-quality.test.ts` checks real PostgreSQL/RLS and production-statement
EXPLAIN plans; `docs/content-quality.md` records the rule/count contract and physical-device checklist.

Recent Notes reuses `note-list.spec.ts` (Library menu, timestamp modes, locations, filters, captured
pagination, large collections and editor scroll return), `offline-notes.spec.ts` and
`offline-note-creation.spec.ts` (truthful device dates, pending work, reconnection and account/deletion
boundaries). These cases run in both Chromium interaction viewports and mobile WebKit. The 6,500-Note
case in `performance.spec.ts` retains the existing 55 FPS budget at 4x CPU. Real PostgreSQL/RLS,
Import/bulk changes and production-statement EXPLAIN checks live in
`apps/api/src/routes/recent-notes.test.ts`. Installed-iPhone steps are in `docs/recent-notes.md`.

`possible-duplicates.spec.ts` covers the read-only duplicate workspace: bounded group/member pages,
Library and Deck scopes, 6,500 Notes, long mobile content, keyboard/editor return, downloaded reads,
local changes and pending Notes, incomplete downloads, reconnection and account switching. It runs in
both Chromium interaction viewports and mobile WebKit. Initial hydration is setup, measured separately
from interaction with an already complete download.
Combined category/duplicate scenarios also check independent editor return state, shared local edit
projection, authoritative reconnection counts and clearing both browsers after an account change.
The cross-workspace journey holds search/member responses, commits the debounced search with Enter
and opens a named Note only after the selected group's loading state. This distinguishes group rows
from member rows and preserves the editor heading and return-breadcrumb assertions.

| Area                                         | Files                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke                                        | `smoke.spec.ts`                                                                                                                                                                                                 |
| Shell, navigation, dialogs, toasts, keyboard | `navigation.spec.ts`, `dialogs.spec.ts`, `toast.spec.ts`, `keyboard.spec.ts`                                                                                                                                    |
| Today and Study setup                        | `today-setup.spec.ts`, `study-language.spec.ts`, `polish.spec.ts` (setup controls, focus halos, disclosure continuity)                                                                                          |
| Study sittings, answers, Undo                | `study.spec.ts`, `rich-study.spec.ts` (typed, listening, directions)                                                                                                                                            |
| Practice                                     | `practice-setup.spec.ts`, `stabilization.spec.ts` (also grammar fields)                                                                                                                                         |
| Library, Folders, Decks, Deleted             | `collection-integrity.spec.ts`, `library-polish.spec.ts`, `recovery-regressions.spec.ts`, `refinement.spec.ts` (creation feedback)                                                                              |
| Notes and the editor                         | `note-list.spec.ts`, `note-conversion.spec.ts`, `grammar-stabilization.spec.ts`, `iphone-ux.spec.ts` (autosave, Known, restart)                                                                                 |
| Import                                       | `import.spec.ts`                                                                                                                                                                                                |
| Triage and learning waves                    | `triage.spec.ts`, `learning-waves.spec.ts` (both also WebKit), `performance.spec.ts` (tap latency at 5000), `screens.spec.ts`                                                                                   |
| Offline and sync, routed                     | `offline.spec.ts`, `offline-renames.spec.ts`, `offline-notes.spec.ts`, `offline-note-creation.spec.ts`, `offline-reviews.spec.ts`, `offline-study.spec.ts`, `offline-practice.spec.ts`, `sync-delivery.spec.ts` |
| Offline and sync, live                       | `connectivity-live.spec.ts`, `offline-live.spec.ts`, `offline-review-live.spec.ts`, `offline-study-live.spec.ts`, `learning-live.spec.ts`                                                                       |
| Motion and timing                            | `motion.spec.ts`, `acceptance-motion.spec.ts`, `interaction-lifecycle.spec.ts` (swipe frame pacing), `acceptance-latency.spec.ts`, `phase84-latency.spec.ts`                                                    |
| Frame-rate budgets                           | `performance.spec.ts`, `00-note-list-performance.spec.ts` (project `phone-performance`)                                                                                                                         |
| Visual baselines                             | `screens.spec.ts`, `gallery.spec.ts`, `polish-visual.spec.ts` (projects `phone` and `desktop`, Windows)                                                                                                         |

`interaction-lifecycle.spec.ts` fixes its own viewport at 375px. Its three glass-mode frame/input
budgets run in `phone-interaction`; desktop excludes that duplicate. Ordinary desktop motion cases
and the separate opt-in mobile WebKit coverage remain selected.

`note-list.spec.ts` also checks consecutive search editing across all Library search entry points,
mid-string selection, slow superseded responses and scroll stability with a panned keyboard viewport.
`offline-notes.spec.ts` repeats editing across downloaded results and reconnection. Keyboard geometry
is staged in browser automation; Home Screen iPhone acceptance remains separate.
`practice-setup.spec.ts` covers Space/1/2/U, focus through reveal/advance/Undo/completion, response fields,
modal cancellation, held keys, IME/modifier guards and Study follow-up isolation. Its controlled phone
probe measures typing over 5,000 Notes at 4x CPU. `acceptance-latency.spec.ts` measures repeated navigation
through Library, search, Notes and primary screens with 6,000 Notes, 60 Decks and delayed transport.

`library-polish.spec.ts` also covers collection name search, collapsed descendants, duplicate names,
full paths, keyboard focus and Back/scroll return over 2,500 collections. `offline-collections.spec.ts`
covers downloaded search, pending identities, reconnection and account boundaries. `performance.spec.ts`
measures collection search and virtual scrolling over 5,050 nested collections at 4x CPU slowdown.
Tags & Sources is covered in `note-list.spec.ts` (exact filters, long values, category pagination and
keyboard return), `offline-notes.spec.ts`, `offline-note-creation.spec.ts` and `offline.spec.ts`
(pending local work, reconnection, account changes and incomplete downloads). `performance.spec.ts`
keeps its measured category window within the existing 55 FPS budget at 4x CPU over 5,000 values.
`apps/api/src/routes/browse.test.ts` checks real PostgreSQL aggregation, account isolation, live
ancestry and production-statement EXPLAIN plans over 6,000 heavily tagged Notes across 80 Decks.

Live files need the throwaway database (`DATABASE_URL_TEST`) and an opt-in variable named at the top of
each file. They skip otherwise, and a skip is not a pass.

The [offline sync chaos harness](../../../docs/offline-sync-chaos.md) runs separately against the built
PWA and a disposable PostgreSQL database. Its dedicated config fails if the database or built shell is
missing. CI runs the Chromium regression selection. The runbook includes seeded stress and single-case
reproduction commands.

## Running them

```
pnpm --filter @neuron/web test:screens tests/study.spec.ts --project=phone-interaction
pnpm --filter @neuron/web test:screens:ci
pnpm --filter @neuron/web test:screens:ci tests/study-language.spec.ts --project=phone-interaction --grep "a confirmed language change continuously resizes expanded Study setup"
```

The first form serves the dev server, which reloads as files change: do not edit source while it runs,
or the tests exercise half-written code and fail for reasons that are not in the product. The second
builds the app and runs the phone and desktop interaction projects against Vite preview, which is what
CI runs. Use it before a pull request that touches shared UI, navigation, query/cache code or
anything in `src/ui`. An explicit `--project` replaces the helper's default pair for a focused
reproduction; file paths and quoted filters pass literally to Playwright. Omitting it still runs
both interaction viewports on one worker. A narrow reproduction does not replace the full gate
when the change affects shared browser behavior.

For a suspected pre-existing failure, compare the same test and configuration in a clean checkout of
the base revision. Preserve any unrelated local work.

## Diagnosing a failed run

Download the failed job's report before rerunning it. Keep the trace, error context and attached
measurements together: the HTML report references files under `playwright-report/data`. Artifact paths
must be distinct on case-insensitive filesystems too; use semantic scenario names rather than names
that differ only by capitalization.

- Inspect request delivery as well as the assertion. A route handler exception, missing response or
  failed document/module request can prevent the fixture from reaching the screen. Establish that
  boundary before changing a product expectation. Keep mutable fixture data inside its test; a new
  browser context does not reset module-level objects in the test worker.
- A page crash, browser disconnect or pre-application network failure is a different observation from
  a rendered UI assertion. Retain the original failing result and inspect the trace's document,
  scripts, API activity and browser logs. An unexplained crash is still a failed run; a later isolated
  pass does not establish its cause.
- For unchanged code with a diagnosed transient infrastructure failure, rerun failed jobs only
  (`gh run rerun RUN_ID --failed`). Keep successful sibling jobs and the original artifacts. A new
  source revision needs its own selected checks; do not reuse an older revision's green gate.
- After a correction, first run the exact built-app reproduction, then the relevant screen suites.
  Shared changes still require the full interaction gate. CI selection remains conservative for
  shared code and the scheduled full regression remains independent. API authentication/RLS,
  migrations, data integrity and learning correctness retain their separate checks.

Motion measurements must use the rendering phase they intend to observe and the frame clock for
animation time. A timer queued inside `requestAnimationFrame` can observe a later commit before its
resize observers, so it is not a paint fence. Keep frame samples on failure and verify a measurement
change with a deliberately broken motion control. Preserve the visual-motion assertions and the
controlled performance budgets; tracing itself can affect a frame-rate measurement (see
`docs/interaction-performance.md`).

## Writing them

- Assert what a person can see or do: roles, names, text, URLs, stored records. Not class names,
  inline styles or internal attributes, which change whenever the implementation does and turn a
  refactor into a test rewrite. Where a test must measure motion, measure the visible result (an
  element's opacity and position over frames), not how the component produces it.
- Find controls by role and accessible name (`getByRole('button', { name, exact: true })`). A
  disclosure header is a button with `aria-expanded`, so `{ expanded: false }` tells it apart from an
  action with the same name.
- Copy changes break tests that match text. Match the text when the words are the behaviour being
  tested; otherwise prefer the role.
- Act the way a person does: wait for a section to open before typing into it, and for a screen to be
  visible before measuring it.
- Keep frame-rate and visual tests on one worker. They measure the machine as much as the app.
