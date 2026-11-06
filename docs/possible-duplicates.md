# Possible duplicate Notes

The Library offers a read-only inspection workspace, also reachable from a Deck. It groups at least
two available Notes with the same existing `term_key`. The learner can search groups, choose the whole
Library or one leaf Deck, inspect term, meaning, Note type, source and full collection location, and
open the normal editor. Search, group, measured row sizes, scroll and keyboard focus survive that
editor visit within the account visit. Group and member lists use measured virtual rows and explicit
bounded continuation controls.

## Equality and visibility

Equality is the Import contract: `normaliseTerm` / `noteTermKey` in shared code and the generated
`notes.term_key` column. Case is folded, ASCII whitespace is collapsed, accents remain significant,
and only the first 200 characters are compared. Vocab uses its term, Basic its front, and Cloze its
complete marked-up text. Empty keys are omitted. Similar translations never create a group.

The prefix limit inherits the existing implementations: PostgreSQL counts characters and the shared
browser normalizer counts UTF-16 units. Very long supplementary-Unicode terms can therefore have
different preliminary groups offline. Online results remain authoritative; no normalization or Import
contract is changed here. The read schema accepts the full generated PostgreSQL key.

Matching terms can describe different meanings, grammatical uses, languages or source contexts. A
group is a suggestion to inspect, not a mistake classification. Note identities and independent Card
directions remain separate. This workspace has no merge, deletion, bulk, status or learning action.
The ordinary editor retains its existing permissions and behavior.

Both server reads require account ownership and RLS. A recursive live collection chain follows actual
parent links, including Folder kinds and the existing hierarchy depth bound. Deleted/purged Notes,
deleted/purged ancestors, orphans, cycles and inaccessible collections cannot contribute counts or
members. A scoped read includes Notes in that leaf Deck only.

## Reads and pagination

- `GET /notes/possible-duplicates`: optional `deckId`, literal `search`, and normalized-key `cursor`;
  50 groups by default, at most 100. Search matches any member's fields, source or full location and
  returns the complete group count within the scope. Normalized terms are searchable too.
- `GET /notes/possible-duplicates/notes`: required exact `key`, optional `deckId` and UUID `cursor`;
  100 Notes by default, at most 200. Responses include locations and no Card summaries.

Shared strict schemas validate both query and response shapes. Each repository read executes one
bounded SELECT inside the established account transaction, with no Card or Review query. The existing
partial `(user_id, term_key)` index supplies exact term lookup. Online grouping runs in PostgreSQL;
the browser receives pages, never every account Note for duplicate detection.

Groups use key order with PostgreSQL C collation and carry the key value in the cursor. Members use
UUID order and carry the UUID value. Deleting or editing the preceding row does not invalidate its
cursor. These are live reads, not a frozen snapshot: concurrent changes can add/remove groups or alter
their counts. Refreshing or reopening reconciles current content; the UI deduplicates identities
across changed page boundaries. No cursor establishes authorization.

## Downloaded results

Offline inspection requires a complete downloaded collection. Missing, incomplete or unreadable
downloads never become an empty successful result. The existing account-visit-bound projection
validates downloaded rows, live ancestry, local content overlays and pending creations without
reading the Cards store. An index is cached by projection identity and browse version, with each
immutable Note normalized once. Bounded work batches yield to input while the index is built.

Downloaded groups include this device's local changes and pending Notes; pending members say
"Saved on device". A download cannot see newer changes on other devices. Online groups describe
server Notes and explicitly explain that unsent Notes/edits can appear after delivery. No new sync
record, protocol, database migration or duplicate status is introduced.

Query keys separate account, visit, read authority, scope and filters. Local edit/creation notifications
invalidate these reads; editor return refreshes them. Reconnection replaces local pages with bounded
server pages while retaining search and the selected group. Cursors never cross read authority.
Account switching and revocation remove the former account's presentation; late results are rejected
by the existing collection transport and an additional index completion guard.

## Verification

`apps/api/src/routes/possible-duplicates.test.ts` exercises real PostgreSQL 17 through the restricted
application role, exact normalization, multiple meanings/types/sources, cross-Deck and scoped counts,
literal search, deleted/purged/hidden content, repository/RLS mismatch, missing account context, value
cursors after changes, and complete pagination over 1,500-member and 500-group datasets.

`duplicate-index.test.ts` and `possible-duplicates.test.ts` cover conservative local indexing,
ancestry, pending provenance, projection invalidation, account races, incompleteness and bounded
pages. `apps/web/tests/possible-duplicates.spec.ts` covers Library/Deck entry, search, large lists,
long mobile content, keyboard/editor return, complete/incomplete downloads, local edits, pending
creations, reconnection and account switching in Chromium and mobile WebKit.

The synthetic dataset has 6,500 Notes: 4,000 unique terms, 500 pairs across Decks and a 1,500-Note
group with different meanings and sources. A local PostgreSQL plan measured approximately 13 ms for
the group query and 12 ms for 100 members. Repository timings include transaction and transport costs
and vary with cold connection setup and concurrent verification. These are local fixtures, not
production latency or physical-device acceptance.

On the built Windows Chromium fixture, Library entry took 251 ms at 375 px and 201 ms at desktop
width. Switching to downloaded results and opening the large group took 202 / 259 ms respectively.
The interaction samples had no observed long tasks, no Card-store scans, and p95 frame times of
16.7 / 16.8 ms. These measurements use an already complete download and no CPU throttling; initial
hydration, network latency and installed-iPhone behavior are separate. Fewer than 40 rows mounted.

The unit/API/RLS suite passed 1,287 tests in 118 files with four workers against disposable PostgreSQL 17. Higher local concurrency exhausted the container's default connection limit; assertions and database
coverage were unchanged. The full built-app phone/desktop interaction gate passed 813 tests, with 18
opt-in live tests skipped.
The focused feature suite also passed all five mobile WebKit scenarios. Typecheck, lint and formatting
passed. Four phone Library reference images changed to include the new entry; both themes and both
widths were checked. All 10 controlled performance cases passed with threshold enforcement and the
optional 5,000-Note benchmark enabled, including the existing 4x CPU frame and triage budgets.
Physical-iPhone acceptance is still outstanding.

## Integration and physical acceptance

PR #80 integrates with Tags & Sources (#79) on protected main. Library keeps both quiet actions in
the existing wrapping action row. Categories keep exact saved-value filters; duplicate groups keep
the established normalized-term key. Both reuse the account-bound downloaded Note projection and
ordinary editor, with independent browse/return state and bounded server pages. No persistent index,
mutation protocol or learning behavior is added by the integration. Account Export (#71) and Import
Hardening (#74) remain outside this release.

On an installed iPhone, use a fully downloaded large collection with repeated terms in different
Decks, sources and meanings. Inspect long terms/translations/paths in both themes; search and select a
Deck; open/edit a Note and return using both the in-app control and browser Back; confirm the group,
position and keyboard behavior. Repeat offline, including a new device-only Note, then reconnect.
Check an incomplete download and switch accounts. Confirm the workspace exposes only inspection and
that ordinary Note editing retains the existing permissions. Installed-iPhone acceptance remains
outstanding and must be recorded separately from browser verification.
