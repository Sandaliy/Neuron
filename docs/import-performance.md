# Large Import performance and recovery

## Scope and environment

Measured on Windows, Node 24.18.0, a Ryzen 7 5700X (16 logical CPUs), 32 GiB host memory,
PostgreSQL 17.11 in a disposable Docker container, and the Neon WebSocket proxy. The application
uses its restricted database role and real RLS. Production Neon latency and physical-phone memory
are different environments. No production collection was used.
Built-browser measurements use Playwright 1.62.1 and Chromium 151.0.7922.34. Mobile WebKit is a
separate compatibility and recovery check. Application timings include validation, transaction and
local WebSocket round trips; they are not pure PostgreSQL executor timings.

The control is the Import implementation from `756a1f3`. The implementation is rebased on
`6e1e1c6`, including PostgreSQL CI (#72) and Learning Waves (#73). Neither changes Import planning
or delivery. Benchmarks use the same installed dependencies, fixture generator and test settings.
Numbers below are local measurements, not new or relaxed CI performance budgets.

`scripts/import-fixture.ts` generates vocabulary with definitions, examples, readings, Grammar,
two tags and explicit source ranks. The database benchmark imports 5,000 Notes and 15,000 Cards,
then checks all 5,000 terms against the resulting collection. The built-browser benchmark uses
5,000 source rows, 500 existing matches and five invalid rows: 4,495 additions in nine chunks.
It retains a committed first chunk while dropping its response, reloads, and resumes with the
original IDs. Browser responses have a fixed 30 ms delay; database work is measured separately.

## Findings and changes

- Parsing was not the dominant cost at this size. Initial seven-sample medians for 5,000 rows were
  12.57 ms JSON, 3.91 ms CSV, 3.52 ms TSV, 7.70 ms Anki text and 2.70 ms plain text. Full field
  diagnostics cost 15.49 ms. Formats and the 10 MiB file-selection limit remain unchanged.
- Preview repeated full-source field diagnostics during duplicate choices and save-state renders.
  It now computes diagnostics once per parsed source. Unchanged preview rows are memoized, and
  closed Grammar disclosures do not build hidden field content. The 200-row preview bound remains.
- Every acknowledgement validated and cloned the entire frozen plan and raw preparation. A saved
  recovery record in the browser fixture serializes to about 3.7 million characters. Version-2
  storage separates immutable source/plan records from a revision-checked header. Acknowledgements
  write the header only; the final fixture header contains 162 serialized characters. Old version-1
  envelopes still load and upgrade atomically on save. Frozen plans are deeply immutable, allowing
  validation reuse inside a visit without trusting unvalidated storage reads.
- Duplicate lookup sent repeated full terms, including valid Basic/Cloze identities longer than the
  endpoint's 300-character input bound. It now sends unique canonical keys (at most 200 characters),
  with two bounded read requests and cancellation when preparation changes. The server still owns
  duplicate matching; the final recheck remains mandatory.
- A rich 500-Note chunk used 26 SQL statements, repeated destination/type lookups and returned full
  Note/Card objects merely to count them. The Import-only repository now uses bounded JSON recordsets,
  returns only inserted Note IDs, generates Cards with the unchanged canonical `openingCards`, and
  writes at most 2,000 Cards per statement. A single reserved revision range publishes groups of at
  most 200 Notes or Cards, plus the final batch row. Shared Note writes and learning-planning code
  are unchanged.
- PostgreSQL reproductions accepted new chunks after Undo and silently skipped IDs owned by a
  different batch. Both returned 200 before the fix. Chunk application now takes the existing user
  write lock before reading the batch, rejects undone/changed batches and foreign work, and rolls
  back the entire chunk on any ID collision. Concurrent retries preserve the original Cards.
- A live WebKit run exposed synchronization contention absent from routed fixtures: an initial
  2,002-write cache transaction reached the existing 10-second deadline; the Import checkpoint's
  first read waited behind it for about 10 seconds and was aborted too. Even 500-row groups took
  7.6–8.4 seconds in that Windows WebKit environment. Bounded 200-row revisions avoid that oversized
  cache unit while preserving the atomic PostgreSQL chunk. Revision reservation adds one statement,
  rather than one database round trip per group. No transaction deadline was extended.
- A healthy connection refresh could cancel final duplicate validation and silently return to
  preview. Final validation now has its own cancellation scope. Source changes, leaving the screen,
  account revocation and lost server authority still stop it; a passive duplicate refresh cannot
  cancel an otherwise current application.
- Merge-only imports previously replayed every merge after interruption and displayed no merge
  progress. The existing fill-blank PATCH remains authoritative; two requests may travel together,
  and each fully acknowledged group of twenty commits a merge checkpoint. Only the unconfirmed
  suffix replays. The server stores a digest-only receipt for each attempt and Note. An exact retry
  acknowledges the commit without reapplying the edit, even if a later edit cleared a field. The
  first delivery requires the Note to remain in the frozen destination. Merges remain outside Import Undo.
- Completion used to wait for cache refetching after its durable summary had already committed.
  It now marks destination queries stale and shows completion while warming them in the background.
  A server summary with missing or unexpected additions retains recovery instead of claiming success.
- Cold-table statistics caused reconciliation to rescan all 15,000 Cards for each of 5,000 Notes.
  PostgreSQL's captured plan discarded 74,985,000 joined pairs and took 14.7 seconds in SQL execution.
  Reconciliation now reads batch Note IDs and counts their Cards with one bound UUID array. A shared
  user lock keeps both reads consistent against collection writes and Undo. Notes without Cards
  still count independently; no planner settings or database statistics maintenance are required.
- If another tab saves a newer draft before the first frozen checkpoint commits, application stops
  before any server write. That tab can save its retained preparation separately. Once an attempt
  has been durably saved, recovery continues to use its exact frozen identity.
- Network loss between the final cache commit and its availability notification could leave Import
  showing no preliminary duplicate check. Import now confirms durable cache completeness before
  falling back to local matching. This grants no server write authority and refuses incomplete data.

## Matched measurements

Three database runs, milliseconds:

| Measurement                             | Control samples     | Hardened samples |
| --------------------------------------- | ------------------- | ---------------- |
| Apply 5,000 Notes / 15,000 Cards        | 5970, 6172, 6900    | 2291, 2316, 2352 |
| SQL statements during application       | 260 each            | 130 each         |
| Lookup 5,000 existing terms             | 301, 295, 291       | 260, 302, 322    |
| Reconcile completed batch, warm control | 124, 139, 123       | 150, 145, 164    |
| Reconcile with empty-table statistics   | 14830, 14831, 14813 | 150, 145, 164    |

The median application time fell from 6.17 s to 2.32 s (62%); statement count halved.
The duplicate SQL query itself was already bounded and indexed. Its read cost was retained rather
than replaced with an unproven database optimization. Browser concurrency removes request waterfalls.

Three built Chromium runs at 375 × 812 with 4× CPU throttling, milliseconds:

| Measurement                                  | Control samples  | Hardened samples    |
| -------------------------------------------- | ---------------- | ------------------- |
| Source to usable preview                     | 3627, 3500, 3477 | 2972, 2800, 3012    |
| Final recheck, freeze and first failed chunk | 2832, 2872, 2944 | 2124, 2122, 2126    |
| Reopen interrupted draft                     | 603, 661, 605    | 637, 632, 660       |
| Resume to durable completion                 | 3935, 3954, 3990 | 1001, 1006, 1005    |
| Longest observed delivery task               | 167, 169, 170    | none at least 50 ms |

Median resume time fell from 3.95 s to 1.00 s (75%). Preview improved by 15% and freeze/recheck by 26%.
Reopening is slightly slower because it validates and deeply freezes the restored plan once.
Each run made ten duplicate requests (preview plus final
recheck) and ten chunk requests (one lost response, its exact retry and eight further chunks).
The total recovery data remains present; only repeated checkpoint I/O shrinks.

Chromium used-heap snapshots at preview were 27.1–38.7 MB in the control and 31.9–32.0 MB after the change.
These are snapshots, not device peak memory or a GC-controlled allocation experiment. Node's sampled
heap growth was 15/60/55 MiB in the control and 18/5/16 MiB after the change; hardened RSS was
276/281/285 MiB. Those samples also vary with GC and do not establish a peak-memory reduction.
The captured PostgreSQL join used a 1.2 MB sort; backend peak allocation was not profiled.
No claim about a physical iPhone's peak memory follows from either number.

The cold reconciliation comparison uses the unchanged old join with the optimized writer to isolate
the query-plan cost. Analyzing empty tables before loading reproduces the bad plan; automatic
statistics updates can otherwise conceal it. The final hardened samples above all use that cold
setup. Warm SQL execution of the old query was about 12 ms, explaining earlier inconsistent results.
The benchmark records per-query timestamps and statement counts separately from wall-clock time.

## Recovery evidence

The PostgreSQL suite covers 5,000-row application and committed-response retries, concurrent identical
chunks, changed batch metadata, duplicate IDs within/across accounts, invalid-last-row rollback,
deleted destinations and Undo. A 1,500-Note mixed fixture produces exactly 4,000 Cards: three vocabulary
directions, two Basic directions and Cloze slots 1, 3 and 7, including repeated occurrences of slot 1.
Every source ID, rank, relationship and canonical direction/slot is compared with stored state.
Review and Card records remain unchanged through retries and supported fill-blank merges; Undo keeps
Reviews. Large Undo commits the tombstones and batch marker together and publishes them in bounded
revisions. Sync pages with limit 1 return each complete revision, including the final batch row.
The tests reconcile every Note and Card in the committed chunk and every tombstone after Undo.
The existing Learning Waves read consumes the imported collection in its source order.

Built-browser checks cover all supported formats, bounded previews, offline preparation, quota failure,
account switching, competing tabs, legacy storage upgrade, changed final duplicates and interrupted
delivery. Additional checks stop delivery after acknowledgement persistence fails, retain a mismatched
summary, resume only unconfirmed merge groups, and finish without waiting for a held cache read.
The opt-in live journey compares IndexedDB checkpoints and their frozen IDs with real PostgreSQL
Notes, Cards and retained Review records after closing and reopening the page.

Local validation on this branch:

| Check                                                                                          | Result                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Import, Note creation/conversion, sync, Review/Undo, collection integrity and Waves API checks | 123 passed against PostgreSQL                         |
| RLS/auth-role isolation and legacy collection migration                                        | 46 passed against PostgreSQL                          |
| Parser, canonical Cards, fields, merges, i18n and Import frontend units                        | 99 passed                                             |
| Production migration/release safety, including missing-schema and fresh-install checks         | 10 passed                                             |
| Final focused built-browser gate across phone Chromium, desktop Chromium and mobile WebKit     | 21 passed, including all three live database journeys |
| Matched phone performance fixture, each implementation                                         | 3 passed per implementation                           |
| TypeScript, changed-code ESLint/Prettier, core isolation, design tokens and diff whitespace    | passed                                                |

The broader browser runs also exercised every ordinary Import scenario and 99 adjacent offline Note
creation/editing and Learning Waves fixture cases. The combined final Import execution recorded
100 passed, four failures and one inapplicable WebKit benchmark skip. Three failures were the new
boundary test expecting one addition when the cached duplicate correctly produced zero; the fourth
was cancellation during live-test teardown. Corrected assertions and explicit HTTP-work draining
pass in the focused gate above. This is combined coverage evidence, not a claim that the earlier
complete command was green. The broader adjacent cases passed unchanged. Failure traces remain in
ignored local evidence; no baselines or timeouts were changed to hide these failures.

## Reproduction and acceptance limits

Build core/shared before unit and API checks. Set `IMPORT_BENCHMARK=true` for
`apps/web/src/features/import/import-performance.test.ts` and
`apps/api/src/routes/import-performance.test.ts`. The latter uses the guarded `DATABASE_URL_TEST`
configuration and empties only that throwaway database through the normal test setup.
`IMPORT_BENCHMARK_STALE_STATS=true` additionally analyzes the empty tables before bulk loading.
PR #72's `DATABASE_URL_TEST_WS_PROXY` supports the same PostgreSQL/proxy setup as CI.

Build the web package, then run Playwright with `CI=true` against Vite preview. Select
`tests/import.spec.ts`, project `phone-interaction`, and grep `large Import performance` with
`IMPORT_BENCHMARK=true` for the throttled fixture measurement. Use `IMPORT_DATABASE_E2E=true`
and grep `live PostgreSQL` with guarded test database variables for the live journey; Chromium and
`webkit-phone-interaction` are separate checks. Ordinary tests do not silently substitute fixture
results for a skipped live database check. No snapshots were regenerated and no retries were added.

Remaining physical acceptance: installed iPhone on HTTPS, memory pressure while preparing a near-limit
file, background/process termination during a committed chunk, several network transitions, storage
quota exhaustion and eviction, reopening after a shell update, and scrolling/typing during delivery.
Desktop mobile WebKit and CPU throttling do not replace those checks. Browser eviction can remove all
local work. Opening Import still loads retained drafts, so many very large saved drafts can consume
additional memory. Independent Imports may intentionally create identical content under distinct IDs;
exact retry deduplication uses the frozen identities. Replaying a committed header or an entirely
committed chunk leaves the account revision unchanged. Opening Cards use the same inherited ladder
and provenance as ordinary Note creation. Legacy merge requests without an attempt ID cannot establish
whether a previous request committed.

Integration overlap is limited to the Import portion of `apps/api/src/routes/study.ts`, the Import
batch repository, the Import duplicate helper in `apps/web/src/lib/notes.ts`, shared error/i18n
catalogues and their generated copy register, and the Offline Collection domain doc.
Learning Waves, triage, Review transport, account export, shared milestone status and planning code
are outside the change. Delivery is a dedicated PR; merging remains with the integration owner.
