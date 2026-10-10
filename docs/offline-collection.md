# Durable offline collection reads

Phase 8.1 adds a device cache for reading a previously downloaded collection. Online CRUD, scheduling,
Study, Practice and Import still use their existing server endpoints and reconciliation. Offline views
offer Folder and Deck navigation, a searchable paged Note list, and read-only Note details. Study,
Practice, editing, restoration and Import application remain online-only. Remote Note media is not
downloaded; its stored reference remains readable.

## Storage and initial download

`neuron.collection:<account id>` is an IndexedDB database at schema version 1. The `meta` store holds a
validated, non-secret account presentation and `{ format, cursor, complete }`. The six entity stores
retain each full sync envelope, including tombstones and `purged`, and its original server row:
`decks`, `notes`, `cards`, `studyPresets`, `importBatches`, and `reviews`. Cards retain server schedules,
reset boundaries and placed due dates; Review events retain their immutable history fields. No local
schedule, Review, Practice command or entity mutation is created. Revision indexes are present on each
entity store, with Deck indexes for Notes/Cards and Note/Card indexes for Cards/Reviews.

The client uses authenticated `GET /sync?since=<cursor>&limit=200`. A server transaction can exceed
the requested page size because a pull must retain its complete revision boundary. Note pull rows now
also include their type name; the original `noteTypeId` remains intact. The browser validates page
envelopes and live collection row shapes before writing. A readwrite transaction spanning metadata and
all entity stores checks the expected cursor, applies the whole page, and advances the cursor together.
Transaction abort, storage failure or interruption leaves the previous committed cursor and rows.
Competing tabs serialize through IndexedDB; old deliveries cannot regress rows or completeness, and a
competing cursor advance causes a fresh pull from the durable cursor.

`complete` becomes true only when a final pull page commits. It is independent of the `/account`
revision and the ordinary online `/decks` and `/notes` queries. A partial snapshot is never mounted as
an offline collection. Subsequent pulls retain completeness while applying newer complete boundaries.
Pulls start after server account validation, reconnection, window focus and acknowledged online writes.
Online pulls update durable storage without replacing existing optimistic React Query projections.
Offline reads use the existing collection query keys and shared domain schemas; live ancestry and
tombstones filter the read view. Offline due counts and local Study readiness are not presented.

## Account boundaries

Local storage remembers only the selected account ID and a local sign-out marker. Account metadata
comes from that account's database. A failed account-validation request may permit this remembered account to
read the local snapshot; it never establishes a newly validated server session. The offline banner
states this distinction. Reconnection validates `/account` before online controls return or another
pull begins. Authentication rejection revokes local access and returns to sign-in. Account switching
cancels the previous visit's reads/pull and clears collection query entries before the next collection
is exposed. Late account responses and pulls cannot re-enable an ended visit.

Offline events and unreachable account/sync requests enter read-only access. An isolated failed online
mutation retains its existing error/retry flow. Reconnection, window focus and the offline banner's
Retry action request fresh server account validation; an unsuccessful attempt remains read-only.

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

Collection completeness and shell readiness are separate. The UI reports an unfinished download,
unavailable persistence, or an application shell that cannot yet reopen offline. Database open and
transaction operations have bounded failure handling. Blocked/disabled storage, quota errors, unknown
formats, future database versions and eviction do not disable the online application. Online recovery
can retry or explicitly rebuild this read-only cache from revision zero. Missing metadata never means
a complete empty collection. Browser storage is an expendable device cache, not a backup; this slice
has no unsynchronized local writes to preserve.

## Verification and later writes

The browser suite exercises complete hydration, offline hierarchy/Note reads, actual server shutdown
followed by shell reload and a reopened page, waiting worker updates during an active visit, incremental
tombstones, interrupted pages, transaction abort, competing/duplicate tab delivery and stale final-page
completeness, quota and unavailable storage, local format/database version
recovery, sign-out, account switching, cross-tab revocation and expired-session rejection. The shell
test uses a disposable HTTP origin rather than worker-intercepted API fixtures; ordinary interaction
fixtures block workers. Chromium and WebKit provide browser evidence, while installed physical-iOS
storage/lifecycle acceptance remains a separate device check.

Before offline writes, replace the rebuild/discard policy with a migration and recovery contract that
preserves pending user work. Add a durable account-bound outbox, stable identities and Card mapping,
explicit conflict and delivery outcomes, safe local schedule/replay ownership, and authenticated
reconciliation after expiry. Offline Review/Undo, persistent Practice transport, Import drafts and
progressive admission are absent. Current server authorization, immutable Review semantics and
deletion/restoration ownership remain authoritative.
