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

## Phase 8.4 lifecycle follow-up after PR #52

PR #52 merged at `f37c236` with required checks passing. The owner again rejected installed-iPhone
acceptance. Its two-minute cold loading and roughly thirty-second live handover were owner observations,
not instrumented browser measurements. Phase 8.5 remains blocked.

### Causal findings

- PR #52 restores a remembered account only after a negative connectivity hint or network rejection.
  With `navigator.onLine=true` and suspended HTTP, a complete account-scoped database and cached shell
  cannot open the gate. The same populated-v2, worker-enabled test fails on the archived build and passes
  with independent local restoration. Local identity does not validate a server session.
- Every repeated offline event advanced the connectivity generation used to reject local restoration.
  A continuing event stream delayed the old fixture to 3,444ms. Local restoration now belongs to the
  account visit and is shared across events. Fresh loss still invalidates a reconnect response.
- A repeated foreground event with a false offline hint could invalidate the successful validation
  started by the preceding event. A delayed response plus eight focus/visibility pairs reproduces the
  stuck local state. Foreground now joins validation without treating a stale hint as another loss.
- Fresh query caches can supply navigation without any data GET. The old build performs no independent
  liveness check on that path and misses the outage for the test's entire five-second observation.
  Navigation now requests one coalesced, non-blocking account validation. Stalled HTTP, including
  delivery and sync, requests validation after 1.5 seconds; validation ends after two seconds without a
  response. A timer never retries a mutation or acknowledges an intent. Foreground events validate even
  when the browser hint is false. Ordinary same-account navigation does not start a pull or Review scan.
- `ReadOnlySlot` deliberately removed server controls while retaining measured dimensions. This directly
  explains the empty Practice area and the different geometry of a fresh offline visit. Recognizable
  disabled controls and a connection explanation now occupy that region on handover and re-entry.
- `reveal="settled"` hid all content until height expansion finished, then started another fade. The repair
  reveals complete labels/controls during expansion, retains mounted Grammar inputs and natural settled
  height, and leaves the default Study setup disclosure unchanged.
- Swipe movement read `clientWidth` and updated React offset/armed state on every pointer move. The
  archived builds commit approximately sixty times per sixty driver moves and 175 times during the
  sustained frame-driven gesture. Width is now captured on pointer-down; transient movement and arming
  update the existing surface directly. Thresholds, vertical-scroll arbitration, confirmation and rollback
  still use the original interaction paths.

These are reproduced code/browser causes. The owner's exact native startup event order and reported
10 FPS compositor behavior have not been reproduced conclusively. The swipe code itself was unchanged
between accepted PR #49 and PR #52, so its cost is not proof of the reported regression's native cause.

### User-visible and interaction measurements

Archived PR #49 (`4565b1c`), PR #52 and the repair use the same installed dependencies, fixture data,
375px viewport, full motion and Max glass with Panels and cards. Chromium runs at 4x CPU slowdown;
Windows mobile WebKit is unthrottled. Three independent runs supply each navigation/Grammar median.
Timing probes disable tracing; ordinary interaction and lifecycle failure diagnostics retain it.

| Chromium observation                                             |   PR #49 |   PR #52 |   Repair |
| ---------------------------------------------------------------- | -------: | -------: | -------: |
| Cold online Library readiness                                    |  652.7ms |  636.2ms |  637.5ms |
| Warm Settings to Library                                         |   80.7ms |   74.4ms |   80.2ms |
| Grammar first complete visible content                           |   33.5ms |  266.2ms |   79.6ms |
| Grammar expanded geometry                                        |   33.5ms |  245.6ms |  244.9ms |
| Trusted swipe median input to next-frame observation, full glass |   14.3ms |   14.3ms |   16.0ms |
| Trusted swipe p95 input observation, full glass                  |   16.5ms |   16.5ms |   17.5ms |
| Sustained swipe frame rate, full glass                           | 60.0 FPS | 60.0 FPS | 60.0 FPS |
| Sustained swipe React commits                                    |      175 |      175 |        0 |

