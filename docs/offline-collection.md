# Local-first collection reads and durable offline editing

Phase 8.1 adds a device cache for reading a previously downloaded collection. Online CRUD, scheduling,
Study, Practice and Import retain their existing server endpoints and reconciliation. Offline reads
reuse Library hierarchy rows, inline nested expansion, Deck headers/breadcrumbs, search/sorting/filtering
and virtualized Note rows. Phase 8.2 displays completed local content while authoritative reads continue,
and permits renaming existing Folders/Decks offline. Phase 8.3 uses the familiar Note Editor for existing
Notes online and offline, with durable content drafts and safe authenticated delivery. Phase 8.5 adds
qualified local Study planning as described in `offline-study.md`. Phase 8.7 runs Practice from the
download with durable delivery (see Offline Practice below). Note creation, type conversion, moves, deletion/restoration, explicit direction changes and Import application remain online-only. Remote Note media is not
downloaded; its stored reference remains readable.

## Storage and initial download

`neuron.collection:<account id>` is an IndexedDB database at schema version 3; snapshot format remains 1.
The v2 to v3 upgrade adds only `review-outbox` and its state index. It does not recreate existing
stores or rewrite collection rows, pending Note/name work, receipts, archives or the cursor. An
interrupted upgrade aborts atomically; opening failures expose recovery without deleting stored work.
Upgrade adds missing stores without recreating existing stores or clearing records. The `meta` store holds a
validated, non-secret account presentation and `{ format, cursor, complete, outboxVersion? }`. The six entity stores
retain each full sync envelope, including tombstones and `purged`, and its original server row:
`decks`, `notes`, `cards`, `studyPresets`, `importBatches`, and `reviews`. Cards retain server schedules,
reset boundaries and placed due dates; Review events retain their immutable history fields. Entity stores
keep server rows; local Study schedule projections remain read-only. Committed Review/Undo intents use
the separate `review-outbox`, with no local Card creation. Practice keeps one record per Deck in `meta`. The `outbox` store retains rename and Note-edit commands and
their original server rows, delivery outcomes and explicit resolution archives. Revision indexes are present on each
entity store, with Deck indexes for Notes/Cards and Note/Card indexes for Cards/Reviews.

The client uses authenticated `GET /sync?since=<cursor>&limit=200`. A server transaction can exceed
the requested page size because a pull must retain its complete revision boundary. Note pull rows now
also include their type name; the original `noteTypeId` remains intact. The browser validates page
envelopes and live collection row shapes before writing. A readwrite transaction spanning metadata and
all entity stores checks the expected cursor, applies the whole page, and advances the cursor together.
Transaction abort, storage failure or interruption leaves the previous committed cursor and rows.
Competing tabs serialize through IndexedDB; old deliveries cannot regress rows or completeness, and a
competing cursor advance causes a fresh pull from the durable cursor.

Persisted IDs follow canonical PostgreSQL UUID syntax, not exclusively RFC version/variant rules.
Migration 0012 cast an unmodified MD5 digest to UUID for legacy leaf Decks. These identities and every
reference to them remain unchanged; the shared identifier schema accepts their validated hex format.
RFC-only `z.uuid()` rejected these real sync rows before persistence, while UUIDv7-only fixtures passed.
Rebuilding IndexedDB could never fix that response-validation defect.

`complete` becomes true only when a final pull page commits. It is independent of the `/account`
revision and the ordinary online `/decks` and `/notes` queries. A partial snapshot is never mounted as
an offline collection. Subsequent pulls retain completeness while applying newer complete boundaries.
Pulls start on first server account validation and reconnection. Repeated same-account validation
joins the existing visit without queuing more pulls. Focus and acknowledged writes reconcile healthy
snapshots; a failed download remains stable until explicit Retry, reload or real reconnection.
Online pulls update durable storage without replacing existing optimistic React Query projections.
Local reads use the existing collection query keys and shared domain schemas; live ancestry and
tombstones filter the read view. Browse-derived due counts never authorize Study. Phase 8.5 uses a
separate validated complete-snapshot planning path, not the provisional browse projection.

## First-entry browsing

Router module/data preloading remains unchanged. A collection GET can publish a provisional local answer
into its existing React Query entry while the original server request continues. The local answer is
marked as local; it never validates an account or establishes server freshness. Note reading mounts no
autosave until its authoritative detail arrives. Server scheduling and Practice progress retain their
authority; qualified offline Study uses the dedicated planning path. These requests do not block the
Note list. Existing optimistic data is not replaced by a
local seed, and authoritative responses still reconcile it through the existing query.

