# Slipping Cards (Phase 9.3, problem cards)

Library offers **Slipping cards**, also reachable from a Deck's Notes. It lists Cards the learner
keeps forgetting, says why each one is listed from the learner's own answers, and opens the ordinary
Note editor to repair the material. A Card can be set aside and later resumed. The English term
follows the glossary (`leech` is "slipping"; never "проблемное" in Russian); code and routes use
`problem-cards`.

A listed Card is a recommendation to look, not a classification of the Note, a scheduling decision or
a diagnosis. The workspace never edits content, suspends, resets or reschedules anything on its own.

## Detection policy

Evidence is a Card's **current learning history**: its answers that still count for the scheduler,
the same set `logFor` in `reviews.ts` replays.

- An answer taken back with Undo does not count, and neither does the cancellation event.
- A restart (`Restart learning`, an append-only `resets_learning` event) starts a new history: answers
  ordered at or before the latest restart event by `(reviewed_at, rev, id)` do not count.
- An explicit Card reset (`cards.reset_at`) does the same for answers before it.
- Each Card direction, and each Cloze gap, has its own history and is listed on its own.

A Card is listed when its current history meets either rule (`packages/shared/src/problem-cards.ts`):

| Rule            | Condition                                                                   | Shown as                                          |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| Repeated lapses | at least 3 Again answers given while the Card was on a schedule (review)    | "Forgot 4 times after learning it, in 14 answers" |
| Frequent Again  | at least 4 Again answers, and Again is at least half of all counted answers | "Again in 5 of 8 answers"                         |

One or two misses are never enough, whatever the share. A long-studied Card with occasional misses is
left to the first rule. The second rule catches a Card that never settles, including during its first
learning steps. The thresholds are hypotheses for owner testing (ROADMAP Milestone 9), written once in
`PROBLEM_CARD_POLICY` and shown to the learner in the empty state.

Each listed Card also carries, for the page only: its latest 8 counted answers (newest first, with
dates for assistive technology), the date of the last Again, how many answers since then were
successful ("Remembered the last 3 times" from 3 on; a description, not a reason to hide it), and the
restart or reset its history starts from. Difficulty, stability or any other model score never decides
membership.

Only active Notes in live, account-owned Decks reached through actual parent links contribute. Notes
marked Known or suspended as a whole are out of Study and are not listed. Deleted and purged Notes and
Cards, and Decks under deleted or orphaned Folders, are excluded.

## Experience

- Filters: collection scope (whole Library, a Folder subtree or one Deck), direction, schedule (studying,
  set aside or both), order (most Again, or most recent Again) and literal search over Note fields,
  source and location. The count of listed Cards in the current scope and filter is always shown.
- Each row shows the term, meaning, direction (and gap), full location, **Why it is listed** (the
  evidence) and, separately, **Schedule now** (in Study with its next review date, or set aside since a
  date). Recommendation and actual scheduling state are never mixed.
- **Edit note** opens the existing editor. Its back control reads "Slipping cards"; it and browser Back
  return to the same filters, Card and scroll position, and a keyboard user's focus returns to that
  Card's Edit control. The list reads the server again on return.
- **Set aside** and **Resume** use the existing `POST /cards/:id/suspend` and `/unsuspend`. They change
  `suspended_at` and the revision only: due date, memory state, counters and every Review are kept. The
  row updates in place, the list is marked stale without moving, Study planning and the Deck tree are
  invalidated, and the download is refreshed. A set-aside Card stays listed with its evidence. If its
  date passed while set aside, it is due when resumed.
- Rows are measured virtual rows; pages of 50 continue with Load more.

## Reads

`GET /cards/problems`: optional `deckId` (Folder or Deck), `direction`, `state` (`all`, `studying`,
`suspended`), `sort` (`again`, `recent`), literal `search`, value `cursor`; 50 Cards by default, at most 100. The strict shared schema refuses a cursor from the other order. Responses carry `total`.

One SELECT inside the account transaction, under RLS:

1. Candidates: live Cards of active Notes in live Decks with `reps >= 3`. A Card's `reps` projection is
   never smaller than its counted answers, so this pre-filter is exact and needs no Review.
2. Restart events come from the existing `(user_id, restart_id, card_id)` unique index; Undo targets
   from the `(user_id, cancels_review_id)` index as a small hashed set.
