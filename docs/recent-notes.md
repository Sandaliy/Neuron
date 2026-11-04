# Recent Notes

Library offers one Recent Notes menu with Recently added and Recently changed. Both open the existing
account-wide Note browser at `/notes?recent=added` or `/notes?recent=changed`. Its order selector also
offers both modes. Search, status, Card progress, exact tag/source filters, virtual scrolling and editor
Back retain the existing account-visit state. Rows show the collection location and localized date/time;
the underlying instant is available on the `time` element. Refresh returns to the top and reconciles
the loaded pages.

## Dates and pagination

- Recently added orders `createdAt` descending, then Note ID descending. Server creation records
  arrival time, including an Import's arrival. Supplied UUIDs do not determine this view's date.
- Recently changed orders `updatedAt` descending, then Note ID descending. Creation, content, status,
  tags, placement and other existing writes can record an update. This is not an edit log, an editing
  session or a history. A collection rename alone does not update its Notes.
- Existing `created`, `alpha` and `rank` ordering is unchanged. `created` retains ID/file order online.
  Triage and Learning Waves retain their existing choices and behavior.
- Online cursors capture the sort, full PostgreSQL timestamp and final Note ID. Ties are total;
  updating, deleting or purging the boundary Note cannot move the boundary. Invalid or cross-sort
  recent cursors return 400 before reaching PostgreSQL.
- Pages are live reads. A Note changed above the current boundary appears on refresh; older pages
  continue below the captured boundary. Newly arriving Notes also appear on refresh. Reconciliation
  starts at the first page, and visible rows are de-duplicated by identity. No past version is rebuilt.

No mutation, timestamp write, synchronization command, Card, Review or learning behavior changes.
Migration 0019 adds two account/timestamp/ID partial indexes over live Notes. Online requests retain
the existing 1,000-Note maximum plus one continuation probe; Card summaries are fetched only for the
returned page. The production statement is shared with restricted-role EXPLAIN tests. PostgreSQL may
choose an existing Deck index and an in-memory top-N sort for small account collections.

## Downloaded and pending work

A complete download provides both views from the existing account-local projection, excluding
deleted/purged Notes and unavailable ancestry. Filtering and ordering reuse its cached browse result;
recent pages capture timestamp/ID boundaries instead of array offsets. Online timestamps retain
PostgreSQL microseconds; downloaded ordering uses the precision supplied by existing sync reads.
Neither path changes persisted timestamps.

Pending creations use their existing device-recorded instants and carry Saved on device. Online pages
merge them inside the captured timestamp boundaries, including a device whose clock was corrected.
They still have no Cards and cannot enter learning pools.

Existing Note-edit outboxes record no local edit time. Their content/tags remain visible with Saved on
device and the last recorded Note update date. A short explanation says that date waits for sync.
While unresolved edits exist, recent browsing uses the complete downloaded projection, identified as
downloaded results, so searching a device-saved value still finds it during reconnection. Settlement
restores the online query without clearing filters. Existing recovery still owns conflicts. No new
outbox fields or clocks are introduced.

Partial downloads supply no offline results. Account/visit boundaries scope recent query keys, filters
and late creation overlays. Existing account revocation and transport guards discard stale responses.
Cached results grant neither another account's data nor mutation authority.

## Verification and installed-iPhone acceptance

Coverage lives in shared `note-recency.test.ts`, web `notes.test.ts`, `collection-read.test.ts` and
`note-browse.test.tsx`, API `recent-notes.test.ts`, and the existing Note-list/offline browser suites.
PostgreSQL cases cover actual Imports, bulk status/tags, cross-Deck moves, microsecond/timestamp ties,
captured/deleted boundaries, inaccessible ancestry, purge and restricted-role RLS. Browser cases cover
phone/desktop Chromium and mobile WebKit, 6,500 Notes, filters, dates, editor scroll return, local
creations/edits, reconnection and account/deletion boundaries. The controlled performance case retains
the existing 55 FPS budget at 4x CPU and bounds the mounted window.

On the installed iPhone after the protected release:

1. Open Library > Recent Notes > Recently added. Import a short list and create a Note; refresh and
   confirm arrival dates, locations and ordering. Confirm normal Deck file order and Learning Waves.
2. In Recently changed, edit content, change tags/status and move Notes across Decks. Refresh and
   confirm recorded dates and locations. Renaming a Folder alone must not change Note dates.
3. Search/filter a large collection, scroll several pages, open a Note and use Recent Notes/Back.
   Confirm filters, order, position, keyboard dismissal and touch targets. Change a Note elsewhere
   while browsing older pages; refresh to find it at the top.
4. With a complete download, disconnect, create and edit Notes and open both views. Confirm device
   labels and retained update dates for existing Notes. Close/reopen, reconnect and confirm each
   identity once with server-recorded dates.
5. Delete a Note or its parent elsewhere, reconnect and refresh. Confirm exclusion. Switch accounts
   with results open and confirm neither old rows nor filters remain.

Browser profiles do not replace physical-device, installed-PWA or storage-eviction acceptance.
