# Database Integrity Doctor

Operator diagnostics for persisted collection and learning data. There is no repair mode,
application endpoint, migration, schema change or dependency change.

## Run

Build the existing shared packages on a fresh checkout, then use the API package's existing runner:

```powershell
pnpm --filter "@neuron/api^..." build
# Set INTEGRITY_DATABASE_URL through the local environment or secret store.
# It must connect as neuron_app. There is deliberately no DATABASE_URL/owner fallback.
pnpm --filter @neuron/api exec tsx src/db/integrity/main.ts --user <account-id> --database <database-name>
pnpm --filter @neuron/api exec tsx src/db/integrity/main.ts --user <account-id> --database <database-name> --deep --card <card-uuid> --details
pnpm --filter @neuron/api exec tsx src/db/integrity/main.ts --help
```

The database argument must match both the connection URL and the connected database. Run one
explicit account per invocation, using an authorized operator's account list. There is no account
discovery or all-account owner mode. Owner, authentication and privileged roles are rejected. RLS
must be active and forced on every owned table and Note types; the existing release role/column
manifest is reused. This tool cannot distinguish a missing parent from a foreign parent hidden by
RLS, and reports **missing/inaccessible**, without escalating privileges.

Each account runs in one `REPEATABLE READ READ ONLY` transaction with local account binding and
unconditional rollback. It takes no account write lock. The CLI uses one connection, a ten-second
connect timeout, a five-second statement timeout, a 500 ms lock timeout, a ten-second idle transaction
timeout, 4 MiB `work_mem`, and no parallel query workers/JIT. SQL execution can still scan an account;
row pagination is not a guarantee of constant database work. PostgreSQL may spill bounded-memory
sorts/aggregates to temporary disk. Run large scans off peak or on an appropriately current replica.

Default wall-clock budget is 60 seconds, checked between queries. The next statement timeout is
reduced to the remaining budget. Connection/setup/rollback can add bounded overhead. Ctrl+C/SIGTERM
is observed at query boundaries; an active query can take up to its statement timeout to finish.
Connection loss closes the transaction. Error output contains only a fixed phase and SQLSTATE or
sanitized category, never driver messages, SQL detail, connection strings or stack traces.

JSON is written to stdout. Default output includes counts, check IDs, severity, diagnostic context,
scope coverage, snapshot time/revision and timings. It contains no Note fields, collection names,
account identifiers, emails or Review payloads. `--details` adds at most ten affected UUIDs per finding
and safe pagination cursors. Keep detailed reports confidential. Receipt payloads and arbitrary
fingerprint strings are withheld; current digest/command-UUID fingerprints may be continuation cursors.

| Exit | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | Named scope completed with no confirmed violations; warnings still require assessment |
| 1    | Named scope completed with confirmed violations                                       |
| 2    | Failed or incomplete, including any cap/unverified scope; **never passing evidence**  |
| 130  | Interrupted                                                                           |

Counts are per check, not a sum of distinct damaged entities across checks. A cycle can affect every
descendant's ancestry. Sample IDs are diagnostic examples, never a repair list. Review findings with
the owning repositories and immutable events before changing data. Preserve a confidential report,
checkout SHA, target identity and snapshot revision for before/after-release comparisons.

## Checks and contracts

| Area          | Structural mode (whole explicit account)                                                                                                                                         | Additional deep verification                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folders/Decks | Parent accessibility/kind, materialized paths including tombstones, cycles/depth with nine-edge bounded traversal, live children under deleted parents, live deletion provenance | No content/name export                                                                                                                             |
| Notes         | Leaf Deck ownership, accessible Note types, Import provenance                                                                                                                    | Maintained `parseNoteFields`; custom types and oversized payloads are explicitly unverified                                                        |
| Cards         | Accessible Note/Deck, denormalized Deck equality including retired Cards, live Card under deleted Note, non-Cloze slots                                                          | Maintained `possibleCards`, including explicit Cloze c0; unavailable live faces are warnings, retired identities are historical                    |
| Scheduling    | Partial/null or nonfinite memory, nonfinite schedule timestamps, non-pristine new state beyond existing constraints                                                              | Current-life canonical `reviewProjectionOrigin` / `projectReviewEvents`, existing database mappings and scheduler configuration                    |
| Reviews       | Same-account Card; cancellation target accessibility/Card/kind; partial/nonfinite predecessor memory                                                                             | Bounded event replay with cancellation, restart and `reset_at`; repetitions/last-answer comparison                                                 |
| Restart       | Same-account collection/optional Note, reset event revision and immutable receipt event count                                                                                    | Nonzero captured legacy origins remain valid                                                                                                       |
| Sync          | Eight revision-bearing tables checked against exact account head and protocol number range; Undo aliases; successful offline creation targets                                    | Maintained rename, Note-edit, Note-create and Deck-create response schemas, digest shape and result revision; Practice snapshot schema/consistency |
| Recovery      | Purged Note/collection content and descendants, unredacted purged conflict payloads                                                                                              | Purged schedules and Reviews remain attributable and replayable                                                                                    |

Structural queries complement the current CHECK/FK/unique constraints and triggers. They do not
reimplement every database constraint. Use `db:check` and `db:verify-release` separately for migration
journal/index/runtime compatibility; the auditor deliberately does not obtain owner journal access.
Full RLS policy/grant verification remains in the existing isolation/release tests.

Legitimate states explicitly preserved:

- Collection deletion hides a subtree without deleting each Note/Card. Live Notes beneath deleted
  Decks are valid. Independently deleted descendants can have different deletion operations, and legacy
  deleted collections can lack an operation ID.