Provenance, connectivity and session authority are separate. Phase 8.6 keeps the normal Shell route,
Library menus/handles, Deck selection/search/filter controls and Settings mounted across connectivity
changes. `lib/capabilities.ts` derives completed local access and validated server authority from the
existing account state; entity provenance remains an additional server-operation gate. Its local
Study capability only permits asking the existing planner, which still owns history/settings admission.
Remembered identity or local query data never grants server write or delivery authority.

Unavailable server controls retain their layout and discoverability. A deliberate action explains the
connection requirement; controls announce restrictions accessibly. Open dialogs retain their drafts,
with authority checked again before submission. Selection itself is local presentation, while its bulk
mutations remain server-only. Practice keeps its ordinary labels and presentation; classification,
restart and Undo save on the device and are delivered later.
The normal Deck layout contains no persistent offline explanation. Connection status stays beside
navigation, with readiness and recovery in Settings. Explicit rejection, sign-out and account switching
still revoke access through the existing account boundary.

Provisional query publication uses a zero freshness timestamp. If navigation cancels the original
request, returning retries server authority instead of treating local content as a fresh online answer.
Cached query answers skip local snapshot work altogether; a late local result cannot publish after
the authoritative request settles. Ordinary repeated account validation publishes no unchanged global
state snapshot.

The derived projection is shared by account visit, durable cursor, completeness and outbox version.
One consistent IndexedDB snapshot scan and shared-schema validation supplies local browse queries
at that revision. A new committed revision or outbox state invalidates this projection; sign-out/account
switches clear it. It is not a second persisted collection. Per-Deck Note counts use one pass rather than
filtering all Notes separately for each Deck. Ordinary hierarchy and Note-list browsing does not clone
or validate unused Cards. Detail and Card-state reads upgrade the single cached projection from a
consistent snapshot that includes Cards; Card validation remains on that read boundary. Large Note/
Card validation yields between bounded batches to let input and paint proceed. Local list pages match
the server's 1,000-row page size; next-page reads wait for reconciliation and cannot cancel its first page.
DOM virtualization, search/filter semantics and scroll restoration remain intact.

The Phase 8.1 first-entry network path awaited the Notes API. Transport failure then awaited a shared
account probe before reading IndexedDB. Consequently a slow/dead Notes request and its authentication
probe could form a serial delay even with a completed download. Phase 8.2 makes local content usable
during both requests while retaining their authority and outage classification. Slow responses or an
isolated HTTP error still do not change connectivity or permission state.

## Account boundaries

Local storage remembers the selected account ID and a local sign-out marker. Account metadata comes
from that account's database. Startup restores this presentation alongside server validation, without
waiting for HTTP rejection or trusting `navigator.onLine`. The local read is bound to the account visit,
context and sign-out marker, and coalesced across repeated lifecycle events. Successful server validation
supersedes a late local result. Local presentation can read the completed snapshot; it never establishes
a newly validated server session. Settings explains
this distinction. Reconnection validates `/account` before online controls return or another
pull begins. Authentication rejection revokes local access and returns to sign-in. Account switching
cancels the previous visit's reads/pull and clears collection query entries before the next collection
is exposed. Late account responses and pulls cannot re-enable an ended visit.

