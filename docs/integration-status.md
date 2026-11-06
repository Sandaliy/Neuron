# Integration status

Integration pass: 2026-11-06. The protected ruleset requires an up-to-date branch, squash merging,
Secret scan, Typecheck/lint/test/build, Browser and screenshot tests, and both Vercel projects.
It requires no approving GitHub review. The separate critical and visual acceptance gates below
remain binding even when hosted checks pass. Auto-merge is disabled for held work.

## Release ledger

| PR                                                | State and next action                                                                                           | Merge / verification                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#82](https://github.com/Sandaliy/Neuron/pull/82) | Merged: README, synthetic mobile gallery and simulation presentation.                                           | `e5a458d`; all five required checks passed on refreshed head `fd28453`.                                                                                                                                                |
| [#90](https://github.com/Sandaliy/Neuron/pull/90) | Merged: explicit-account, read-only Database Integrity Doctor.                                                  | `66437fe`; all five required checks passed on refreshed head `7cca368`.                                                                                                                                                |
| [#85](https://github.com/Sandaliy/Neuron/pull/85) | Merged after refresh against #82 and #90.                                                                       | `0687ec3`; all five required checks passed on refreshed head `0fca2e7`. Current audit retains 1 critical, 3 high, 1 moderate and 3 low findings, as documented.                                                        |
| [#71](https://github.com/Sandaliy/Neuron/pull/71) | Unmerged for critical security/data-integrity review. Conflicts and diagnosed CI failures repaired.             | Account-export allowlists, RLS/read-only snapshot, late authorization, purge redaction and completion validation need integration-owner sign-off. Hosted streaming and installed-iPhone Files/Share remain unverified. |
| [#74](https://github.com/Sandaliy/Neuron/pull/74) | Unmerged for critical security/data-integrity review. Search/Import conflicts resolved preserving both changes. | Review atomic bulk writes, bounded revisions, immutable source/IDs, header concurrency and recovery after lost acknowledgements. Physical termination/eviction/near-limit memory acceptance remains open.              |
| [#86](https://github.com/Sandaliy/Neuron/pull/86) | Draft, unmerged; critical learning-correctness review required.                                                 | Resolve the suspend/resume/Undo concern below. Keep the draft state until its owner completes review.                                                                                                                  |
| [#87](https://github.com/Sandaliy/Neuron/pull/87) | Unmerged; critical learning review and #86 integration required before combined validation.                     | Resolve equal-time recovery evidence below; refresh Library visual references and verify combined behavior after #86.                                                                                                  |
| [#89](https://github.com/Sandaliy/Neuron/pull/89) | Unmerged for owner visual acceptance.                                                                           | Refresh against the shared menu repair and require green checks; screenshots and browser emulation do not replace owner acceptance.                                                                                    |

Both production projects for #82 and #90 reported successful deployments at their exact merge SHAs.
Their trusted production-migration workflows passed. The web root, API `/health` with compatible
schema, and `/db-check` returned 200 after each integration; API requests ran in `fra1`.
The Vercel connector lacked team access, so deployment evidence came from GitHub deployment/status
records and direct public health requests. No production account was inspected with the Doctor.

## CI diagnosis and repairs

- #71's original [run](https://github.com/Sandaliy/Neuron/actions/runs/41348530867) failed four phone
  dialog screenshots and the Study-language resize measurement. The new export section changes the
  background visible behind Settings dialogs. The four replacement references exactly match hosted
  actual images and were inspected. The motion sampler now records final observed geometry per
  rendering opportunity, retains unchanged frames and includes a delayed zero-duration control that
  must reject a real jump. Main's endpoint and monotonicity assertions are retained. Application
  motion, tolerances and retries are unchanged. Six focused Chromium/WebKit cases passed before the
  main refresh; the refreshed hosted Windows visual job passed.
- #87's [run](https://github.com/Sandaliy/Neuron/actions/runs/42025023781) and #89's
  [run](https://github.com/Sandaliy/Neuron/actions/runs/42121229252) fail the same Library Delete click.
  Logs and retained traces show the menu extending outside the viewport after an additional Library
  entry. This is an application regression exposed by platform font/layout differences, not a reason
  to force clicks or relax the tests. A 375-by-560 regression fails on unchanged main with menu top
  `-189`; constraining the shared menu to Radix's available height with internal scrolling fixes it.
  All 16 focused recovery/toast cases pass, including keyboard access and a real pointer click on the
  final action. Full combined dependency/menu verification is required before delivery.
- #86's index-migration fingerprint previously stripped every JSON null recursively. It now excludes
  only the two explicitly introduced Card metadata columns, preserving every older column and nested
  JSON null. The migration-tip lookup remains compatible with migration 0020. Hosted PostgreSQL 17
  release verification remains required. All five focused index-migration safety cases also passed
  locally against disposable PostgreSQL 17. No migration or learning behavior was changed by this repair.
- Assertions, screenshot tolerances and retry counts were not reduced. Optional live/browser/device
  checks that were not executed remain unverified. An exploratory full browser run before dependency
  integration was intentionally stopped; it is not passing evidence.

## Critical review handoff

1. **#86: suspend, resume, then Undo can retract a used direction.**
   `progression.ts:193` considers a new direction untouched when its current `suspendedAt` is null,
   it has no Reviews and no reset. `cards.ts:522` clears `suspendedAt` on resume without clearing the
   opening-answer provenance. Reproduction: a qualifying Recognition answer opens Recall; suspend
   Recall, resume it, then Undo that Recognition answer while it no longer meets the threshold.
   A disposable PostgreSQL 17 real-route regression reproduced the deletion: expected Recall to
   remain; received only Recognition. The regression patch and failed-run evidence are retained for
   review. The persistent provenance policy and regression must be resolved by the critical reviewer.

   Reproduce inside `progressive-directions.test.ts`, using its existing helpers:

   ```ts
   const { note, card } = await word(10);
   const reviewId = uuidV7();
   await answer(card.id, 'good', reviewId);
   const recall = (await repositories.cards.forNote(note.id)).find(
     (row) => row.direction === 'recall',
   )!;
   await post(`cards/${recall.id}/suspend`, {});
   await post(`cards/${recall.id}/unsuspend`, {});
   await post('reviews/undo', { id: uuidV7(), reviewId });
   expect(await directions(note.id)).toContain('recall');
   ```

2. **#87: recovery evidence loses equal-time answers.**
   `problem-cards.ts:134` counts only `reviewed_at > last_again_at`, while the same query orders
   history using time, revision and identity. Reproduction: a qualifying history ends with Again
   followed by three Good events at that same timestamp with later canonical ordering. The shared
   sequence counter reports three successes; SQL reports zero. A disposable PostgreSQL 17 real-route
   regression reproduced `sinceLastAgain: 0` where three was expected. Its patch and failed-run evidence
   are retained for review. Confirm the canonical tie-breaker and align the description. Membership thresholds
   and scheduling must stay unchanged.

   Reproduce inside `problem-cards.test.ts`, using its existing helpers:

   ```ts
   const { recognition } = await vocab('same-time recovery');
   const sameTime = clock + DAY;
   await answer(recognition.id, [A, A, A, A, G, G, G], () => sameTime);
   const item = (await page()).items.find((entry) => entry.card.id === recognition.id);
   expect(item?.evidence).toMatchObject({ kind: 'history', sinceLastAgain: 3 });
   ```

3. **#71 after #86:** its schema-coverage test requires an explicit export decision for
   `unlock_reason` and `unlocked_by_review_id`. Whichever branch merges second must cover the new
   provenance deliberately; do not bypass the guard or assume the independent green runs compose.
4. **#74 after #86:** the bulk Import Card insert currently predates opening-direction provenance.
   Review metadata parity with ordinary Note creation and repeat exact retry/Undo/revision tests on
   the combined tree. The existing fill-blank merge retry limitation remains documented in
   `import-performance.md`; no new immutable merge receipt is claimed.

Integrate #86 only after critical review and its owner ends Draft. Then refresh #87 and validate
progression, suspension/resume, Undo, restart/reset and Slipping Cards together. Keep #71/#74 behind
their independent critical security/data-integrity gate. Offline Sync Chaos Testing has not started
and must wait until this pass completes or the remaining work is explicitly held on critical review.