- Retired Cards can retain old types, directions, slots, schedules and immutable Reviews. Purge redacts
  content, preserves identities/history, and does not require all schedules to become new.
- Import counts/Deck references describe the original import. Moved, merged, restored or undone Notes
  need not equal its count or remain in its original Deck.
- Multiple rows can share one revision. Zero revisions and gaps in surviving revisions are allowed.
  Delivery responses remain historical after later edits; a rejected/conflicting creation need not have
  created anything. Conflicts are normal, not corruption.
- Answer, server-arrival and original submitted times can differ. Undo copies the target answer's
  timestamp; it is not necessarily later in reviewed time. Reset/cancellation events are not answers.
- Due can differ from placed due after backlog placement. Deep mode does not compare those fields.
  Memory differences under **current** settings/algorithm are warnings because complete historical
  settings are not persisted. Missing/unusable origins are unverified, not asserted missing history.
- Legacy slot-0 Cloze has a separate semantic decision in `legacy-cloze-assessment.md`. Current parser
  c0 is valid. No Card is retargeted, merged, restored, regenerated or deleted here.

## Bounded deep runs

`--card` selects one Card and its Note. `--deck` selects one exact leaf Deck, not descendants.
Structural checks and receipt validation still cover the explicit account. Practice is skipped for
a single-Card target. No target option means a bounded deep scan of the account.

Defaults are 100 rows/page, 1,000 items per deep phase, and 2,000 current-life events per Card.
Allowed maxima are 500 rows/page, 10,000 items/phase, 10,000 events/Card, 30 seconds/statement and
ten minutes/run. Use `--page-size`, `--max-items`, `--max-events`, `--statement-ms`, `--budget-ms`.
Notes/Practice payloads above 64 KiB, captured predecessors above 4 KiB and receipts above 16 KiB
are unverified without transferring their full JSON. Receipt keys above 200 bytes are counted and
excluded from client pagination. More than 64 distinct Cloze gaps skips face
expansion using the maintained gap parser. A single event-limited Card needs a separate targeted
investigation if it still exceeds the maximum; the tool does not silently truncate and replay it.

Every deep phase reports `scanned` and `complete`. With `--details`, a phase stopped by the item cap
also provides `after`. Continue with `--after-note`, `--after-card`, `--after-practice` or
`--after-receipt`, carrying each relevant phase's cursor. Each continuation is a **new** snapshot;
concurrent modifications mean a stitched scan is not one atomic whole-account certificate. A whole
snapshot that exceeds the budget requires a smaller target/off-peak investigation. Do not treat
an empty target, cap, oversized item, unknown type or failed query as clean data.

Client memory holds one bounded entity page and at most `maxEvents + 1` event rows for one Card,
not an account history. Findings aggregate counts with capped samples. `metrics.queries` counts
data queries only, excluding transaction/configuration statements and the reused schema preflight;
`maxRows` is the largest data result. Wall time includes connection/setup/rollback. RSS measurement
below is sampled process growth, not a proof of peak allocation for all possible payloads.

## Evidence and limitations

Tests use the existing disposable PostgreSQL harness; the auditor itself never provisions or wipes a
database. Configure the three existing test URLs and optional `DATABASE_URL_TEST_WS_PROXY` as in CI.
They must point to a separate disposable database. Never point the test harness at production.

```powershell
pnpm exec vitest run --project api apps/api/src/db/integrity
# Existing RLS/repository/route coverage:
pnpm exec vitest run --project api
# Release regressions own their own disposable databases and run separately:
pnpm exec vitest run --config apps/api/vitest.release.config.ts
```

Coverage includes healthy multi-account fixtures; ownership/path/cycle/slot/schedule corruption;
database refusal of impossible fixtures; exact retries and concurrent Undo aliases; later answers;
restart receipts and reset cutoffs; deletion/restoration/independent retirement/purge; captured nonzero
legacy origins; current settings and backlog exceptions; explicit c0 and legacy Cloze; delivery schema,
target and cursor checks; size/page/event bounds; owner/auth rejection; actual PostgreSQL write refusal,
timeout cleanup, signal interruption, context reset and concurrent snapshot consistency. Constraints,
triggers and RLS are never disabled to manufacture findings.

The reproducible large fixture has 3,001 Notes, 6,001 Cards and 60,000 immutable Reviews, with valid
states generated by the maintained scheduler. Local PostgreSQL 17 through the same WebSocket proxy
used by CI measured 1.892–2.304 seconds for structural checks (48 data queries; largest result 11 rows)
and 3.713–7.053 seconds for a capped deep pass of 50 Notes/Cards (108 queries; largest result 18 rows;
page size 17) in two full API runs with concurrent database tests. Sampled RSS growth across the two
passes was 1–2 MiB. The deep pass is intentionally incomplete.
Measured figures are printed by the test; hardware, network latency, database bloat,
account distribution and concurrent load affect production timings.

No production account was scanned as part of delivery. The deliberately inconsistent fixtures prove
detection, not incidence in production. They expose a defensive constraint gap: the existing SQL union
CHECK permits a reviewed state with partial NULL memory, and PostgreSQL accepts positive Infinity/NaN
for stability. `audit.test.ts` reproduces these using ordinary statements with all production
constraints active. Severity is high **if persisted**, because scheduling/mapping cannot safely use
these values. No normal application path producing such rows was established. Tightening constraints
or repairing existing rows needs its own compatibility/data investigation and is outside this tool.

Coverage excludes browser IndexedDB/outboxes, undelivered work, device acknowledgements and external
replica consistency. The tool does not infer pending device synchronization from server state,
require receipts for every legacy write, demand every
possible ladder direction, or reconstruct redacted content. New persisted contracts need explicit
checks and fixtures before the report can cover them.
