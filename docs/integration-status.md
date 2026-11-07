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
| [#86](https://github.com/Sandaliy/Neuron/pull/86) | Merged with migration 0020.                                                                                     | `2f11bd3`; all five required checks passed on `a76b2c7`. Installed-iPhone acceptance is open.                                                                                                                          |
| [#87](https://github.com/Sandaliy/Neuron/pull/87) | Critical review complete on the combined Progressive Directions tree.                                           | Equal-time recovery follows replay order. The combined candidate passed 41 tests and 12 built browser cases.                                                                                                           |
| [#89](https://github.com/Sandaliy/Neuron/pull/89) | Owner accepted the shown visuals on 2026-11-06; integrate after fresh required checks against #92 main.         | Required checks passed on earlier refreshed head `dcfb711`; installed-iPhone acceptance remains open.                                                                                                                  |
| [#91](https://github.com/Sandaliy/Neuron/pull/91) | Merged: shared menu viewport repair and integration handoff.                                                    | `ba23f21`; all required checks passed on `f42b166`; resulting main CI and production migrations passed.                                                                                                                |
| [#92](https://github.com/Sandaliy/Neuron/pull/92) | Merged: bounded cold-statistics integrity query plans.                                                          | `fa196fc`; all five required checks passed on `855db2c` in run `42285525318`; 59 local PostgreSQL Doctor/safety cases passed.                                                                                          |

Both production projects for #82, #90, #85 and #91 reported successful deployments at their exact merge SHAs.
Their trusted production-migration workflows passed. The web root, API `/health` with compatible
schema, and `/db-check` returned 200 after each integration; API requests ran in `fra1`.
Main CI passed for #90, #85 and #91; #82's superseded run is covered by those later integrated runs.
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
  final action. The full built-app CI-equivalent gate passed 875 cases with 20 optional live cases
  skipped on the combined dependency/menu tree; the new menu regression also passed mobile WebKit.
  Resulting main [CI](https://github.com/Sandaliy/Neuron/actions/runs/42280527137) passed.
- The next refreshed #71/#74/#87 runs exposed a shared Doctor scale failure: its deep audit exhausted
  the unchanged per-statement budget. PostgreSQL 17 plans for a newly populated account absent from
  statistics selected quadratic Card/Note, Card/Deck and Review/Card nested loops. The old parent
  query examined 27,063,011 tuples in a controlled regression. Materializing account-scoped full joins
  preserves hash/merge eligibility before applying violation filters. The regression caps examined
  tuples for all four affected checks, including the shared live/deleted Note check.
  Existing elapsed-time limits remain enforced. Safe failure diagnostics retain phase, code and metrics.
  The protected repair is [#92](https://github.com/Sandaliy/Neuron/pull/92); refresh held branches from
  its resulting main before treating their required checks as current.
- #87's eight Library references now show the intended entry, with explicit semantic assertions.
  All eight comparisons passed. Twelve focused Chromium/mobile-WebKit cases passed; the keyboard
  suspend driver now explicitly focuses its target instead of relying on pointer focus behavior.
  #89's content-quality and recovery checks passed 34 focused browser cases. #71's six motion cases
  and #86's two direction-editor cases also passed after the final menu/dependency refresh.
- #86's index-migration fingerprint previously stripped every JSON null recursively. It now excludes
  only the two explicitly introduced Card metadata columns, preserving every older column and nested
  JSON null. The migration-tip lookup remains compatible with migration 0020. Hosted PostgreSQL 17
  release verification remains required. All five focused index-migration safety cases also passed
  locally against disposable PostgreSQL 17. No migration or learning behavior was changed by this repair.
- Assertions, screenshot tolerances and retry counts were not reduced. Optional live/browser/device
  checks that were not executed remain unverified. An exploratory full browser run before dependency
  integration was intentionally stopped; it is not passing evidence.

## Critical review handoff

1. **#86: suspension history and migration 0020.**
   Undo previously retracted a direction after suspend and resume. The server now retains the
   suspension flag independently of current state and preserves the original Review ID. The
   regression exercises both Card routes and Sync against PostgreSQL 17. The migration refuses a
   busy Card table, validates its checks in a bounded statement and leaves old data and RLS intact.

2. **#87: equal-time recovery evidence.**
   Recovery counts answers after the last Again by timestamp, revision and Review ID, the same
   order as canonical replay. A PostgreSQL regression submits reverse-ordered IDs at one timestamp
   and checks recovery before and after Undo. Membership and scheduling rules remain unchanged.

3. **#71 after #86:** its schema-coverage test requires an explicit export decision for
   `unlock_reason` and `unlocked_by_review_id`. Whichever branch merges second must cover the new
   provenance deliberately; do not bypass the guard or assume the independent green runs compose.
4. **#74 after #86:** the bulk Import Card insert currently predates opening-direction provenance.
   Review metadata parity with ordinary Note creation and repeat exact retry/Undo/revision tests on
   the combined tree. The existing fill-blank merge retry limitation remains documented in
   `import-performance.md`; no new immutable merge receipt is claimed.

Keep #71 and #74 behind
their independent critical security/data-integrity gate. The offline sync chaos harness starts from
protected main while these branches remain under critical review. The [future integration
cases](offline-sync-chaos.md#held-branches) apply after their respective reviews.
