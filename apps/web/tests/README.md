# Browser tests

Playwright against the web app, with the api answered by routed fixtures (`fixtures.ts`) unless a file
says it is live. Several files are named after the pull request that introduced them rather than what
they cover, so this index is the way in. Put a new test in the file for its product area, not in a new
file named after the change.

## By product area

| Area                                         | Files                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smoke                                        | `smoke.spec.ts`                                                                                                                                              |
| Shell, navigation, dialogs, toasts, keyboard | `navigation.spec.ts`, `dialogs.spec.ts`, `toast.spec.ts`, `keyboard.spec.ts`                                                                                 |
| Today and Study setup                        | `today-setup.spec.ts`, `study-language.spec.ts`, `polish.spec.ts` (setup controls, focus halos, disclosure continuity)                                       |
| Study sittings, answers, Undo                | `study.spec.ts`, `rich-study.spec.ts` (typed, listening, directions)                                                                                         |
| Practice                                     | `practice-setup.spec.ts`, `stabilization.spec.ts` (also grammar fields)                                                                                      |
| Library, Folders, Decks, Deleted             | `collection-integrity.spec.ts`, `library-polish.spec.ts`, `recovery-regressions.spec.ts`, `refinement.spec.ts` (creation feedback)                           |
| Notes and the editor                         | `note-list.spec.ts`, `note-conversion.spec.ts`, `grammar-stabilization.spec.ts`, `iphone-ux.spec.ts` (autosave, Known, restart)                              |
| Import                                       | `import.spec.ts`                                                                                                                                             |
| Offline and sync, routed                     | `offline.spec.ts`, `offline-renames.spec.ts`, `offline-notes.spec.ts`, `offline-reviews.spec.ts`, `offline-study.spec.ts`, `sync-delivery.spec.ts`           |
| Offline and sync, live                       | `connectivity-live.spec.ts`, `offline-live.spec.ts`, `offline-review-live.spec.ts`, `offline-study-live.spec.ts`, `learning-live.spec.ts`                    |
| Motion and timing                            | `motion.spec.ts`, `acceptance-motion.spec.ts`, `interaction-lifecycle.spec.ts` (swipe frame pacing), `acceptance-latency.spec.ts`, `phase84-latency.spec.ts` |
| Frame-rate budgets                           | `performance.spec.ts`, `00-note-list-performance.spec.ts` (project `phone-performance`)                                                                      |
| Visual baselines                             | `screens.spec.ts`, `gallery.spec.ts`, `polish-visual.spec.ts` (projects `phone` and `desktop`, Windows)                                                      |

Live files need the throwaway database (`DATABASE_URL_TEST`) and an opt-in variable named at the top of
each file. They skip otherwise, and a skip is not a pass.

## Running them

```
pnpm --filter @neuron/web test:screens tests/study.spec.ts --project=phone-interaction
pnpm --filter @neuron/web test:screens:ci
```

The first form serves the dev server, which reloads as files change: do not edit source while it runs,
or the tests exercise half-written code and fail for reasons that are not in the product. The second
builds the app and runs the phone and desktop interaction projects against Vite preview, which is what
CI runs. Use it before a pull request that touches shared UI, navigation, query/cache code or
anything in `src/ui`.

A test that fails locally on unchanged `main` is not a regression of the change in hand. Check by
stashing the change and running the same test once before rewriting anything.

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
