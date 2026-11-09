# Integration status

Integration pass: 2026-11-09. The protected ruleset requires an up-to-date branch, squash merging,
Secret scan, Typecheck/lint/test/build, Browser and screenshot tests, and both Vercel projects.
It requires no approving GitHub review. The separate critical and visual acceptance gates below
remain binding even when hosted checks pass. Auto-merge is disabled for held work. Every squash merge
uses its own subject and body, never the default message (see the authorship note below).

## Release ledger

| PR                                                | State and next action                                                                                   | Merge / verification                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#82](https://github.com/Sandaliy/Neuron/pull/82) | Merged: README, synthetic mobile gallery and simulation presentation.                                   | `e5a458d`; all five required checks passed on refreshed head `fd28453`.                                                                                         |
| [#90](https://github.com/Sandaliy/Neuron/pull/90) | Merged: explicit-account, read-only Database Integrity Doctor.                                          | `66437fe`; all five required checks passed on refreshed head `7cca368`.                                                                                         |
| [#85](https://github.com/Sandaliy/Neuron/pull/85) | Merged after refresh against #82 and #90.                                                               | `0687ec3`; all five required checks passed on refreshed head `0fca2e7`. Current audit retains 1 critical, 3 high, 1 moderate and 3 low findings, as documented. |
| [#71](https://github.com/Sandaliy/Neuron/pull/71) | Merged: account export with direction provenance.                                                       | `ca3b63d`; all required checks passed on `69d6db6`; 1,478 local tests passed against PostgreSQL. Installed-iPhone Files/Share remains open.                     |
| [#74](https://github.com/Sandaliy/Neuron/pull/74) | Merged: bulk Import writes, exact retries, bounded Undo revisions.                                      | `fc49ad4`; all required checks passed on `57ab328`; 1,491 local tests passed against PostgreSQL. Physical termination/eviction/near-limit memory remains open.  |
| [#86](https://github.com/Sandaliy/Neuron/pull/86) | Merged with migration 0020.                                                                             | `dd18a02`; all five required checks passed on `a76b2c7`. Installed-iPhone acceptance is open.                                                                   |
| [#87](https://github.com/Sandaliy/Neuron/pull/87) | Merged: Slipping Cards with replay-order recovery.                                                      | `e2a81b7`; the combined candidate passed 41 tests and 12 built browser cases. Installed-iPhone acceptance is open.                                              |
| [#94](https://github.com/Sandaliy/Neuron/pull/94) | Merged: session recovery and per-tab account binding.                                                   | `46d7908`; all five required checks passed.                                                                                                                     |
| [#95](https://github.com/Sandaliy/Neuron/pull/95) | Merged: required CI within five minutes.                                                                | `c04004f`; full run 4 min 33 s with the same 474 phone and 471 desktop browser tests.                                                                           |
| [#89](https://github.com/Sandaliy/Neuron/pull/89) | Owner accepted the shown visuals on 2026-11-06; integrate after fresh required checks against #92 main. | Required checks passed on earlier refreshed head `dcfb711`; installed-iPhone acceptance remains open.                                                           |
| [#91](https://github.com/Sandaliy/Neuron/pull/91) | Merged: shared menu viewport repair and integration handoff.                                            | `ba23f21`; all required checks passed on `f42b166`; resulting main CI and production migrations passed.                                                         |
| [#92](https://github.com/Sandaliy/Neuron/pull/92) | Merged: bounded cold-statistics integrity query plans.                                                  | `fa196fc`; all five required checks passed on `855db2c` in run `42285525318`; 59 local PostgreSQL Doctor/safety cases passed.                                   |

Both production projects for #82, #90, #85, #91, #71, #95 and #74 reported successful deployments at their exact merge SHAs.
Their trusted production-migration workflows passed. The web root, API `/health` with compatible
schema, and `/db-check` returned 200 after each integration; API requests ran in `fra1`.
Main CI passed for #90, #85 and #91; #82's superseded run is covered by those later integrated runs.
#86 and #87 were first merged as `2f11bd3` and `b0fb141` with GitHub's default squash message, which
copied co-author lines from the branch commits. On 2026-11-09, with the owner's approval, the
ruleset was paused for one force push that replaced them with `dd18a02` and `e2a81b7`: same trees,
author and dates, without those lines. The ruleset was restored unchanged and production redeployed
the identical tree with health checks at 200.
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

## Critical review outcome

1. **#86: suspension history and migration 0020.** Undo no longer retracts a direction after suspend
   and resume; the suspension flag and original Review ID are kept. The migration refuses a busy Card
   table and validates its checks in a bounded statement.
2. **#87: equal-time recovery.** Recovery counts answers after the last Again by timestamp, revision
   and Review ID, the canonical replay order, before and after Undo.
3. **#71 after #86:** the schema-coverage test now exports `unlock_reason`, `unlocked_by_review_id` and
   the suspension flag deliberately. Cancellation is exercised at the streaming route.
4. **#74 after #86:** bulk Import Cards record `unlocked_at` and `unlock_reason = 'opening'` with the
   same scheduling defaults as single-Note creation. Exact retries leave the account revision alone, and
   a fill-blank merge commits its receipt with the edit.

The offline sync chaos [integration cases](offline-sync-chaos.md#held-branches) now run against the
combined main.