Offline events and confirmed transport failure enter local access. Collection GET transport
failures request a shared `/account` validation. A single failed account probe does not demote an
already validated visit unless other transport evidence supports loss. Healthy navigation/foreground
reuses API progress from the last fifteen seconds. Pending HTTP requests can join a passive check
after 1.5 seconds; that check alone never changes presentation. With no successful API progress,
active HTTP permits local access at three seconds; standalone account validation permits it at four.
This temporary server uncertainty does not assert a disconnected network or display the global Offline label. The
original account request remains eligible and ends at eight seconds if still suspended. A successful
response before that bound restores matching authority automatically. Local startup is independent
of these deadlines. Neither silence nor local identity authenticates a protected write or outbox.
A healthy account endpoint leaves an isolated failed read in its existing retry/error flow. Server
errors from GETs or the read-only Study planner request one bounded account verification; client
errors and aborted reads do not. An unavailable account endpoint corroborating that server error
permits local browsing and qualified Study under server uncertainty, while network reachability
remains distinct. One failed endpoint alone never establishes a global disconnection.
Interrupted response bodies follow the same transport classification as failed fetches.
An isolated failed sync pull while the browser remains connected preserves online screens and records
a stable download failure. An isolated failed online mutation retains its existing error/retry flow. Reconnection, window focus and Settings' Check connection
Retry action request fresh server account validation; transport failure retains local capabilities,
while authentication rejection revokes access.
Account and validation generations guard stale deliveries. Sign-out, session rejection and account
switching revoke the visit before late responses can publish. A repeated browser loss hint does not
cancel useful authenticated validation; a matching successful server response can correct the hint.
Foreground events and repeated Check connection taps join that request. Settings shows an understated
busy control. Local mode retries automatically with bounded backoff (1.5, 3, 8, 15, then 30 seconds),
pausing probes while hidden; observed server progress requests immediate validation. Ordinary healthy
navigation adds no probe or collection scan. The handover cancels pending reads and
invalidates active collection observers without removing cached query entries or remounting Library
and Deck screens. Complete snapshot reads replace those entries locally. Local capabilities permit only
existing Folder/Deck rename, durable existing-Note content editing, qualified offline Study, Practice and Import
preparation with local drafts;
drag/drop, selection mutations, direct/swipe deletion, Note creation and Import application
remain unavailable. Browsing completeness and learning-history readiness are separate Settings states.
Control regions show deliberate unavailable states during the current visit and on re-entry.
Search covers stored fields and
tags; status, Card state, source, tag and supported sort filters use saved facts. Unavailable server-only due
counts use an unknown value; local Study readiness comes only from the qualified planner. The Practice
entry shows this device's saved progress. Unreadable local snapshots revoke cache
availability rather than presenting stale online rows as completed offline data.

Explicit sign-out revokes access before remote transport, clears the selected account, and blocks
automatic reuse of a still-valid cookie until explicit successful authentication. This also applies
to offline sign-out, which cannot revoke a server session until networking is available. Storage
events revoke other open tabs. The account databases may remain on the device, but the ordinary UI
cannot select them after sign-out or use a prior account's query cache. Account deletion also revokes
the local visit. Cookies, passwords, tokens, recovery codes and session secrets are never persisted in
IndexedDB or service-worker caches.

## Offline Import preparation

Import uses its existing source, mapping, diagnostics and generated-card preview offline. JSON, CSV,
TSV, plain text and Anki text still use the shared parser and the three existing Note types. File
selection retains its 10 MiB limit; a preview draws at most 200 rows while counting the entire source.
The normal Import entry in a Deck remains available offline. Preparation can also be parsed before a
destination is selected. It creates no Notes or Cards and queues no entity mutations.

Account-local drafts retain the raw source, unadded single-row fields, destination, source mode/format,
Note type, column mapping, duplicate defaults and row choices, and source/preview position. Changes
autosave; Save draft commits explicitly. Saved drafts reopen in Import, including after a cached PWA
restart. They are preparation data, separate from Settings' synchronization outboxes. A source-copy
download provides a recovery option when saving fails. Browser storage eviction can still remove local
work; device storage is not a backup.

`features/import/import-drafts.ts` stores version-1 envelopes under `import-draft:<id>` keys in the
existing account database's `meta` store, with `import-draft-current` retaining the last selected draft.
No shared collection schema change or Offline Practice persistence integration is required. Compatible additive upgrades
and collection rebuilds preserve these keys. Unknown draft formats and unreadable storage fail closed
without deleting existing records. Account and visit checks guard reads, writes and late results;
sign-out, session rejection and account switching revoke access while retaining the originating data.
Compare-and-save revisions prevent a stale tab from replacing another tab's saved work. A conflicting
preparation can be retained as a separate draft.

Duplicate matches from a complete downloaded collection are explicitly preliminary. Incomplete or
unreadable collection data produces an unchecked state rather than an empty confirmed result. On
reconnection, current server duplicate lookup replaces preliminary results. Each new application checks
again immediately before freezing its plan; changed matches return to preview for review. Duplicate
choices never authorize offline application. Server endpoints still validate destination, Note fields,
duplicate merge behavior and every applied chunk.

Before the first online write, the draft commits a frozen delivery checkpoint with its original batch
and Note IDs. Each acknowledged 500-row chunk advances the checkpoint. A reopened interrupted import
offers explicit online resume using those same IDs, including after a lost response. Resuming a frozen
delivery retains its original duplicate decisions; it does not replan already-applied rows as new
duplicates. The completed summary retains access to the existing server-confirmed Undo flow. Merges
still fill blanks and remain outside the undoable additions batch.

A failed storage transaction retains the previous committed draft and the current visible input.
In-app navigation waits for the latest save and stays on the form if it fails. Pending changes request
the browser's normal unload protection, and background/page-hide events attempt a flush. Application
and delivery stop if a checkpoint cannot commit, including when persistence is disabled. Parsing and
preview remain usable. Forced process termination before a save completes cannot guarantee the latest
keystroke survives.

