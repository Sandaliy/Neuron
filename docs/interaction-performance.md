# Phase 8.2 interaction stabilization

Measured on 2026-10-11 against the built PR #48 application (`b2644236`) and the stabilization
implementation. Phase 7 (`703890b`) and the accepted PR #47 continuity implementation (`e63c64d`)
provide the interaction references. Disclosure, dialog, scroll restoration, motion tokens and glass
rules were unchanged between Phase 7 and PR #48. Swipe changed only its disabled-state guards.

## Contract for later Phase 8 work

PR #49's measured zero reconciliation displacement and zero warm/background navigation snapshot scans
are constraints for later offline capabilities. Progressive data provenance must not select another
screen layout, remove established controls or reset a mounted form. Connectivity, authenticated authority
and unresolved work determine capabilities independently. Keep the normal motion/glass contracts and
the unchanged 55 FPS controlled budgets.

Phase 8.3 integrates durable content saving into the existing Note Editor. An untouched local seed never
autosaves. The editor retains its Note-ID key, form values, focus, caret and scroll through storage,
delivery and authoritative reconciliation. Note events patch one derived collection row and existing
bounded query pages; they do not trigger whole Note/Card-store scans or global collection-state updates
on each save. Local content overlays cannot become authoritative Study/Practice input. New browser
regressions observe those boundaries alongside the existing navigation, Setup, swipe and security suites.
Browser evidence for this slice does not replace its pending installed-iPhone lifecycle/keyboard/motion
acceptance. Preserve the earlier owner acceptance and the unresolved Windows WebKit drag finding below.

The Phase 8.3 built-app release run on Windows passed 520 phone/desktop interaction cases with one
worker; four opt-in database journeys and two WebKit-only touch cases were skipped by that selection.
All 66 unchanged Windows visual contracts passed. All five controlled performance cases passed with
`PERFORMANCE_ENFORCE_THRESHOLD=true` at 4× CPU slowdown. The 5,000-Note case mounted 11 rows and
measured 60.0 FPS; Panels-only, full-glass Deck and mixed collection cases each measured 60.0 FPS.
The dedicated Note suite passed all 36 Chromium/mobile WebKit cases, including zero extra Note/Card
store scans during typing and delivery settlement, preserved DOM identity/focus/caret/scroll and unchanged
reconciliation geometry. These are controlled browser measurements, not physical-iPhone timings.
The affected mobile WebKit offline suite passed all 62 cases, and the committed touch-swipe regression
passed separately. Real offline/PWA and learning journeys also passed in Chromium and mobile WebKit.

## Proven causes and repair

1. Provisional local query publication was interpreted as offline presentation. On first Deck entry,
   it removed the normal toolbar/skills and Practice card and inserted a large offline explanation.
   Reconciliation moved the search and list by **162.625px**, and the wrapped header changed position.
   The screen and first Note DOM nodes remained mounted: this was conditional layout replacement,
   not a whole-screen remount. Online presentation now stays mounted with authority-gated controls.
2. Local publication used the current query freshness timestamp. Cancelling the first request by
   leaving a Deck could retain a fresh local answer and suppress authority fetching on return.
   The new interrupted-entry regression fails on PR #48 in Chromium and mobile WebKit and passes
   after publication with `updatedAt: 0`. Returning retries without reopening the application.
3. Provisional preparation ran even behind an existing query answer. After a background revision
   pull, cached navigation reopened, cloned and validated the entire local collection although it
   could not publish it. That competing work caused measured long tasks during Today/Library and
   Study Setup interaction. A seed-eligibility check now precedes snapshot work and late publication.
4. Ordinary browsing eagerly read and validated all Cards and published an unbounded local Note
   page, then reconciled it with a 1,000-row server page. Browsing now omits unused Cards, uses bounded
   pages and yields large validation batches. Detail/Card-state reads upgrade the single projection
   through a consistent snapshot with Cards. Schema validation, ancestry and account/epoch checks remain.
5. Repeated account acceptance created new global offline snapshots even when nothing changed.
   Identical state patches now retain identity and do not notify observers. Note-list/tag derivations
   are memoized. Pagination cannot cancel the authoritative first page.
6. A complete provisional browse page could seed a direct Practice pool. Practice now rejects local
   pages as initial pool authority. Today also waits for authoritative Deck configuration before
   planning/starting Study. A separate held-pool regression verifies that provisional rows cause
   neither Practice setup readiness nor a write.

