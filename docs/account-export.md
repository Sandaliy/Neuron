# Account data export

Settings > Export your data prepares a private file containing synchronized, server-persisted learning
data. It is a portability archive for inspection and migration tooling, not an import or restore feature.
Exporting does not change collection data, schedules, Reviews, revisions or delivery receipts.

## Coverage

The field allowlists live in `apps/api/src/db/repositories/account-export.ts` (`EXPORT_TABLES` and
`exportVersion`). A schema coverage test requires an explicit decision when a learning column or table
is added. All relationships use the stored IDs, including deleted and purged tombstones.

| Entity             | Exported data                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferences`      | Account ID, synchronized locale/theme, timezone, day cutoff, root study settings, current revision                                                                                          |
| `noteTypes`        | Built-in and account-owned definitions, field descriptions, Card templates and lifecycle timestamps                                                                                         |
| `decks`            | Folders and Decks, parent/path/order, names, settings overrides, deletion operation and lifecycle                                                                                           |
| `notes`            | Type/Deck/Import IDs, every supported vocab/basic/cloze field, grammar and accepted answers, tags, source, rank, status, triage and lifecycle                                               |
| `cards`            | Note/Deck IDs, direction/slot, full stored scheduling state, placed due, opening reason and Review ID, suspension history, reset and deletion lifecycle                                     |
| `reviews`          | Every stored immutable answer, cancellation and reset, target/restart IDs, original and accepted timestamps, durations, historical memory/scheduling values, captured prior state, revision |
| `learningRestarts` | Operation IDs, Deck/optional Note scope, Card count and timestamps, including empty restarts                                                                                                |
| `studyPresets`     | Global/Deck scope, name, stored configuration, default flag and lifecycle                                                                                                                   |
| `practiceRuns`     | Stored run, version, last operation ID and lifecycle, without membership reconciliation                                                                                                     |
| `importBatches`    | Destination, source label, format, recorded Note count, Undo and lifecycle timestamps                                                                                                       |
| `conflicts`        | Entity/target/reason/time and allowlisted losing/kept versions, including retained Practice versions                                                                                        |

Notes support `vocab`, `basic` and `cloze`. Grammar includes supported legacy properties and boolean
false. Media values are references; the export does not fetch external images or audio. Preset
configuration is user-provided JSON and is preserved as configuration, never interpreted as credentials.

Practice stores one current version per Deck. Replaced versions are included only when a conflict
record actually retains them. A complete Practice command/version history was never persisted and is
not invented. Stored queue/status references can name Notes no longer eligible for that Practice pool.
Conflict versions are historical attempts, not accepted events. They can reference entities that were
never created; they are not used to fill holes in server history.

Soft-deleted content remains recoverable and is included with its deletion marker. Purged Note fields,
tags, source and rank and purged Folder/Deck content remain redacted. Conflict payloads for purged or
missing collection targets are redacted even if an old payload survived elsewhere. Retained immutable
Reviews still refer to tombstone IDs. Export never reconstructs cleared content or absent history.

Excluded: authentication profiles, email/name, credentials, hashes, sessions, recovery codes, TOTP,
cookies/tokens, receipt fingerprints/digests, rate limits, normalized search keys and operational state.
Subscription tier is not learning data. The archive does not include Import source files or remote
media bytes.

## Device-only work

Pending creation commands, edits, Reviews/Undo, Practice/triage decisions, Import drafts/checkpoints,
local recovery records and device preferences may exist only in account-scoped IndexedDB or device
storage. They are excluded. No local event is merged into authoritative history, and synchronization
is not required to export the existing server data.

Offline & sync reports several delivery queues, but not every draft or recovery record. A zero pending
count cannot establish a complete device backup. Settings therefore always explains this limitation
instead of making a completeness claim based on those partial counts.

## Format version 1

The filename is `neuron-export-YYYY-MM-DD.jsonl`, MIME `application/x-ndjson`, UTF-8 with LF after each
JSON object. Each line can be parsed independently, without building a full collection in memory.

1. `manifest`: `format: "neuron-account-export"`, integer `version: 1`, unique `exportId`, `accountId`,
   `snapshotAt`, account `revision`, ordered `entities` and an embedded `guide`. The guide travels with
   the file and describes units, relationships, history, deletion, omissions and limits.
2. `record`: `entity` and an allowlisted `data` object. Each table is traversed by ID, with no implied
   chronological ordering across tables. Preferences appear once. Shared system Note types appear too.
3. `complete`: matching `exportId`, total `records`, per-entity `counts` including zeros, and UTF-8
   `bytes` before this final line. It is emitted only after the snapshot transaction commits.

A client must reject missing completion, mismatched ID/counts/bytes, unsupported versions, invalid
UTF-8/JSON, a missing final newline or trailing data. HTTP 200 alone is not success: after streaming
starts, a failure may end with `{ "type": "error", "code": "export_failed" }` or `export_limit`, or
the connection may simply end. Such a response is not a valid archive. The byte/count checks detect
incomplete delivery; they are not a digital signature or a promise of offline tamper detection.

IDs remain strings. Instants use ISO 8601 with an explicit UTC offset; PostgreSQL microsecond precision
is retained. `null` means absent/not captured/not applicable, not zero. `rev` and `currentRev` are the
stored account revision counters. Stability and intervals are in days; durations are in milliseconds.
Cancellation/reset rows carry storage placeholders in answer fields: inspect `cancelsReviewId` and
`resetsLearning` first. Missing historical `priorState` or `submittedAt` stays null. Current Card state
is exported separately and is never presented as an immutable event. Direction provenance includes
the opening reason and triggering Review ID when recorded. Legacy opening reasons remain null.
`wasSuspended` records a suspension since migration 0020 and remains true after Resume.

Breaking interpretation or envelope changes require a new format version. Additional optional fields
can be documented within version 1. New persisted learning entities require a coverage decision,
documentation and matching reader validation; adding a database column never silently exports it.

## Consistency, security and runtime

`POST /api/account/export` accepts only `{ "accountId": "the-current-account" }`. This is an expected
identity check, not an account selector. There is no public URL, export ID lookup or pagination API.
Better Auth's existing session gates apply. The server rechecks the same session/account immediately
before completion; expiry or account replacement leaves no complete archive. Every read includes the bound account predicate and runs
as `neuron_app` with transaction-local identity and forced RLS. Authentication tables remain inaccessible
to that role. User IDs, archive contents and session material are not logged or put in URLs.

One `REPEATABLE READ, READ ONLY` transaction defines the entire snapshot, including preferences,
conflicts and tables outside the ordinary sync stream. Concurrent writes continue normally; they
appear in the next export. No revision lock, revision allocation, schedule projection or write occurs.
The snapshot time is the transaction's start, and its revision is read from that same snapshot.

SQL cursors fetch bounded batches (128 Notes/conflicts, 512 other rows, one Practice run). Server output
awaits the receiver to apply backpressure. The server retains a batch and current line, not the full
archive. A stalled receiver, request cancellation or deadline rolls back and releases the connection.
There is a 15-second statement timeout and 20-second idle-transaction timeout. The request has a
125-second abort deadline; generation is limited to 120 seconds. Vercel is configured for 180 seconds.

Ordinary Vercel responses have a 4.5 MB limit; this endpoint uses streaming, which is the documented
alternative for larger responses. See [Vercel limits](https://vercel.com/docs/functions/limitations) and
[streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
All success and error responses are private/no-store at browser, CDN and Vercel CDN levels. The service
worker's existing shell-only allowlist never caches this POST. The existing PostgreSQL limiter allows
three export attempts per account per minute, independently of ordinary account actions.

The supported archive limit is 128 MiB, with 4 MiB per line. Oversized accounts/records fail explicitly;
they do not produce a partial file presented as complete. Retry takes a fresh snapshot. There is no
cross-request resumable archive, object storage, persistent export job or server-side archive copy.
An account above these limits needs a separately reviewed delivery path. These bounds cover the large
fixture below; they do not promise unlimited export size.

The browser validates lines and stores raw received chunks, then creates a Blob once. Its memory grows
with the file, so the UI caps bytes and has a 150-second abort deadline. It checks the account visit
throughout transfer and rechecks the authenticated account after completion. Leaving Settings cancels
the request and revokes the Blob URL; an account change remounts the section. Nothing is retained in
React Query, IndexedDB or diagnostics.

Saving an already prepared file does not require a connection. The same account visit must still own
it; signing out or changing the account discards it. Preparation itself requires server access.

## Delivery and acceptance

Preparation and saving are separate user actions, preserving the user gesture needed by file sharing
on iPhone. A ready file has a download link and, when supported by `navigator.canShare({ files })`, a
system Share action. Canceling the share sheet retains Save. The UI reports preparation, not a false
claim that the OS has already saved the file. If a browser opens a preview, its Share menu is the
fallback. Physical installed-iPhone acceptance remains required; WebKit emulation cannot prove Files
integration, OS share-sheet behavior, background suspension or device memory use.

1. On the installed HTTPS iPhone PWA, open Settings and prepare a populated account export.
2. Keep Settings open until ready; use Share file > Save to Files. Confirm filename and nonzero size in
   Files; transfer it to a desktop and validate the manifest, final completion and entity counts.
3. Repeat using Save file. If a preview opens, save through its Share menu. Cancel Share once and check
   that Save remains available; then save successfully.
4. Repeat with a large collection and Review history. Check responsiveness and whether iOS suspends or
   terminates the app. Such interruption must require a new preparation and never offer a partial file.
5. Interrupt the connection, cancel preparation and retry. Navigate away while preparing, then return.
   Sign out or expire the session during preparation; no ready file may cross into another account.
6. Save an offline edit or Import draft, then export existing server data after reconnecting without
   delivering that work. Confirm the scope warning and absence of those local-only contents.

## Verification record

Targeted real PostgreSQL fixtures cover empty/populated accounts, all Note types, four vocabulary
directions and multiple Cloze slots, Reviews/Undo/Restart, captured historical state, deletion/purge,
Practice replacement versions, imports, presets, preferences, ownership predicates and restricted roles.
Concurrent writes between manifest and table reads prove one snapshot. Interrupted/oversized deliveries
cannot complete, and read-only checks compare learning state before and after.

On merged triage `main` (`893a49c`): 102 targeted PostgreSQL/route/format/isolation/rate-limit tests passed.
The built-app browser gate passed 36 scenarios across Chromium desktop/phone and iPhone WebKit,
including saving a prepared file after network loss. Eight affected Settings baselines were updated
and visually inspected. Typecheck, lint, build and format checks passed. Hosted Vercel streaming and
physical-iPhone acceptance are not claimed by these local results.

Representative large fixture: 5,000 Notes, 20,000 Cards, 100,000 stored Reviews. Local-to-Neon measurements:
66.3 to 66.4 MB (63.3 MiB), 39.2 to 54.3 seconds generation across three runs, process RSS peaks 238 to
257 MiB (104 to 124 MiB growth). The final run on merged triage schema generated 66,388,021 bytes in
54.3 seconds with a 238 MiB peak (108 MiB growth), alongside other checks.
This includes the streaming validator and driver in a test process; it is not a Vercel production or
physical-iPhone memory measurement. The server callback does not retain archive lines.

Run the focused archive, PostgreSQL and browser suites:

```sh
pnpm exec vitest run --project api src/routes/account-export.test.ts src/db/isolation.test.ts src/rate-limit.test.ts --project shared src/account-export.test.ts
pnpm --filter @neuron/web test:screens:ci --config=playwright.export.config.ts --project=webkit-phone-interaction
```

The export-specific browser configuration adds iPhone WebKit and keeps the existing shared browser
configuration intact. Routed browser tests verify exact downloaded bytes/name, large delivery, busy,
cancellation/retry, expired/wrong account, malformed/truncated/error streams and Share cancellation.
System file-sharing calls are mocked; actual Files acceptance follows the steps above.

## Phase 9 integration boundary

The current Learning Waves implementation (`work/learning-waves`, inspected at `53facdb`) derives wave
membership and admission ranks without new persisted wave records. Export preserves the Notes, status,
triage, IDs and independent Card histories it uses; it does not manufacture historical wave membership.
PR #69's stored `notes.triage` is included. Final integration must rerun the schema coverage test if
Learning Waves gains any additional persisted fields/tables. Export does not modify Study admission,
triage decisions, FSRS, Review transport, offline delivery or migration policy.