`import.spec.ts` covers all formats, Note types, invalid/incomplete input, 5,000-row files, local
duplicate uncertainty, server rechecks, durable navigation/reload, account switching and sign-out,
quota/disabled storage, competing tabs, compatible upgrades, interrupted delivery and Undo. Its real
HTTP-origin shutdown test closes and reopens the cached PWA offline. Browser evidence does not replace
installed-iPhone acceptance of saving, reopening and reconnecting.

## Application shell and recovery

Each production build emits `/sw.js` with a unique version and an allowlist of its HTML, emitted
chunks/styles, manifest and install icons. Install precaches the entire allowlist as one successful
installation; failure discards the incomplete shell cache. Navigations use that version's cached HTML
and assets. Non-GET requests, other origins, and every `/api` request bypass caching. Updates do not
call `skipWaiting` or `clients.claim`: existing windows keep their matching shell, and a waiting
update asks the learner to close all Neuron windows and reopen online. Activation removes obsolete
shell caches only after the old worker has no active clients.

Collection completeness and shell readiness are separate. Initial downloading and successful background
sync are silent outside Settings. Settings' compact Offline & sync section reports readiness, unfinished
downloads, failures and shell/update guidance. It offers Retry from the durable cursor and Rebuild
behind deliberate confirmation for storage, transaction or recovery failures. Network and response
validation failures offer Retry without unnecessary cache deletion. A read-only connection indicator is positioned outside content flow
beside navigation; no status is inserted before any screen header. Download state changes never key or
remount online screens. A completed snapshot remains readable if incremental synchronization fails.
Database open and
transaction operations have bounded failure handling. Blocked/disabled storage, quota errors, unknown
formats, future database versions and eviction retain ordinary online browsing. A rename or local Note save cannot proceed
when saved work cannot be checked safely. Recovery clears authoritative entity stores and sync metadata
from revision zero in one transaction with the outbox check; it never deletes the database or outbox.
Any pending, conflicted, rejected or unknown operation blocks Rebuild. An unreadable or future database
also blocks destructive recovery. Synchronized receipts and explicit resolution archives survive a safe
rebuild. Missing metadata never means a complete empty collection. Device storage is not a backup:
browser eviction can remove unsynchronized work. Settings distinguishes saved locally from synchronized
and offers copying saved names and Note versions separately.

Failure diagnostics distinguish network/API transport, malformed protocol/boundaries, row schema,
database open/read, transaction commit and explicit recovery. Only fixed error codes, entity names and
known top-level schema fields are recorded; no row values, IDs, account identifiers, tokens or arbitrary
exception messages enter diagnostics. A failed Rebuild is handled as recovery failure, never success.

## Durable rename delivery

A rename of a downloaded existing Folder/Deck saves an immutable command `{ accountId, operationId, baseRev, name }`, target identity
and full originally observed server row in the account's outbox. The command record is also the local
name overlay: intent and visible local state commit atomically with an outbox-version advance. A dialog
retains its original observed revision even if a background pull updates the device while it is open.
Failed quota/transaction commits roll back the optimistic name; a second pending rename for the same
entity is refused until delivery/recovery. A complete download uses this same durable path during online visits, including its observed server
revision, exact delivery and conflict recovery. Without a completed download, validated online rename
retains its existing PATCH contract and cannot overwrite a known pending rename.

Delivery requires freshly validated, matching-account authorization. Sign-out/account change cancels
delivery and removes UI access, retaining records in their originating database. Expired sessions,
network/storage failures, invalid acknowledgements and lost responses retain pending intent. Reconnection,
healthy focus, saved-work notifications and explicit Retry resume delivery; no polling loop exists.
Every retry sends the same operation identity and payload. A durable applied acknowledgement moves the
operation to synchronized; it is not queued again. Until the authoritative row reaches the acknowledged
revision its name overlay remains visible. Other online fields keep their existing optimistic ownership.

`POST /decks/:id/rename` validates the shared command and matching authenticated account. Within the
existing account write lock and RLS transaction it compares the target's server revision with `baseRev`
and checks live ancestry. An unrelated account revision advance cannot cause an entity conflict. A live
match updates only the name and stamps a new server revision; a changed, deleted, purged or inaccessible
target produces a conflict without writing. Existing immutable `sync_receipts` hold the command digest
and original outcome atomically with the rename. Exact retries return that outcome even after later
edits/purge; altered payloads or targets under the same operation identity are rejected. Receipt metadata
contains no collection names or original row content. No SQL migration is needed.

