# Content checks

Library > Content checks is a read-only vocabulary inspection workspace. Choose a check, browse
matching Notes, narrow by search or one leaf Deck, and open the normal editor. Category, search,
Deck, measured scroll position and keyboard focus survive the editor visit within the account visit.
Returning refreshes results. If a corrected Note leaves the category, keyboard focus continues at its
nearest remaining neighbour. Only the existing editor saves content through its normal behavior.

## Rules

The built-in `vocab` schema requires `term` and `translation`. Examples, example translations and
definitions are independently optional. These checks do not strengthen that validation contract.

| Check                                  | Exact inclusion rule                              | Meaning                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Example translation without an example | `exampleTranslation` has text, `example` has none | A missing source in the saved example/translation pair. Review the pairing. The Note remains schema-valid; this is not a validation error or a linguistic judgment. |
| Example without a translation          | `example` has text, `exampleTranslation` has none | Optional enrichment. The learner may already understand the example.                                                                                                |
| No example sentence                    | `example` has no text                             | Optional enrichment. Context may help, but is not required.                                                                                                         |
| No definition                          | `definition` has no text                          | Optional enrichment. The required translation may be sufficient.                                                                                                    |

Text means a string with a non-whitespace character. PostgreSQL trims the explicit JavaScript `trim`
whitespace set, including Unicode spaces. Missing, null, empty, whitespace-only and non-string raw
draft values are absent. No check judges translations, grammar, definitions or examples linguistically.

One Note can match several checks, once per category. An example translation without a source also
matches No example sentence. These counts are not a partition or an overall quality assessment.
Basic and Cloze Notes are outside the checks. All vocabulary statuses participate, including Known,
suspended and draft. Required-field validation stays with existing write schemas and the editor.
Saved raw drafts are inspected as saved, without becoming valid Notes or changing their state.

The workspace has no correction, generation, bulk replacement, tagging, score, status or learning
action. It changes no Card direction, Study/Practice admission, FSRS state, Review or Import behavior.

## Online counts and visibility

`GET /notes/content-quality` accepts optional `deckId`, `search`, `category` and UUID `cursor`.
Pages default to 100 Notes and allow at most 200. Without a category, the response contains the four
counts and matching vocabulary count, with no Note payload. A selected category also returns a bounded
Note page with full live collection locations. Shared strict schemas validate requests and responses.

Counts and vocabulary totals follow search and Deck filters, ignoring the cursor. Search is a literal
case-insensitive substring over term, translation, reading, definition, example, example translation,
mnemonic, extra note, tags, source and full location. SQL wildcards are escaped. Deck scope selects
that leaf Deck only. One SQL statement gives counts and its page the same snapshot and inclusion rules.

Explicit account predicates and PostgreSQL RLS both apply inside the existing account transaction.
Actual parent links determine live ancestry, respecting Folder kinds and the existing depth bound.
Deleted/purged Notes, unavailable ancestors, foreign ancestry, cycles and non-leaf locations are
excluded. Inaccessible/deleted Note types are excluded too. No Card/Review read, write, revision
allocation or migration is needed. PostgreSQL inspects account content; React receives only pages.

UUID ascending order supplies a stable value cursor even after the preceding Note changes or is
deleted. Separate pages are live snapshots, so concurrent changes can alter membership or counts.
Editor return refetches loaded pages; rendered identities are deduplicated. Cursors grant no access.

## Downloaded results

Offline inspection requires a complete downloaded collection. Missing, incomplete or unreadable
downloads hide old counts and rows and explain the unavailable results. A previously cached complete
view cannot bypass a later unavailable state. Missing downloads never become successful zero counts.

The existing account-bound collection projection supplies saved Note overlays and pending creations,
including raw drafts and retained conflicts under its normal rules. Resolved records and tombstones
keep that projection's existing exclusions. Pending creations say Saved on device. Unsaved new-editor
form contents do not become Notes. Only the last filtered in-memory view is cached by projection and
browse version; bounded work batches yield to input. No new persistent index, store, outbox record or
synchronization protocol is introduced. Cards and Reviews are not read.

Local counts describe the complete download plus this device's saved work. They cannot see newer
work on another device. Server counts describe acknowledged server content. Separate page keys
include account, visit, authority, Deck, search and category. Reconnection keeps filters and restarts
server pagination. Account changes reset inspection state; cancelled/late reads cannot publish into
the new visit. Existing edit/create delivery, mutation and recovery behavior is unchanged.