PR #49 conditionally mounted Grammar without the later container expansion; its geometry timing is not
an equivalent expansion animation. Input observation is measured inside the browser from trusted event
arrival to the following animation-frame sample. It excludes driver round trips and is not native touch
latency. A separate 180-frame injected touch path supplies movement on every paint frame, avoiding idle
frames between driver commands. Panels-only and glass-off cases also retain the original 55 FPS floor;
the tests assert that chosen glass remains active. No global effect or visual quality was reduced.

| Built-PWA/local observation                                         |             Archived PR #52 |        Repair |
| ------------------------------------------------------------------- | --------------------------: | ------------: |
| Complete v2 cold launch, online hint, HTTP never answers            |   not usable within 5,000ms |         185ms |
| Complete v2 cold launch, offline hint, origin stopped               |              not remeasured |         173ms |
| Complete v2 cold launch, offline hint, suspended HTTP               |              not remeasured |         185ms |
| Local restoration during continuing offline/focus/visibility events |                     3,444ms |     388–405ms |
| Cached navigation with no loss/foreground event and stalled HTTP    |    not local within 5,000ms | 2,402–2,426ms |
| Foreground handover with no pending account request                 |              not remeasured |       2,416ms |
| Suspended Review POST, no loss event or pending account request     | still enabled after 5,000ms | 4,182–4,216ms |

Cold timing ends when the downloaded Folder is visibly usable, rather than when an internal fetch ends.
Interrupted migration timing includes explicit recovery and is a separate correctness case.
Handover observations end at a visible disabled/unavailable control or offline presentation; assertion
polling includes observation overhead. Review handover includes answering and local persistence.
Final worker-enabled runs use an explicit phone viewport, touch, mobile layout and 3x pixel density,
without CPU emulation. Windows WebKit observes 416–440ms for the same three complete-v2 cold cases.
The deliberately interrupted upgrade plus explicit Retry takes 2,550ms in Chromium and 2,840ms in
WebKit; it preserves the old database before recovery. These remain browser timings.

Windows WebKit medians for PR #49 / PR #52 / repair are 232.0 / 226.7 / 234.5ms cold readiness and
488.5 / 489.2 / 497.4ms warm navigation. Grammar first content changes from 22 / 290 / 104ms; repaired
expansion settles at 246ms. Its full-glass disclosure samples are 48.9 / 32.1 / 43.7 FPS, with worst
frames 45 / 45 / 46ms. This port remains below 55 FPS in that motion probe. Chromium's enforced
55 FPS contracts and native installed-iPhone acceptance are distinct; these WebKit results are retained
as a limitation, not described as a passing device performance result.

The settled gesture fixture answers Practice successfully, waits for fonts and verifies that the
gesture point actually hits an on-screen row. Earlier probes could miss trusted input when the row
was outside the viewport or a late error moved it; those idle-frame samples are excluded. With this
fixture, Windows WebKit's sustained swipe rates for PR #49 and the repair are:

| Glass configuration   |   PR #49 |   Repair |
| --------------------- | -------: | -------: |
| Max, Panels and cards |  9.8 FPS |  9.8 FPS |
| Max, Panels only      | 17.4 FPS | 21.1 FPS |
| Glass off             | 22.5 FPS | 25.3 FPS |

Full-glass trusted input observation is 105ms median / 108ms p95 on PR #49 and 102ms / 111ms on
the repair. Sustained movement observes no store-wide IndexedDB `getAll` reads in either revision and reduces 175 React
commits to zero. Direct surface transforms, a fixed background action plane and unchanged state
attributes avoid per-frame inherited style invalidation and action-width layout. An initial isolated
`will-change: transform` probe did not improve Windows WebKit full-glass pacing. The remaining
rendering cost is strongly dependent on glass configuration in this Windows port, including the
accepted baseline. This reproduces a low frame rate in the port, not the owner's native regression or
its cause. It remains below the target and is an explicit unresolved performance risk; no effects,
quality, original 55 FPS Chromium assertion or retry policy were reduced to conceal it.
The final swipe comparison uses identical trace-disabled runners on all revisions. Chromium's
next-frame observation stays around one frame; these samples establish no input-latency improvement.
Traced release runs observe a different input/frame phase (roughly 8–11ms) and are not substituted
for the matched comparison. Removing React work is measurable; native responsiveness remains unproven.