Settings lists pending, synchronized, conflicting, rejected and archived saved names with the original
name/revision. A changed remote entity allows explicit application of the saved name to its freshly
pulled current version, creating a new operation and atomically archiving the original. Deleted/purged
targets are never automatically restored. Keeping the server version is explicit and archives rather
than discards the losing command/base. Rejected operations remain recoverable by copying/archiving;
transient delivery failures permit exact Retry. No device timestamp last-write-wins rule is used.

## Existing Note content edits

Phase 8.3 saves fields and tags for downloaded existing vocab, basic and cloze Notes. Text, translations,
definitions, examples, accepted answers, part of speech and compatible grammar/media-reference metadata
use the maintained field schemas and the same editor controls. Required-field gaps and excessive tags
remain durable raw drafts until valid. The slice does not download media or add offline creation,
conversion, moves, deletion/restoration, status/restart or explicit Card-direction operations.

After a complete snapshot is available, ordinary existing-Note saves use IndexedDB before transport,
including online visits. The existing 700ms typing debounce remains; navigation commits outstanding
local changes before unmounting, and page hiding attempts a flush. Only a completed storage transaction
claims a device save. Storage failure
retains the visible draft, reports failure and offers Retry; leaving a failed draft requires explicit
discard. Browser termination before a commit, eviction or cleared storage can still lose work. Device
storage is not a backup.

The unchanged schema-version-2 outbox adds `kind: note-edit`. One transaction retains the original
observed Note row/revision, stable operation ID, latest working fields/tags and delivery state.
Operations also have a transaction-allocated sequence, so clock correction and PWA reopening cannot
select an older UUID as the latest draft. This sequence is local metadata, outside the frozen command.
Unsent edits coalesce into that Note's latest draft; the original base never advances because of a background
pull. Before first delivery, `started` freezes the command durably. Further edits update only the working
draft. An applied acknowledgement atomically settles that command and queues any newer working draft
under a new identity based on the acknowledged revision and canonical fields/tags. Exact retries retain
the frozen ID and payload even if the server applied the first attempt without a received acknowledgement.
Retry waits for an outstanding attempt before making a fresh attempt. An acknowledged archive shows
the canonical fields/tags actually accepted; newer values belong to its successor. Old commands and resolution
archives remain recoverable; there is no automatic time-based overwrite of a competing server version.

`POST /notes/:id/offline-edit` accepts only account, operation ID, observed entity revision, fields and
tags. It checks matching authentication, RLS ownership and live ancestry inside the account write lock.
Unrelated account writes do not conflict. Shared validation and the normal history-aware Note/Card
planner run in that same transaction. Surviving Cards retain identities, schedules, suspension/reset
boundaries and immutable Reviews. Compatible new cloze slots use the established planner. **Any Card
removal is unsupported**, including unanswered or answered-then-reset Cards; no destructive-confirmation
override exists on this endpoint. Receipt insertion and Note/Card writes commit together. Immutable
`sync_receipts` contain a digest and original outcome, without Note content. Altered retry payloads are
rejected. No SQL migration is required.

Changed Notes and deleted/purged Notes or ancestors produce retained conflicts without restoring or
overwriting server data. Rejections and unsupported drafts never appear synchronized. Settings exposes
the local draft, original version and freshly fetched current server version with familiar field labels,
copy actions and explicit recovery. Applying a draft to a changed Note fetches its current revision,
refuses changed type/Deck scope and atomically archives the losing operation before creating a new
command. The server still rechecks revision and Card safety. Keeping the server version archives the
losing local draft and original base. Deleted targets have no apply/restore action. Draft fields remain
paired with their original type and Deck when reopening online or offline, including after a remote
conversion. Recovery explains changed type/Deck scope and refuses to apply across it. Explicitly keeping
the server version removes the inactive editor's cached draft overlay before its next visit.

An untouched or fully saved form can observe a newer server baseline only when its displayed type,
fields and tags match that row; older local snapshots cannot regress the observed revision. Explicit
online conversion adopts its acknowledged row. Online status changes fetch the Note's revision because
the bulk status acknowledgement contains only a count. These reads retain the mounted form. Pending
content always retains its original base.

The mounted editor owns its form state; reconciliation never resets fields, selection, focus or its
Note-ID key. Data provenance does not select another editor or replace the established screen layout.
Capabilities depend on connectivity, authenticated authority and unresolved work. Note events use a
separate channel, update one derived collection row and patch cached Note pages; they do not notify
global collection observers or reopen whole-collection stores while typing. Pages carrying local content
cannot seed authoritative learning pools. Rebuild continues to reject unresolved drafts, operations and
unreadable/future storage. Editor saves and delivery settlements check the original account visit;
sign-out, expiry and account switching revoke access and retain account-isolated pending work.

