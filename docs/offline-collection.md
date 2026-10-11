# Local-first collection reads and durable offline renames

Phase 8.1 adds a device cache for reading a previously downloaded collection. Online CRUD, scheduling,
Study, Practice and Import still use their existing server endpoints and reconciliation. Offline reads
reuse Library hierarchy rows, inline nested expansion, Deck headers/breadcrumbs, search/sorting/filtering
and virtualized Note rows. Phase 8.2 displays completed local content while authoritative reads continue,
and permits renaming existing Folders/Decks offline. Note details share their header and conditional field
presentation with the editor through a reading component with no autosave controller. Study, Practice,
Note editing/creation, Card generation, restoration and Import application remain online-only. Remote Note media is not
downloaded; its stored reference remains readable.

## Storage and initial download

`neuron.collection:<account id>` is an IndexedDB database at schema version 2; snapshot format remains 1.
Upgrade adds missing stores without recreating existing stores or clearing records. The `meta` store holds a
validated, non-secret account presentation and `{ format, cursor, complete, outboxVersion? }`. The six entity stores
retain each full sync envelope, including tombstones and `purged`, and its original server row:
`decks`, `notes`, `cards`, `studyPresets`, `importBatches`, and `reviews`. Cards retain server schedules,
reset boundaries and placed due dates; Review events retain their immutable history fields. No local
schedule, Review or Practice command is created. The added `outbox` store retains rename commands and
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
tombstones filter the read view. Offline due counts and local Study readiness are not presented.

## First-entry browsing

Router module/data preloading remains unchanged. A collection GET can publish a provisional local answer
into its existing React Query entry while the original server request continues. The local answer is
marked as local; it never validates an account or establishes server freshness. Note reading mounts no
autosave until its authoritative detail arrives. Study readiness, Practice progress and scheduling stay
server-owned; their requests do not block the Note list. Existing optimistic data is not replaced by a
local seed, and authoritative responses still reconcile it through the existing query.

Provenance, connectivity and session authority are separate. While online, provisional Deck content
uses the normal header, toolbar, search/filter rows and Practice card. Server-dependent controls keep
their positions and remain disabled until the account and required data are authoritative. A local
seed never enables an editor, a destructive action, Study planning or a Practice pool. The normal
Deck layout contains no offline explanation; actual offline status stays beside navigation, with
readiness and recovery details in Settings. In-session offline handover still retains occupied control
space and permits durable existing Folder/Deck renames.

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

Local storage remembers only the selected account ID and a local sign-out marker. Account metadata
comes from that account's database. A failed account-validation request may permit this remembered account to
read the local snapshot; it never establishes a newly validated server session. Settings explains
this distinction. Reconnection validates `/account` before online controls return or another
pull begins. Authentication rejection revokes local access and returns to sign-in. Account switching
cancels the previous visit's reads/pull and clears collection query entries before the next collection
is exposed. Late account responses and pulls cannot re-enable an ended visit.

Offline events and unreachable account requests enter local access. Collection GET transport
failures also request a single shared `/account` validation attempt. This detects genuine transport
loss when `navigator.onLine` remains true. A reachable account endpoint leaves an isolated failed
read in its existing retry/error flow. HTTP refusals and aborted reads never initiate this probe.
Interrupted response bodies follow the same transport classification as failed fetches.
An isolated failed sync pull while the browser remains connected preserves online screens and records
a stable download failure. An isolated failed online mutation retains its existing error/retry flow. Reconnection, window focus and Settings' Check connection
Retry action request fresh server account validation; an unsuccessful attempt remains read-only.
Account and connectivity generations guard stale deliveries. The handover cancels pending reads and
invalidates active collection observers without removing cached query entries or remounting Library
and Deck screens. Complete snapshot reads replace those entries locally. Local capabilities permit only
existing Folder/Deck rename; drag/drop, selection mutations, direct/swipe deletion and learning entry controls unmount;
control slots retain their measured space during the current visit. Search covers stored fields and
tags; status, Card state, source, tag and supported sort filters use saved facts. Server-only due
counts, Study readiness and Practice progress are hidden. Unreadable local snapshots revoke cache
availability rather than presenting stale online rows as completed offline data.