## Verification and measurements

PostgreSQL tests use a separate throwaway database and the restricted application role. Coverage
includes overlapping counts, optional/required fields, mixed types, literal search, Deck filters,
edited/deleted cursor boundaries, tombstones, unavailable ancestry, account mismatch, unnamed RLS
context and Unicode whitespace. Local projection tests cover saved raw drafts, pending/resolved
creations, incomplete downloads, pulls and an account change during a pending read.

Production-statement `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` used 6,500 Notes, including 5,500
vocabulary Notes, across 12 Decks under a Folder, with substantial example/definition text. Existing
account and collection indexes were used. Note payloads were bounded to 101 rows for a 100-row page.
All four plans wrote zero temporary blocks and accessed no Cards or Reviews.

| Read                                                         | PostgreSQL execution |
| ------------------------------------------------------------ | -------------------- |
| Counts and a 100-Note page                                   | 42.860 ms            |
| Counts without Note payload                                  | 36.244 ms            |
| Continuation page and counts                                 | 45.643 ms            |
| Deck/search filter: 11 vocabulary Notes, no category matches | 3.369 ms             |

The first remote repository read took 469.7 ms end to end, including transaction/connection transport
and validation. These controlled synthetic measurements are not production latency promises.

All 18 focused built-app cases passed across phone/desktop Chromium and mobile WebKit. They cover
6,500 mixed Notes, exact counts, filters, bounded pages, continuous/mid-string typing, keyboard/editor
return, corrections leaving a category, long content, complete/incomplete downloads, saved edits,
pending Notes, reconnection, account changes and delayed old-account responses.

The full built-app phone/desktop interaction gate passed 885 tests, with 20 optional live journeys
explicitly skipped. All 768 core/shared/web unit tests and seven real PostgreSQL inspection tests
passed. The full 70-case Windows visual comparison passed; eight Library references record the new
entry. Screenshot tolerances, interaction assertions and existing performance budgets are unchanged.
All 13 controlled performance cases passed across the main run and the explicit opt-in Note-list
benchmark; skipped optional live journeys are not passing evidence.

After the test-only #88 update reached main, the affected Library acknowledgement scenario passed in
both Chromium viewports. The final category-copy readability adjustment passed the inspector entry,
filter and keyboard scenario in all three browser configurations. Neither change alters the measured
inspection queries or result-list rendering.

At 4x CPU slowdown, the existing 55 FPS median-of-three scroll budget passed at 60.0 FPS, with 17
mounted rows. Across two runs, switching a complete download to local inspection took 526–533 ms,
with one Note-store snapshot and no Card-store scan. Cold local projection produced long tasks up to
102 ms and a worst observed frame of 116.7 ms, measured separately from steady scrolling and initial
network download.

## Integration and physical-iPhone checklist

The branch includes the already merged #84 through main and uses its immediate `useBrowseState`
helper and shared search input scroll protection. Library adds one entry, the router one lazy route,
and the editor one account-visit-bound return origin. Localization uses `quality.*` keys. Shared
locale files, the browser index and `docs/STATE.md` remain integration points. There is no dependency
on export, import-hardening or dependency-security work.

Physical Home Screen iPhone acceptance remains open:

- Import/download at least 5,000 mixed Notes. Check known examples against all categories and
  overlapping counts. Distinguish the missing source pair from optional context.
- Filter by Deck and search; type continuously, edit the middle, clear and try no matches. Verify
  native keyboard dismissal, long text, normal scrolling and no sideways overflow in both themes
  and with reduced motion.
- Scroll several pages, open a Note, return unchanged, then add/remove context and return. Verify
  category, Deck, query, scroll position and corrected category membership.
- With VoiceOver and a physical keyboard, reach filters and categories, open with Enter, return and
  continue through neighbouring rows, including after a correction removes the focused Note.
- With a complete download in airplane mode, edit existing context and save a new Note. Check local
  provenance and counts. Try an incomplete download and confirm it explains unavailability instead
  of showing stale counts or pretending the collection is empty.
- Reconnect with saved work and a slow connection, then switch accounts. Verify server counts,
  retained reconnection filters, cleared account state and no old Note/collection names from late
  reads. Inspect the existing editor conflict recovery when relevant.

Automated WebKit stages interactions; it cannot establish native keyboard, VoiceOver, installed-PWA
storage behavior or physical scrolling smoothness.