### Verification evidence and limits

The final built, serial phone/desktop gate passes 594 cases with ten existing opt-in skips. All five
original controlled performance cases pass with 55 FPS enforced: 5,000 Notes at 60.0 FPS with eleven
mounted rows, Panels-only collections at 59.7 FPS, and full-glass Deck/mixed collections at 59.3 FPS.
The 31 browser-selection/aggregate contract tests pass. All 66 Windows visual comparisons pass after
reviewing and updating eight intentional Settings references and two phone-dialog references whose
Settings backdrop moved; dialog geometry is unchanged. No unrelated baseline was refreshed.

Sixteen explicit phone-context journeys pass on Chromium and WebKit, including complete-v2 startup
with a stopped origin or suspended HTTP under either hint, interrupted upgrade/recovery, the actual
prior PR #50 worker shell's first upgraded launch with the origin already stopped, real PostgreSQL/RLS
collection hydration and Note/name conflicts/retries, and admitted Study/Undo with a lost real database
acknowledgement and exact replay. API responses remain excluded from the worker cache. These tests
use touch, mobile layout, phone viewports and 3x pixel density; they do not install a native iPhone PWA.

The broader WebKit run passes 122 of 123 cases; its obsolete assertion that offline controls disappear
was corrected to require visible disabled controls. That case, repeated foreground validation, failed
entry-script diagnostics and swipe release/reversal/cancel/rollback then pass in six focused cases.
Six gesture/frame cases pass across Chromium/WebKit with glass selection retained; WebKit frame-rate
observations above remain below target and are not described as passing performance evidence.
Archived PR #52 fails the final cold-start, suspended-Review and gesture-work reproductions as expected;
earlier archived comparisons also fail continuing-event restoration and cached-navigation handover.

The full unit/database run records 1,094 passes and two skipped cases after a Review-suite setup
WebSocket close, with 98 of 99 files passing. Its isolated nine-case Review suite subsequently passes;
the full run is not relabelled as a single clean pass. An earlier broad browser run similarly records
one pre-application `ERR_NO_BUFFER_SPACE`. Available memory/port counts did not show exhaustion, and a
bare-browser control completed 200 contexts / 6,600 requests without reproducing it. The original
failure remains unexplained runner evidence. The earlier full browser run followed additional lifecycle
and gesture corrections and passed; retries, timeouts and assertions were not relaxed for either issue.
Hosted required checks and physical acceptance remain separate from all local results.

PR #53's first hosted run (`38744365152`) exposed two further defects. The phone handover assertion
observed scroll moving from 500 to 522px. The longer unavailable Practice label wrapped onto a second
line, increasing the card height by 22.5px and triggering scroll anchoring. The same exact failure is
reproducible locally at 320px. Both action labels now determine the button's natural height, with only
the current label visible and accessible. The original exact geometry and reconnect assertions remain;
an additional narrow-phone case covers the wrapping boundary.

The desktop active-swipe case measured 53.24 FPS with Max glass on panels and cards, against 59.67 FPS
with Panels only and 60.00 FPS with glass off. The failed interval contained zero React commits,
long tasks or store scans. A local Chromium compositor capture of the same 180-frame movement showed
451 raster tasks / 149.80ms without surface promotion. Promoting only the active pointer's surface
reduced this to 22 tasks / 15.27ms in the repaired application. The promotion ends with release,
cancellation or loss of eligibility; inactive rows do not retain layers. The full-glass appearance is
preserved. This addresses measured raster cost without reducing blur, changing gesture semantics or
relaxing the 55 FPS floor. Local Chromium was already near 60 FPS before this correction, so the
hosted improvement still requires a new hosted result. Windows WebKit remains below target and this
correction does not establish a native-iPhone performance fix. The aggregate browser check correctly
failed because of the two interaction failures; its contract and topology are unchanged.

The full local follow-up also identified a rapid-entry helper comparing raw button `textContent`,
which now includes the hidden sizing label. It resolves the same buttons by accessible name before
dispatching both clicks in one turn; all original route and setup assertions remain. Its three focused
Chromium/WebKit cases pass. The interrupted broad run remains non-passing evidence.