Explicit sign-out revokes access before remote transport, clears the selected account, and blocks
automatic reuse of a still-valid cookie until explicit successful authentication. This also applies
to offline sign-out, which cannot revoke a server session until networking is available. Storage
events revoke other open tabs. The account databases may remain on the device, but the ordinary UI
cannot select them after sign-out or use a prior account's query cache. Account deletion also revokes
the local visit. Cookies, passwords, tokens, recovery codes and session secrets are never persisted in
IndexedDB or service-worker caches.

## Application shell and recovery

Each production build emits `/sw.js` with a unique version and an allowlist of its HTML, emitted
chunks/styles, manifest and install icons. Install precaches the entire allowlist as one successful
installation; failure discards the incomplete shell cache. Navigations use that version's cached HTML
and assets. Non-GET requests, other origins, and every `/api` request bypass caching. Updates do not
call `skipWaiting` or `clients.claim`: existing windows keep their matching shell, and a waiting
update asks the learner to close all Neuron windows and reopen online. Activation removes obsolete
shell caches only after the old worker has no active clients.

Collection completeness and shell readiness are separate. Initial downloading and successful background
sync are silent outside Settings. Settings' compact Offline access section reports readiness, unfinished
downloads, failures and shell/update guidance. It offers Retry from the durable cursor and Rebuild
behind deliberate confirmation for storage, transaction or recovery failures. Network and response
validation failures offer Retry without unnecessary cache deletion. A read-only connection indicator is positioned outside content flow
beside navigation; no status is inserted before any screen header. Download state changes never key or
remount online screens. A completed snapshot remains readable if incremental synchronization fails.
Database open and
transaction operations have bounded failure handling. Blocked/disabled storage, quota errors, unknown
formats, future database versions and eviction retain ordinary online browsing. A rename cannot proceed
when saved work cannot be checked safely. Recovery clears authoritative entity stores and sync metadata
from revision zero in one transaction with the outbox check; it never deletes the database or outbox.
Any pending, conflicted, rejected or unknown operation blocks Rebuild. An unreadable or future database
also blocks destructive recovery. Synchronized receipts and explicit resolution archives survive a safe
rebuild. Missing metadata never means a complete empty collection. Device storage is not a backup:
browser eviction can remove unsynchronized work. Settings distinguishes saved locally from synchronized
and offers copying a saved name separately.

Failure diagnostics distinguish network/API transport, malformed protocol/boundaries, row schema,
database open/read, transaction commit and explicit recovery. Only fixed error codes, entity names and
known top-level schema fields are recorded; no row values, IDs, account identifiers, tokens or arbitrary
exception messages enter diagnostics. A failed Rebuild is handled as recovery failure, never success.

## Durable rename delivery

An offline rename saves an immutable command `{ accountId, operationId, baseRev, name }`, target identity
and full originally observed server row in the account's outbox. The command record is also the local
name overlay: intent and visible local state commit atomically with an outbox-version advance. A dialog
retains its original observed revision even if a background pull updates the device while it is open.
Failed quota/transaction commits roll back the optimistic name; a second pending rename for the same
entity is refused until delivery/recovery. Existing online rename uses its existing PATCH contract and
optimistic projection, including the confirmed revision, and cannot overwrite a known pending rename.

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

## Verification and later writes

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
Phase 8.2 first-entry latency, persisted rename, authenticated reconnect and conflict recovery require
new physical-iPhone acceptance.

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

Offline Note editing/creation and Card generation still need atomic shared planning/identity contracts.
Local Study admission, scheduling/replay and Review/Undo delivery need separate ownership and failure
verification; persistent Practice transport and offline Import application are also absent. Current
server authorization, immutable Review semantics and deletion/restoration ownership remain authoritative.