3. Membership: one index range of `reviews_card_idx` per candidate, aggregated into plain counts.
4. Explanation: the latest 8 answers and the successful run only for the Cards on the returned page.

Cursors carry `(again, last Again at microsecond precision, Card id)` or `(last Again, Card id)`. A Card
resumed, edited or no longer listed between pages does not shift the next page; the client
de-duplicates identities. No new table, column, index, migration, sync record or protocol is added, and
the browser never receives a whole collection or Review history.

## Offline

A complete download answers from its Card projections (`localProblemCards`). Those counters already
reflect Undo, restart and reset, but a download is not a verified Review history, so only the lapse rule
is evaluated and the page says so ("as of the last download"; frequent Again and dated history need a
connection). Answers this device has not delivered are not counted. Pending Notes have no Cards. Local
Note edits refresh the list. An incomplete download shows the existing incomplete-download state and
never an empty result.

There is no offline Card mutation. Set aside / Resume remain visible, explain that a verified connection
is needed, and write nothing. Reconnection replaces local pages with server pages under separate query
keys, so a cursor never crosses read authority. Account switches discard the previous account's pages.

## Integrity

FSRS, immutable Reviews, Study planning, workload forecasts and synchronization are untouched: the
workspace reads, and its only writes are the existing suspend/unsuspend endpoints, which keep the
schedule. Account isolation is enforced twice, by the user-bound repository and by RLS; a repository
built for one user over another user's transaction reads nothing.

## Boundaries

- **Splitting** a problematic Note is not implemented. Moving history or identity between Cards needs a
  separately established integrity-safe contract.
- **Content Quality Inspector** (parallel work) examines Note content. This workspace looks only at
  learning performance and makes no claim about content quality.
- **Progressive Directions (PR #86)** is not assumed. Directions are read from Card rows, so a direction
  that has not opened has no answers and is not listed. After #86, setting aside a Card of a preceding
  rung holds the rungs after it (its documented `paused: suspended` status); the suspend endpoint
  itself is unchanged. #86 adds a nullable `unlockReason` to the Card wire schema; this page does not
  read it, so no merge conflict in behavior is expected. Textual conflicts are possible only in shared
  documents (`STATE.md`, `ROADMAP.md`, `map.md`) and the i18n catalogues.

## Verification

`apps/api/src/routes/problem-cards.test.ts` runs through the restricted application role on real
PostgreSQL: lapses per direction, frequent Again, insufficient evidence, Undo removing and re-adding a
lapse, restart and reset lines, suspension keeping due/memory/counters/Reviews and leaving Study
planning, Folder/Deck/direction/search scopes, both orders with value cursors under deletion, Known,
deleted, hidden and foreign content, repository/RLS mismatch, and malformed queries.

The large case inserts 5,000 Notes, 10,000 Cards and 200,000 Reviews (400 listed) and measured about
170 ms PostgreSQL execution and 140-150 ms per warm page on local PostgreSQL 16, down from about
1,070 ms for a first single-pass window-function version. The floor is reading each candidate's
answers. With the whole suite running on four workers beside browser tests, the same case measured
210-410 ms. These are local fixtures, not production latency.

`packages/shared/src/problem-cards.test.ts` states the policy over answer sequences and cursors.
`apps/web/src/lib/problem-cards.test.ts` covers the downloaded projection. `apps/web/tests/problem-cards.spec.ts`
covers Library and Deck entry, 3,000 Notes with 600 listed and fewer than 20 mounted rows, evidence and
schedule text, set aside and resume in place with focus and scroll kept, keyboard and Back editor return,
and a complete download offline with no Card write.

## Installed-iPhone acceptance

On an installed iPhone with real study history: open Slipping cards from Library and from a Deck; read
the reasons and latest answers for a Card you know you forget; check long terms, meanings and paths in
both themes. Edit the Note, return with the in-app control and with a back swipe; the same Card should
be in place. Set a Card aside, start Study and confirm it does not appear; resume it and confirm it
returns with its schedule. Undo an Again in Study and confirm the count drops. Go offline with a complete
download: the lapse-only list appears and Set aside explains it needs a connection. Switch accounts.
Installed-iPhone acceptance is outstanding and must be recorded separately from browser verification.