The subsequent full built interaction gate records 595 passes, ten existing skips and one
`ERR_NO_BUFFER_SPACE` in Practice Listen to Type before application loading. Its trace has only the
failed document request and an `about:blank` frame, with no scripts or API requests. A resource check
shows about 22.3 GiB of free memory and fewer than 800 TCP records, without establishing the cause.
This recurring local runner failure remains unexplained; the full run is not reclassified as green.
The affected Practice journey subsequently passes separately in both Chromium projects and mobile
WebKit. The correction also passes the web typecheck, changed-source lint, design-token check and
eight motion contract tests. No assertion, timeout, retry, baseline or protected check was relaxed.

### Storage, diagnostics and acceptance

There is no SQL migration, IndexedDB version change, reset or cache-clearing repair. Populated v2 tests
compare every prior store key/value, metadata/cursor, pending exact Note/name payload and recovery
archive before and after the additive v3 upgrade. Interrupted upgrades retain v2 and recover with Retry.
Review tests hold delivery independently of local commit, retain the original pending event and prove an
identical retry after authenticated reconnection. Existing account rejection, isolation and canonical
replay checks remain in place. Offline & sync groups completed categories under quiet Recent activity;
unresolved work and its recovery actions remain outside that history. No receipt or archive is removed.

Content-free lifecycle records begin in the shell before modules load and survive subsequent recovery.
Settings and the startup error screen can export them. They identify shell/module loading, local reads,
account deadlines and the ordering of focus, visibility, pageshow and offline events, without identifiers,
URLs, content, credentials, payloads or raw errors. Nothing is uploaded automatically.
Both browsers verify recovery after the real entry module is blocked, with the failed launch still
present in the exported report. This is diagnostic coverage, not proof that native startup is fixed.
Dispatch before the HTML bootstrap executes remains outside these diagnostics; a missing shell record
at the reported launch time distinguishes that boundary from an application restoration stall.

An entirely idle page with no loss event, foreground event or HTTP work has no immediate observable
outage. The next navigation or request checks it. Native shell loading, IndexedDB scheduling and glass
compositing remain physical-device risks. Use the four-step acceptance checklist in `offline-study.md`;
a failed device check kept Phase 8.5 blocked until the owner accepted PR #53. New offline Study has its
own physical-iPhone acceptance checklist in `offline-study.md`.

## Phase 8.5 hosted measurement investigation

PR #53 merged as `5d9c680`; the owner accepted installed production iPhone offline access and the
reported interactions. That acceptance is separate from instrumented native frame pacing.

