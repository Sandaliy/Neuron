# Durable offline collection reads

Phase 8.1 adds a device cache for reading a previously downloaded collection. Online CRUD, scheduling,
Study, Practice and Import still use their existing server endpoints and reconciliation. Offline reads
reuse Library hierarchy rows, inline nested expansion, Deck headers/breadcrumbs, search/sorting/filtering
and virtualized Note rows. Note details share their header and conditional field presentation with the
editor through a reading component with no autosave controller. Study, Practice, editing, restoration
and Import application remain online-only. Remote Note media is not
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
Offline reads use the existing collection query keys and shared domain schemas; live ancestry and
tombstones filter the read view. Offline due counts and local Study readiness are not presented.

## Account boundaries

Local storage remembers only the selected account ID and a local sign-out marker. Account metadata
comes from that account's database. A failed account-validation request may permit this remembered account to
read the local snapshot; it never establishes a newly validated server session. Settings explains
this distinction. Reconnection validates `/account` before online controls return or another
pull begins. Authentication rejection revokes local access and returns to sign-in. Account switching
cancels the previous visit's reads/pull and clears collection query entries before the next collection
is exposed. Late account responses and pulls cannot re-enable an ended visit.

Offline events and unreachable account requests enter read-only access. Collection GET transport
failures also request a single shared `/account` validation attempt. This detects genuine transport
loss when `navigator.onLine` remains true. A reachable account endpoint leaves an isolated failed
read in its existing retry/error flow. HTTP refusals and aborted reads never initiate this probe.
Interrupted response bodies follow the same transport classification as failed fetches.
An isolated failed sync pull while the browser remains connected preserves online screens and records
a stable download failure. An isolated failed online mutation retains its existing error/retry flow. Reconnection, window focus and Settings' Check connection
Retry action request fresh server account validation; an unsuccessful attempt remains read-only.
Account and connectivity generations guard stale deliveries. The handover cancels pending reads and
invalidates active collection observers without removing cached query entries or remounting Library
and Deck screens. Complete snapshot reads replace those entries locally. Read-only capabilities
remove menus, drag/drop, selection mutations, direct/swipe deletion and learning entry controls;
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
formats, future database versions and eviction do not disable the online application. Online recovery
can retry or explicitly rebuild this read-only cache from revision zero. Missing metadata never means
a complete empty collection. Browser storage is an expendable device cache, not a backup; this slice
has no unsynchronized local writes to preserve.

Failure diagnostics distinguish network/API transport, malformed protocol/boundaries, row schema,
database open/read, transaction commit and explicit recovery. Only fixed error codes, entity names and
known top-level schema fields are recorded; no row values, IDs, account identifiers, tokens or arbitrary
exception messages enter diagnostics. A failed Rebuild is handled as recovery failure, never success.

## Verification and later writes

`offline-live.spec.ts` is opt-in with `CI=true OFFLINE_DATABASE_E2E=true` and the guarded
`DATABASE_URL_TEST`. It uses actual HTTP, authenticated collection routes and restricted-role
PostgreSQL/RLS; only session lookup is substituted. Representative persisted data includes a migration
0012 Deck identity and references, nullable fields, all six entities, Review/Undo history, soft-delete
and purged tombstones, cloze Cards and revision-boundary pagination. It compares every persisted
envelope and the final cursor with real pulls, interrupts/resumes, deliberately rebuilds corrupted
metadata, and stops the HTTP server while a Deck is open to prove local continuity without reload
despite online browser hints. It then reloads/reopens the cached shell, browses, reconciles updates and
switches accounts. It runs in desktop Chromium and phone-sized WebKit. No production account contents are used.

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
Chromium and WebKit provide browser evidence. The owner accepted physical-iPhone offline reopening
after PR #46; in-session transition and parity acceptance remains a separate device check.

Before offline writes, replace the rebuild/discard policy with a migration and recovery contract that
preserves pending user work. Add a durable account-bound outbox, stable identities and Card mapping,
explicit conflict and delivery outcomes, safe local schedule/replay ownership, and authenticated
reconciliation after expiry. Offline Review/Undo, persistent Practice transport, Import drafts and
progressive admission are absent. Current server authorization, immutable Review semantics and
deletion/restoration ownership remain authoritative.