`offline-notes.spec.ts` covers untouched provisional data, mounted form/focus/caret/scroll/geometry,
zero extra Note/Card scans during typing and settlement, content/accepted-answer persistence, multiple
edits during a frozen delivery, conflicts, raw invalid drafts, quota failure during navigation, unreadable
upgraded storage, expiry, sign-out, account
switches during delivery, malformed/rejected acknowledgements, Card-removal refusal and blocked Rebuild.
It also preserves explicit online conversion confirmation and subsequent content editing after confirmed
conversion/status changes and a return to an older local snapshot.
Clock-correction/reopening coverage verifies that newer operations remain visible and deliverable even
when their UUID timestamps sort before earlier synchronized operations.
`collection-notes.test.ts` exercises real PostgreSQL/RLS, competing operations, exact immutable retries,
remote edits/deletion/purge/ancestry, validation, cloze additions and answered/reset history protection.
The live PWA journey also edits Notes across actual server loss and shell reopening, then reconciles
against real PostgreSQL with an applied acknowledgement lost deliberately.

Physical-iPhone Phase 8.3 acceptance remains separate: download completely; edit multiple fields offline;
wait for Saved on device (or Draft on device for invalid content); close/reopen the installed PWA;
verify both raw and valid drafts; reconnect while typing; test competing
remote edits and deletion; inspect recovery; expire/sign out/switch accounts and recover under the matching
account; verify keyboard, Today/Library navigation, Deck layout, Setup, swipe and security motion. Copy
important unsynchronized work before testing storage clearing. PR #49's physical acceptance remains valid
for the earlier browsing/rename/stabilization release.

## Offline Practice

Practice runs from the downloaded collection with the same screen online and offline. Its pool is the
Deck's live Notes in server order, read through the same local fallback as browsing. One record per
account and Deck lives in the existing `meta` store under `practice:<deckId>`: the last server state,
the commands not yet acknowledged on top of it, and the run the learner last saw. No IndexedDB version
change was needed; nothing enumerates `meta`, so earlier shells ignore the new keys, and a collection
rebuild clears only the downloaded rows. Each step is one strict read-decide-write transaction, and the
screen advances only after it commits, in the same task as the new card, so nothing in between is
painted. A write another tab made in between refuses the step and reloads. Unsent commands that earlier
versions kept in local storage move into the record once with their identities.

Commands are delivered oldest first, one at a time with the same identity, after Note edits and before
the pull, on reconnection, on foreground and after each step. Transport failures and lost answers retry
at 2, 5, 15, 30 and 60 seconds; an answer that arrived is recorded even if the connection dropped right
after it. A refusal is settled in one place, never discarded:

- this device's commands have no net effect (an answer and its Undo), or both devices reached the same
  progress: the server's run is adopted silently;