No durable schema, outbox operation identity, original payload, receipt, retry, conflict, acknowledgement
or recovery protocol changed. Server controls remain unavailable offline; existing Folder/Deck renames
still persist locally and require matching authenticated authority for delivery. Motion components,
durations, easing and glass quality were preserved.

## Matched measurements

The test-only probes in `tests/interaction-metrics.ts` observe commits, rendered function fibers,
IndexedDB scans, native animation-frame intervals and supported performance entries. Timing runs use
one browser at a time, the built app, full motion and the existing Panels-only full-glass setting.
The DOM trace recorder is disabled for these timing passes; normal interaction verification retains
its existing failure traces. Both revisions use the same fixture/probes. CPU profiling uses Chromium
at 4× slowdown. WebKit uses the iPhone 13 profile on the Windows WebKit port, without CPU throttling.

The completed-download fixture contains 5,000 Notes and 5,000 Cards in Chromium, and 1,000 of each
in WebKit. Browser-created setup rows isolate browsing from hydration/setup cost; existing real
paginated-download tests remain separate. The Notes response is deliberately held until local content
and geometry are observed. Post-release reconciliation is measured separately from that hold.
Query timestamps are aged by overriding `Date.now`; native frame scheduling remains intact.

| Observation                                   | Chromium before → after            | WebKit before → after |
| --------------------------------------------- | ---------------------------------- | --------------------- |
| First Library row                             | 541 → 366ms                        | 264 → 257ms           |
| First readable Deck Note                      | 231 → 272ms                        | 271 → 297ms           |
| Stable Deck layout from click                 | 469 → 272ms                        | 379 → 297ms           |
| Controls ready after response release         | 167 → 105ms                        | 69 → 57ms             |
| Search/list reconciliation displacement       | 162.625 → 0px                      | 162.625 → 0px         |
| Cold observation commits / rendered fibers    | 14 / 640 → 12 / 532                | 14 / 577 → 12 / 520   |
| Cold Card-store scans                         | 1 → 0                              | 1 → 0                 |
| Cold long tasks                               | 6, maximum 119ms → 3, maximum 86ms | unsupported           |
| Cold frame p95 / worst                        | 116.7 / 133.3 → 33.3 / 116.7ms     | 74 / 88 → 67 / 71ms   |
| Warm Deck content                             | 103 → 103ms                        | 145 → 117ms           |
| Background-refresh navigation + Setup commits | 17 → 14                            | 17 → 14               |
| Background-refresh Note / Card scans          | 1 / 1 → 0 / 0                      | 1 / 1 → 0 / 0         |
| Background-refresh long tasks                 | 64, 98ms → none                    | unsupported           |
| Background-refresh frame p95 / worst          | 50 / 83.4 → 16.7 / 16.7ms          | 46 / 50 → 44 / 45ms   |

The first readable Note is slightly later while the complete stable interface mounts. Stable layout
and post-response readiness arrive earlier. These are sampled local observations, not universal
latency guarantees. Overall cold Chromium layout-shift entry sum is 0.218 → 0.052; this includes normal
route arrival and user-input-associated shifts and is **not a CLS score**. The Deck reconciliation
geometry is unchanged after repair. WebKit exposes neither long-task nor layout-shift entries; an
empty entry array there is not evidence of no main-thread work.

Source-mapped Chromium self samples attribute 89 → 48ms to the IndexedDB result boundary and
65 → 39ms to Zod schema/check functions. React DOM samples remain about 89 → 86ms. This supports
the reduced cloning/validation mechanism; a sampled stack is not an exact elapsed-time partition.

Standalone motion samples remain broadly similar: Chromium disclosure and swipe p95 are about
16.7ms, warm navigation performs no snapshot scans, and security opening still samples a 55ms long
task. Windows WebKit disclosure p95 is about 60ms and security opening still has a roughly 220ms
worst frame. These port/compositor observations do not establish physical-iPhone frame pacing.
The measured fix removes competing collection work without altering those animations. After PR #49
merged, the owner separately confirmed that the application feels good on the real iPhone.

## Geometry, regressions and delivery

Browser regressions retain the original screen/Note DOM nodes through reconciliation, disabled
server actions before authority, saved Practice summary geometry, interrupted request recovery and
direct Practice authority. Existing offline tests cover in-session loss/revalidation, transport loss
despite online hints, expansion/search/scroll retention, account rejection and late validation.
The shell test emulates a 47px top inset and checks a stationary cover during scroll. Top padding
includes the inset at every breakpoint; the cover prevents content painting into it. The exact
reported physical status-bar overlap was not independently instrumented on the device; the owner
accepted the merged application without reporting a remaining interaction issue.

