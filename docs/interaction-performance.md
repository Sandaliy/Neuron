# Phase 8.2 interaction stabilization

Measured on 2026-10-11 against the built PR #48 application (`b2644236`) and the stabilization
implementation. Phase 7 (`703890b`) and the accepted PR #47 continuity implementation (`e63c64d`)
provide the interaction references. Disclosure, dialog, scroll restoration, motion tokens and glass
rules were unchanged between Phase 7 and PR #48. Swipe changed only its disabled-state guards.

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
worst frame. These remaining port/compositor observations are not proof that installed-iPhone motion
is repaired. The measured fix removes competing collection work without altering those animations.

## Geometry, regressions and delivery

Browser regressions retain the original screen/Note DOM nodes through reconciliation, disabled
server actions before authority, saved Practice summary geometry, interrupted request recovery and
direct Practice authority. Existing offline tests cover in-session loss/revalidation, transport loss
despite online hints, expansion/search/scroll retention, account rejection and late validation.
The shell test emulates a 47px top inset and checks a stationary cover during scroll. Top padding
includes the inset at every breakpoint; the cover prevents content painting into it. The exact
reported physical status-bar overlap remains a device acceptance item.

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

All five controlled performance cases passed with the existing 55 FPS threshold enforced at 4× CPU
slowdown: 5,000 Notes at 60.0 FPS with 11 mounted rows, 500 Panels-only rows at 60.0 FPS, full-glass
Decks at 59.0 FPS and mixed collections at 59.7 FPS. Scroll throughput is separate from the cold-entry,
reconciliation and competing-background-work observations above.

Physical-iPhone acceptance must still cover installed-PWA cold/warm Deck entry, Today/Library,
Practice, disclosure, committed/reversed swipes, security dialogs, foreground/background return,
safe-area scroll, connectivity loss/restoration and pending rename delivery/conflicts. Browser
WebKit coverage and CPU-constrained Chromium evidence do not replace this acceptance.