The post-merge [main run 38775107806](https://github.com/Sandaliy/Neuron/actions/runs/38775107806)
failed the phone sustained full-glass swipe at 47.8985 FPS, with 182 sampled frames, 33.4ms p95 and
50ms worst frame. It recorded zero React commits, long tasks, layout shifts or IndexedDB scans.
Panels-only and glass-off both measured 60 FPS. Its desktop interaction and Windows visual jobs passed.
The exact same product tree passed PR #53 at 55.1515 FPS on phone and 59.6741 FPS on desktop; the
phone margin was narrow. Nine unchanged local cases measured about 60 FPS. Local isolation/stationary
plane probes did not establish an additional product rendering defect, so those alternatives were discarded.

[Controlled hosted run 38778730044](https://github.com/Sandaliy/Neuron/actions/runs/38778730044)
uses one Ubuntu runner, the same built application, 4× CPU throttle, gestures and assertions. Three
full-glass sustained samples with continuous trace screenshots measure 50.32, 53.27 and 53.53 FPS.
Without recording, all three measure 60 FPS. Panels-only/off remain 60 FPS in both conditions.
The three original traced assertions failed; the informational workflow's success is not a passing
performance result for them.

The narrow fixture correction disables continuous screenshots only for `interaction-lifecycle.spec.ts`.
DOM/action/network trace snapshots, frame/input telemetry and a failure screenshot remain. The
[corrected hosted run 38779250944](https://github.com/Sandaliy/Neuron/actions/runs/38779250944)
passes all nine cases at 60 FPS with those retained traces, and all nine unrecorded controls pass at
60 FPS. Continuous screenshot compositing caused the measured hosted penalty. No glass appearance,
55 FPS floor, assertion, gesture, retry, CPU throttle, browser coverage or required gate was reduced.
The temporary diagnostic workflow is absent from the release diff; the normal performance monitor is
unchanged. Native WebKit/iPhone frame-rate limits remain distinct from this measurement correction.

Offline Study adds a lazy shell-cached worker. Its account-scoped collection clone, validation, history
projection and shared forecast do not run on the main thread. New regression measurements retain
5,000 Notes and 15,000 existing Cards, record UI-thread scans/frame/long-task telemetry during setup,
and bound local entry without replacing ordinary interaction or performance acceptance gates.

On the final built application, the 4× CPU Chromium sample records 377ms for setup/language change
and 417ms for deliberate Study entry, with no UI-thread entity scans or long tasks. Both real PWA
cold-offline entries satisfy the unchanged five-second assertion. The full built serial interaction
checkpoint passes 608 cases with twelve opt-in skips. After the final conservative snapshot/settings
guards, eleven focused Chromium/WebKit cases and both PostgreSQL/PWA journeys pass; the latter use
explicit completed-download and final-response boundaries rather than racing background work.
All 66 unchanged Windows visual contracts and five enforced performance cases pass, with measured
scroll rates of 59.7–60 FPS against the unchanged 55 FPS floor. Browser selection/gate contracts pass
all 31 cases.

The 5,000-Note/15,000-Card CPU benchmark requires Chromium CDP. On this Windows WebKit runner, a
large test download exceeded the existing transaction deadline before planning, and direct fixture
population did not finish within its setup limit. That preparation failure is not a passing local
planning measurement. The WebKit benchmark is explicitly skipped; functional cold offline Study,
Typing/local Listening and real PWA/database reconciliation remain verified separately. No product
deadline or assertion was relaxed to claim a large-WebKit result. Installed-iPhone acceptance remains
required for native startup, keyboard, voices, motion and glass behavior with the owner's collection.

## Phase 8.5 connectivity acceptance repair

PR #54 merged at `d69c69f`; the owner confirms installed-iPhone offline Study functionality but reports
connectivity churn and restricted history readiness. Controlled built-app reproductions fail on main:
a successful 3.2-second account request is demoted/aborted at two seconds, repeated recovery taps
replace useful checks, and six healthy cached navigations add six account probes. The repaired
Chromium/mobile WebKit cases retain mounted geometry and authority through that delay, join one
verification and add no probes during the same healthy navigation sequence.

The worker-enabled real HTTP/PostgreSQL journey also verifies six-second account latency alongside
healthy API progress, isolated HTTP failure, corroborated API-wide server errors, silent hanging requests, automatic bounded recovery,
server loss and repeated-check/foreground coalescing in both engines. A separate existing Review
journey initially waited on a manual Check connection click after automatic recovery removed that
control; its trace identified the fixture race. Both existing PWA/database journeys pass after
observing automatic recovery, retaining their exact event, receipt and canonical scheduling assertions.

Settings readiness reuses the existing account-bound planning worker. Snapshot cloning, history
checks and forecasting remain off the main thread; ordinary online Study and unrelated navigation
do not create it. Visual updates are confined to the inspected Settings readiness/scope copy and
the affected dialog backgrounds. The shared motion, geometry, native-input and 55 FPS contracts
remain unchanged. Browser evidence does not reproduce the owner's precise native event sequence;
renewed physical-iPhone acceptance and retained content-free transition diagnostics remain necessary.

The corrected release build passes 616 serial phone/desktop interactions (fourteen explicit opt-in
skips), six real HTTP/PostgreSQL PWA journeys across Chromium/mobile WebKit, five enforced performance
cases and all 66 Windows visuals. Active and sustained swipe pacing measures about 60 FPS in all
three glass modes; the recorded 5,000-Note and 500-row scroll measurements also remain at 60 FPS.
All existing thresholds, retries and assertions remain unchanged.

With 5,000 Notes / 15,000 Cards and 4x CPU throttle, the phone sample reaches configured offline
Study setup in 377 ms and enters the card in 447 ms; desktop records 464 ms and 415 ms. Both record
zero UI-thread collection scans. The phone sample has no long tasks; desktop records one 57 ms task.
These are bounded browser samples, not native-device guarantees or a claim of zero main-thread cost.
The read-only authenticated default-plan prefetch retains its existing parallel startup path, while
protected writes continue to require matching validated authority.

## Phase 8.6 stable capability presentation

The PR #55 implementation replaced Shell routes outside the collection during local access, replaced
Library menus/handles, unmounted collection dialogs, and changed Deck selection identity when server
authority changed. Phase 8.6 keeps these structures mounted. Capability restrictions are announced
and explained on deliberate actions, with server operations checked before mutations. Today retains
its rendered summary while switching planning authority; an actual setup change or committed Review
still uses the established reconciliation state. Start cannot use an obsolete plan.

The retained-list regression exposed a stale swipe click-suppression latch after selection. Disabling
swipes now clears that transient gesture state; the original keyboard-delete assertion remains. A
separate regression checks active Practice retention while refusing offline classification without a
command, progress change or server write. Rename dialogs retain the same input, value and focus
through disconnection and matching validation. Downloaded online names commit through the existing
rename outbox before acknowledgement.

The focused transition cases assert identical row/header geometry, DOM identity, retained Folder
expansion, search, selection and open menu items across repeated loss/recovery and foreground events.
Existing cold-start, storage/recovery, account rejection/switching and durable Review/Undo cases retain
their original integrity assertions. A rejected or missing account never inherits capabilities from
cached content.

The existing revision-keyed collection projections and planning worker are retained. No eager
prefetching, additional collection scans or cache infrastructure was added. Recorded 5,000-Note local
Study samples reach setup in 356–494 ms and enter Study in 378–498 ms with zero UI-thread entity scans.
These bounded Windows Chromium samples include one 52 ms long task in one run. They do not establish
a native-device speedup. The earlier PR #55 controlled phone sample was 377/447 ms for setup/entry;
the accepted PR #53 installed-iPhone experience remains the qualitative reference, not a new benchmark.

Protected release, final browser/performance results and physical acceptance are recorded in STATE.md.
The original glass/motion settings and 55 FPS contract remain unchanged. Installed-iPhone foreground,
storage and compositor behavior still require owner acceptance.

## Phase 8.6 Review delivery cost

The reported forty-second reconnection was measured rather than guessed. `sync-delivery.spec.ts`
holds a sitting's deliveries, answers twelve cards, releases them at a fixed 120 ms round trip and
records what delivery costs.

| Measure                                 | Before   | After  |
| --------------------------------------- | -------- | ------ |
| Requests for twelve answers             | 12       | 2      |
| Wall clock from release to synchronized | 1,935 ms | 401 ms |
| Page heights observed while draining    | 12       | 4      |
| Saving notices flashed over four cards  | 4        | 0      |

Delivery was one request per immutable event, so the wait was the round trip multiplied by the number
of answers. A sitting with learning steps and Undo legitimately holds that many events: seventeen
pending records after "a handful of cards" is real immutable history, not duplication or retries. At a
phone's round trip plus a cold serverless function, seventeen of them in a row is the reported
thirty to forty seconds. Batching the leading run of answers removes the multiplication; the
remaining two requests are the first answer, already in flight when the hold began, and the batch.

The page-height count is the Settings complaint stated as a number: with one row per event settling
one at a time, everything below the list moved twelve times while the backlog drained. One settle per
request and a grouped count move it four.

The saving notice is a separate defect. The card does not advance until the answer is durable, which
is correct, but the mode title was replaced on every answer to say so. A commit that takes a few
milliseconds has nothing to report, so the notice now waits 400 ms, longer than the slowest motion in
the system. A genuinely blocked transaction still explains itself: the existing open-transaction case
is unchanged.

The progressive Recent activity reveal was measured and acquitted. With a 251-event history at 4x CPU
throttle it runs at 60 FPS, worst frame 16.8 ms, across fifteen distinct height steps. The reported
jerkiness was the content changing underneath the animation as events settled individually, not the
reveal itself.

These are bounded Windows Chromium samples against routed fixtures at a fixed simulated latency. They
establish the number of requests and the shape of the wait, not an installed-iPhone duration.