The Practice card reserves the progress slot while its server summary arrives, so loading and saved
runs retain the same geometry. An empty authoritative run now keeps the 4px progress slot and its
16px gap; the final saved-run composition retains its established geometry.

Main CI [run 38091549952](https://github.com/Sandaliy/Neuron/actions/runs/38091549952) failed when
Chromium crashed with `SIGSEGV` during `browser.newContext`, before the affected navigation test
exercised the product. The failed-job rerun passed, including the unchanged aggregate
**Browser and screenshot tests** gate. Its intentionally unselected Windows visuals remain skipped,
not passing evidence. No assertion, baseline, retry policy, timeout or workflow protection was weakened.

Controlled stabilization verification passed all 1,080 unit/PostgreSQL tests, all package typechecks,
repository lint/isolation/design checks, tracked-file formatting and the production build. The full
built phone/desktop interaction gate passed 486 cases with four opt-in skips; the two real-database
learning journeys passed separately. All 66 unchanged Windows visual contracts passed. Mobile WebKit
held-response reconciliation, direct Practice authority and interrupted-entry regressions passed.

The extended Windows mobile WebKit run initially finished with 151 passes and 10 fixture-delivery
failures. A controlling service worker bypassed page-level API routes; the inspected trace shows
earlier fixture responses succeeding and later account/Deck reads reaching the unavailable preview
proxy with HTTP 502. A diagnostic configuration blocks service workers for route-backed fixtures;
the explicit offline/PWA tests still allow them. With real PostgreSQL offline and learning journeys
enabled, this run finished with **160 passes and one failure** in 14.1 minutes. The remaining failure
at `stabilization.spec.ts:778` dropped a child before the destination Folder instead of inside it.
An isolated rerun passed unchanged in 2.7 seconds. Preserve the failed trace and the intermittent
drag finding; the full extended run is not green. Neither diagnostic configuration nor extra retry
policy was committed, and the protected CI gate passed independently.

All five controlled performance cases passed with the existing 55 FPS threshold enforced at 4× CPU
slowdown: 5,000 Notes at 60.0 FPS with 11 mounted rows, 500 Panels-only rows at 60.0 FPS, full-glass
Decks at 59.0 FPS and mixed collections at 59.7 FPS. Scroll throughput is separate from the cold-entry,
reconciliation and competing-background-work observations above.

PR #49 merged on 2026-10-11 at `4565b1c` after required CI, the unchanged browser/screenshot gate
and both Vercel checks passed. The owner then reported that the application feels good on the real
iPhone. This is the production acceptance for the reported interaction regressions and closes the
stabilization blocker. It is separate from browser WebKit and CPU-constrained Chromium measurements.
There is no known remaining physical-iPhone issue from this acceptance report; device frame traces
and an itemized cold/warm, motion, safe-area, lifecycle and connectivity checklist were not supplied.

## Phase 8.4 durable Study and focused refinement

Controlled measurements on 2026-10-12 compare the accepted PR #49 web source (`4565b1c`) with
Phase 8.4. The isolated baseline uses the same unchanged dependency versions and compatible
core/shared runtime. Both builds use the identical `phase84-latency.spec.ts` probe and API fixtures,
full motion, Panels-only full glass, three serial samples per browser and three warm visits per
sample. Chromium runs at 4× CPU slowdown; Windows WebKit uses the iPhone 13 profile without CPU
throttling. Failure-trace recording is disabled only for these timing runs. Ordinary verification
keeps its unchanged diagnostics. These are controlled browser timings, not device or production-network timings.

| Median observation                              | Chromium PR #49 → Phase 8.4 | Windows WebKit PR #49 → Phase 8.4 |
| ----------------------------------------------- | --------------------------- | --------------------------------- |
| Cold Today Study readiness                      | 665.2 → 696.6ms             | 278.9 → 395.5ms                   |
| Warm Library → Today readiness                  | 79.4 → 81.9ms               | 217.6 → 222.4ms                   |
| Study entry                                     | 85.3 → 90.3ms               | 122.8 → 110.3ms                   |
| Top-left exit released after grading            | 291.5 → 37.5ms              | 298 → 194ms                       |
| Study exit                                      | 78.1 → 78.7ms               | 153.4 → 144.6ms                   |
| Local Review transaction complete after grading | absent → 26.6ms             | absent → 163ms                    |

The response is held for 250ms. The old exit guard waits for acknowledgement and can remain locked
indefinitely after an interrupted request. Phase 8.4 releases it after strict local persistence,
independently of delivery. The transaction and button measurements separate local acceptance from
server acknowledgement; the remaining render delay is about one native frame in this probe.
The measured cold-readiness cost remains: the new account-scoped saved-Review check participates in
readiness. End-to-end timing does not isolate the contribution of that read from other startup work.
No broad cache rewrite or weaker persistence/admission check was introduced to reduce that number.

The observation extends through the later batched history pull. Chromium reports no delivery or
editor long tasks, frame p95 at 16.7–16.8ms, and zero layout shift in all final samples. Navigation has
one approximately 60ms task in both revisions. Editor samples retain seven commits and 448 rendered
fibers, focus and exact document geometry. Windows WebKit lacks the long-task and layout-shift
observer APIs; its direct form-geometry assertions pass, and frame observations are reported separately
from the enforced Chromium scroll contracts.

A reproducible saving-message heading movement initially recorded layout shift `0.0008401`.
Keeping the title's geometry and positioning the saving message over it removes that movement
without changing learning motion. Settled Settings history now mounts no full records by default;
Recent activity initially mounts ten rows and one selected detail. This removes the previous growing
set of full Note/rename records while retaining every receipt, version, conflict and recovery archive.
A late-confirmed recovery archive stays intact and becomes optional activity, with explicit confirmation.

The simulated 47px status-bar check scrolls Offline access underneath the existing opaque fixed
cover and passes in mobile Chromium/WebKit. No reproducible new safe-area painting defect was found;
no fixed-navigation or keyboard geometry rewrite was made. Actual installed-iPhone painting and
cold/warm responsiveness remain owner acceptance steps in `offline-study.md`.

Final built verification passes the serial phone/desktop interaction gate (560 passes, ten opt-in
selection skips), all 77 targeted mobile WebKit Note/Study cases and both worker-enabled real
PostgreSQL Review journeys. All 66 unchanged Windows visual contracts pass. All five controlled
performance cases pass with the original 55 FPS threshold enforced at 4× CPU: 5,000 Notes at
60.0 FPS with 11 mounted rows, 500 Panels-only rows at 60.0 FPS, full-glass Decks at 59.3 FPS and
mixed collections at 59.0 FPS. The worst frames are 16.8ms for Notes/Panels and 33.4/33.3ms for
the two shared-glass cases. No baseline, assertion, retry policy or performance threshold was weakened.

## Phase 8.4 production stabilization after PR #51

Physical-iPhone acceptance rejected merged PR #51 (`b8dae4d`). The release blocker stays open until
the updated installed PWA passes the owner checklist in `offline-study.md`.

The built reproduction suspends account validation, then loses connectivity while an intact download
exists. The session gate waits indefinitely because remembered-account restoration depends on that
fetch rejecting. Known offline startup now reads the remembered account directly; loss events restore
it independently when the gate lacks account data. A live cached account does not cancel its own
validation, preserving normal query completion and avoiding an additional navigation-time probe.
Cached identity never grants delivery authority. Account/connection epochs, session rejection and
explicit sign-out still protect reconnection and account isolation.

The actual PR #50 shell and v2 collection upgrade pass against the final worker/build. A separate
populated v2 cold-offline test compares every prior store key/value, metadata/cursor and pending
Note/name operation before and after upgrade; an aborted upgrade preserves v2 until explicit Retry.
No migration rewrite, storage reset, protocol rollback or service-worker activation change was needed.
The owner's precise physical network/foreground event sequence remains unobserved.

Offline readiness and saved work share one Settings surface. Completed history is optional and
bounded; active recovery remains available. Grammar and nested saved-work disclosures reserve their
complete space before revealing content and settle to natural height. Study setup retains measured
endpoints for animated configuration changes. Grammar controls remain mounted; German boolean
controls align with adjacent native fields. The existing Radix panel entrance uses the shared 240ms
curve after its first ready frame, and dialog viewport offset follows an actual keyboard rather than
ordinary viewport panning. Recovery-code dismissal safeguards and focus management remain intact.

The exact CI evidence separates these failures:

| Run                                                                              | Proven failure stage                                                                 | Stabilization response                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [PR #50, attempt 1](https://github.com/Sandaliy/Neuron/actions/runs/38156972928) | Desktop Chromium `browser.newContext`, before navigation/page execution              | Investigate worker/context lifecycle; preserve native crash evidence                   |
| [PR #51, attempt 1](https://github.com/Sandaliy/Neuron/actions/runs/38177074574) | Phone Chromium at the same stage and native fault offsets; aggregate correctly fails | Same classification, with no aggregate-gate relaxation                                 |
| [Post-merge main](https://github.com/Sandaliy/Neuron/actions/runs/38180934248)   | Fourth Review absent from recorded HTTP despite local sitting advancement            | Assert committed local intents separately from HTTP delivery and synchronized receipts |

The crashes share headless-shell revision 1234, `SEGV_MAPERR 0000000001b0` and relative fault offsets
including `0x6b59199`, `0x6b20a28` and `0x69786d1`. Installed Playwright 1.62.1 reproduces a worker
protocol-session leak: 20 closed worker-enabled contexts leave 21 sessions instead of the original
one; blocked workers leave one. This matches [upstream issue 43009](https://github.com/microsoft/playwright/issues/43009),
but does not conclusively establish the native SIGSEGV cause. Routed interaction fixtures now block
incidental workers; real-PWA journeys and existing visual shell-readiness coverage explicitly allow
them. Repeated offline diagnostics include deliberate fixture failures and worker/route interference;
they are not proof of production collection loss, and diagnostics remain enabled.

Final local verification passes 1,096 unit/PostgreSQL/RLS tests (99 files), all package typechecks,
tracked-source lint/formatting, core/design checks and builds. The complete built serial phone/desktop
gate passes 570 cases with ten existing opt-in skips (11.6 minutes). The 36 focused Chromium
phone/desktop and mobile WebKit cases pass, including intermediate disclosure/dialog frames,
Grammar retention, original language-resize assertions, populated upgrade and interrupted recovery.
Eight worker-enabled browser/database journeys pass (5.8 minutes), including the actual prior shell
update and real Note/name/Review/Undo delivery. All 31 browser selection/aggregate tests pass.
All 66 unchanged Windows visual baselines pass. Initial iteration failures in measured Study resize,
the Grammar screenshot identifier and account-query cancellation were fixed at their sources.
The visual worker override restores the original readiness state instead of refreshing baselines.

All five original performance cases pass with 55 FPS enforced at 4× CPU: 5,000 Notes at 60.0 FPS
with 11 mounted rows, 500 Panels-only rows at 59.7 FPS, full-glass Decks at 59.0 FPS and mixed
collections at 59.3 FPS. Worst frames are 16.8ms, 33.3ms, 33.3ms and 33.4ms respectively.
Full-gate security opening records zero layout shift and 53–55ms long tasks, comparable with the
earlier 55ms observation; this does not establish physical-iPhone compositor behavior.

Three matched samples per browser compare archived PR #51 source and the repaired build using the
same dependencies, fixture ownership, full motion and probe. Chromium is throttled 4×; Windows
WebKit is unthrottled. Tracing is disabled only for these timing samples, not ordinary verification.

| Median observation              | Chromium PR #51 → repair | Windows WebKit PR #51 → repair |
| ------------------------------- | ------------------------ | ------------------------------ |
| Cold Today readiness            | 839.4 → 831.8ms          | 402.7 → 388.8ms                |
| Warm Library → Today            | 88.9 → 86.6ms            | 230.2 → 228.8ms                |
| Study entry                     | 95.2 → 95.6ms            | 124.1 → 124.3ms                |
| Local Review commit             | 31.7 → 32.7ms            | 157 → 153ms                    |
| DOM-observed exit guard release | 41.1 → 42.2ms            | 189 → 185ms                    |
| Study exit                      | 85.0 → 86.2ms            | 146.4 → 180.1ms                |

Chromium records zero layout shift in every sampled stage, no delivery/editor long tasks and one
72–74ms navigation task in both revisions. Editor commits remain seven; rendered fibers increase
448 → 462 because closed Grammar controls stay mounted. Delivery/editor worst frames remain about
16.8ms. WebKit exposes neither long-task nor layout-shift observers; empty arrays do not establish
absence. Direct focus/form geometry assertions pass. Its Study-exit sample is 34ms slower, with
navigation frames up to 63ms in the repaired samples. This measured port/pacing difference remains
explicit rather than being declared a device improvement. Installed-iPhone keyboard geometry,
frame pacing and exact network/foreground behavior require owner acceptance.

No assertion, retry policy, required check identity, coverage, timeout, performance threshold or visual
baseline was relaxed. Hosted PR checks and production/device acceptance are separate from these
local results; Phase 8.5 remains deferred.