- the server moved but made no progress (another device's answer and Undo): the commands are sent once
  more, renumbered with new identities;
- otherwise the record keeps both runs and every refused command, and Practice asks once which run to
  continue. Keeping this device's sends one `replace`; keeping the other adopts it. Either way the
  losing run is archived on the device, and a replaced server run is also kept in `sync_conflicts`.

Progress is compared over the Notes both runs still hold, so content changed on one side is not a
conflict. A Deck that is gone keeps its saved Practice with the reason; Settings > Offline & sync offers
to discard it. Delivery requires the validated, matching account; sign-out, account change and expired
sessions stop it and leave records in their account's database. When the device database cannot be
opened, Practice keeps working online from memory and refuses steps once the server is away, with a
plain message. Pending Practice counts in the Offline & sync status, one per Deck.

## Verification and later writes

Phase 8.3 release verification on Windows passed 1,088 unit/PostgreSQL tests across 98 files, including
the eight real Note-edit/RLS cases; all package typechecks, source lint, isolation/design checks,
formatting and the production web build also passed. The built one-worker phone/desktop interaction gate
passed 520 cases with four opt-in database journeys and two WebKit-only touch cases skipped by that
selection. All 66 unchanged visual cases and all five enforced 55 FPS performance cases at 4× CPU passed.
The dedicated existing-Note suite passed all 36 Chromium/mobile WebKit cases.
The two real offline/PWA HTTP/PostgreSQL journeys and the two real learning journeys passed separately
in Chromium and mobile WebKit. Live fixtures wait for the initial HTTP pull and failed account request
before asserting client progress; their cursor, payload, receipt and five-second UI assertions remain intact.
All 62 affected mobile WebKit offline cases and the committed touch-swipe regression passed. This is
targeted coverage, not a rerun or clearance of the historical extended WebKit drag finding.

`offline-live.spec.ts` is opt-in with `CI=true OFFLINE_DATABASE_E2E=true` and the guarded
`DATABASE_URL_TEST`. It uses actual HTTP, authenticated collection routes and restricted-role
PostgreSQL/RLS; only session lookup is substituted. Representative persisted data includes a migration
0012 Deck identity and references, nullable fields, all six entities, Review/Undo history, soft-delete
and purged tombstones, cloze Cards and revision-boundary pagination. It compares every persisted
envelope and the final cursor with real pulls, interrupts/resumes, deliberately rebuilds corrupted
metadata, and stops the HTTP server while a Deck is open to prove local continuity without reload
despite online browser hints. It renames offline, reloads/reopens the cached shell, then reconnects to
real HTTP/PostgreSQL, loses an applied acknowledgement and retries the identical command. It also
reconciles updates and switches accounts. It runs in Chromium and phone-sized WebKit.
No production account contents are used.

The separate fixture browser suite exercises complete hydration, offline hierarchy/Note reads, actual server shutdown
followed by shell reload and a reopened page, waiting worker updates during an active visit, incremental
tombstones, interrupted pages, transaction abort, competing/duplicate tab delivery and stale final-page
completeness, quota and unavailable storage, local format/database version
recovery, sign-out, account switching, cross-tab revocation and expired-session rejection. The shell
test uses a disposable HTTP origin rather than worker-intercepted API fixtures; ordinary interaction
fixtures block workers and warm the built module graph before browser network emulation; they do not
prove service-worker delivery. Additional fixture regressions cover in-session Library/Deck continuity,
online browser hints during genuine transport loss, nested expansion/search/details, exact header/row
geometry and scroll retention, missing snapshots, false outage prevention and delayed account validation.
Chromium and WebKit provide browser evidence. PR #47 merged at `e63c64d`; the owner accepted installed
iPhone offline reopening, Library/Deck/Note browsing, parity and in-session connectivity transitions.
Phase 8.2 and its stabilization through PR #49 are merged and accepted on the physical iPhone.

`offline-renames.spec.ts` covers persistence, exact lost-ack retries, original dialog revisions, conflicts,
rejections, session expiry, cross-account isolation, explicit sign-out, quota/transaction abort and safe
upgrade/recovery. Real PostgreSQL tests cover same-operation concurrency, altered retries, RLS,
entity-specific revisions, remote rename/deletion/parent purge and immutable receipts. Latency fixtures
compare previously unvisited and warm Deck entry with 5,000 downloaded Notes under fast, delayed,
unavailable and interrupted API responses; artifacts measure time until Notes are usable.

The matched built-app runs on Windows (phone viewport; 5,000 Notes downloaded through normal complete
revision pages) measured the following milliseconds until the first usable Note. These are browser
fixtures, not production or physical-iPhone timings. Each Deck was previously unvisited in that visit;
warm entry immediately reopened the same Deck.

| Browser / response                                           | Phase 8.1 cold / warm | Phase 8.2 cold / warm |
| ------------------------------------------------------------ | --------------------- | --------------------- |
| Chromium / fast                                              | 150 / 104             | 146 / 107             |
| Chromium / delayed 1.8 s                                     | 2451 / 107            | 106 / 105             |
| Chromium / unavailable (2.5 s failure + 2.5 s account probe) | 5448 / 104            | 105 / 106             |
| Chromium / interrupted browser networking                    | 284 / 102             | 111 / 102             |
| WebKit / fast                                                | 285 / 203             | 301 / 187             |
| WebKit / delayed 1.8 s                                       | 2104 / 183            | 219 / 169             |
| WebKit / unavailable                                         | 2570 / 141            | 221 / 168             |
| WebKit / interrupted browser networking                      | 436 / 167             | 236 / 165             |

The unavailable WebKit baseline can overlap account revalidation because its initial download takes
longer; it does not imply that its account probe always follows the Notes failure serially. Instrumented
Chromium navigation scanned each of the decks/notes/cards stores at most once across cold and warm
entry. The delayed/unavailable fixtures also require visible Notes before the Notes response finishes.
An existing synthetic initial-download limit remains separate: a single 5,000-row revision exceeded the
bounded transaction window in Windows WebKit. Normal paginated hydration and browsing of a completed
large download passed. This pass does not weaken revision atomicity or promise eviction protection.

Controlled built-app performance retained 14 mounted rows for 5,000 Notes and measured 60.0 FPS
at 4× CPU slowdown. The 500-row Library cases measured 59.0–59.7 FPS against the unchanged 55 FPS
budget. The full serial phone/desktop interaction gate passed 472 tests with six opt-in live tests
skipped; the offline live PostgreSQL/browser path was separately run in Chromium and WebKit.
All 66 Windows visual cases passed, with the gallery rerun after a Chromium resource-loading failure.

Offline Note creation and its initial Card identity mapping remain later work.
Phase 8.5 adds qualified local Study admission and retains [durable Review/Undo transport](offline-study.md);
offline Import application remains absent. Current
server authorization, immutable Review semantics and deletion/restoration ownership remain authoritative.

## Phase 8.4 production stabilization

PR #51 merged at `b8dae4d`, but installed-iPhone offline acceptance failed. A built-app reproduction
keeps `/account` validation pending while connectivity is lost: the collection and remembered account
remain intact, but the session gate never receives the remembered presentation. Previously restoration
ran only after the fetch rejected. Known offline startup now reads the remembered account directly,
and a loss event restores the account independently of that request. The Phase 8.5 acceptance repair
keeps useful validation eligible through browser loss hints, without delaying local restoration.
Connection/account epochs prevent a late local read from replacing fresh validation or another account.
Remembered presentation remains unvalidated; authenticated matching-account acceptance still owns
reconnection and delivery. Focus, foreground visibility and restored-page events resume reconciliation.

The real prior PR #50 shell update and v2 to v3 database upgrade pass in Chromium and mobile WebKit.
A separate built-worker cold-launch test seeds all prior entity stores, pending Note/name commands and
a resolved recovery archive at v2, stops the HTTP origin, and upgrades offline. It compares every key
and value, including metadata/cursor, before and after. Aborting the upgrade retains the complete v2
database, displays actionable storage recovery, and permits Retry without rebuilding or clearing it.
This establishes browser behavior; it does not identify the owner's precise network-event sequence
or replace installed-iPhone acceptance of the updated production PWA.

## Retained lifecycle diagnostics

The shell records fixed stage names before application modules execute. The application records account
validation, local restoration, collection reads, foreground events and gate readiness. Records contain
only a launch timestamp, elapsed milliseconds and the browser connectivity hint. They contain no account
identifiers, URLs, collection content, operation payloads, errors, credentials or session material.
The current launch retains up to forty records, including its first eight stages, recent failure stages
and latest events; up to eighty records from preceding launches stay intact during recovery. Nothing is uploaded automatically.

Settings > Offline & sync > Save startup diagnostics exports the sanitized records. The same action is
available on a failed startup screen. After a native black-screen failure, reopen online and export before
additional launches; no cache clearing or reinstallation is needed. A shell record without a module record
points to module loading; restore-start without restore-ready points to local storage; account-start with
account-deadline identifies stalled validation. Read-ready and gate-ready are data/render milestones,
not a substitute for the owner timing when the collection becomes visibly usable.
Connection-check-start/end, connection-silence, connection-server-error, connection-unreachable and connection-recheck retain
the distinction and timing of validation, temporary uncertainty, observed loss and automatic recovery.

A browser that neither reports a loss nor performs any request exposes no immediate evidence of an idle
outage. Offline events revoke authority immediately; foreground, cached navigation and stalled HTTP work detect
stale online hints. Native installed-iPhone event ordering, storage scheduling and compositor behavior remain owner
acceptance boundaries.

## Phase 8.6 installed-iPhone acceptance

Browser evidence remains separate from installed-device acceptance. With a completed download and
existing pending work retained:

1. Expand Folders and leave a menu or rename dialog open. Repeat short outages, slow successful
   reconnection and background/foreground events. Check the same row/header positions, expansion,
   draft, focus and scroll without disappearing controls or an unrelated replacement screen.
2. Keep a Deck search/filter or selection active through those events. Try an unavailable create,
   delete, move or Practice action; check the contextual explanation and absence of a completed write.
3. Cold-reopen offline into the normal Library, Note, Today and Settings interfaces. Verify compact
   synchronization/readiness, discoverable details and visible unresolved work. Check qualified local
   Study, local answer/Undo saving and later authoritative reconciliation.
4. Reject the session or switch accounts and verify immediate access revocation, retained recovery
   records and no delivery through remembered identity. Restore matching authentication to recover.
