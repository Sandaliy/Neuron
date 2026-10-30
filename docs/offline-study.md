# Offline Study planning and durable Reviews

Phase 8.4 continues an already-started Study sitting after connectivity loss. Phase 8.5 also starts
new sittings from a complete usable download, using the existing Today, setup, learning card, Typing,
Listening, progress, Undo and completion interfaces. Offline Practice, Note creation and Import
application remain outside this release.

## Downloaded planning and conservative admission

The API and local planner call `planDailyStudy` in `packages/shared`. Its deterministic FSRS/workload
implementation remains in `packages/core`. Scope, inherited language/settings, due and learning priority,
retry timing, sibling suppression, backlog recovery, weekday/day-cutoff behavior, shared time and daily
introduction policy are unchanged. Language and direction filter the shared admission decision; they do
not acquire separate budgets. Existing server Card identities are read, never generated from local Notes.

A lazy worker reads account settings, sync metadata, Cards, original Notes, Decks, raw Reviews, Note work
and Review intents in one transaction over the existing account database. It validates row boundaries,
history references, current-life answer counts, causal sequences and account ownership. Collection
cloning, validation, replay and forecasting stay off the UI thread. The built shell caches the worker
before offline use. Ordinary online planning and unrelated navigation do not create it. Settings uses
the same worker for a read-only readiness check; its result never authorizes online Study.

New material is allowed only when the remembered account revision matches the completed download
cursor, settings are compatible, history is usable and unresolved local work does not undermine the
decision. The active visit's known account settings must also agree; newer known settings govern safe
due work but restrict new material until the download catches up. A settings mismatch, incomplete history, rejected/archived undelivered Reviews or pending Note
content restrict new admission, including one-off override. Affected Cards/Notes are withheld; other due
work remains available when its state is sufficient. A missing/incomplete download or unreadable causal
stream cannot start Study. Settings/check-connection recovery retains all original records.

History validation uses the same captured origin and event ordering as canonical server replay.
Mixed legacy rows without `priorState` and newer captured predecessors can have a nonzero origin;
Card repetitions are not simply the number of surviving downloaded answers. The guard requires a
usable current-life root, checks cancellations/reset boundaries and verifies repetitions and last
Review without rewriting original schedules under today's settings. Missing first/middle history,
missing targets and inconsistent counters still restrict new admission and affected work.
Out-of-order delivery can place the captured zero-state or legacy new-state root later in reviewed
time than another answer. Root recognition considers the complete current-life event set, matching
canonical replay; a zero-state fallback alone is not proof of a legacy origin.
Purged Cards retain scheduling/Review attribution for shared workload and daily introductions but
never enter a live queue or accept new pending answers. Deleted/Restart/Undo semantics remain the
server's existing rules. After a pull advances past the account metadata revision, bounded fresh
account validation updates that existing metadata record; it never assumes settings are unchanged.

Phase 8.6 retains the rendered setup and its choices while authority/planning reconciles. Start remains
unavailable until the new matching plan is ready; an admitted sitting keeps its existing durable
answer/Undo path. Healthy setup omits the persistent downloaded-source paragraph. Actual limitations,
missing voices, local saving, storage failures and pending delivery retain contextual feedback.

Settings > Offline & sync is one status: everything saved, saving (with Send now), waiting for a
connection, needs your attention, or a broken offline copy. Only work that needs a decision is listed,
each item with its own actions; waiting work is a count, and synchronized work is not listed at all
(its records stay on the device). What works offline, Check connection and diagnostic export sit under
What works offline. Browsing download completeness stays separate from Study data readiness, with a
restricted-work count and synchronization/rebuild guidance for real history gaps. Rebuild preserves
receipts and refuses unresolved/recovery work. Available due reviews, admissible new Cards and
excluded work are distinct: a collection of fifty Cards is not a promise of fifty Cards in one sitting.
Language, direction, current due/retry time, sibling suppression, workload and shared daily budget
still determine the plan.

Valid pending answers and cancellations are merged with downloaded history by immutable identity.
Already downloaded exact events are not counted twice. Canonical core replay accounts for locally
committed work from previous sittings before selecting more Cards; cancellation removes its target's
effect without deleting either event. The Start action replans locally before opening an offline sitting.
Advancement uses only the admitted queue and local durable writes, without waiting for HTTP.

This decision covers the last complete server download plus this device's committed events. It cannot
observe another device's later activity while disconnected. Server delivery/replay remains authoritative
on reconnection. Unknown settings/history never turn a missing response into permission for override.
Downloaded provenance by itself is insufficient: ordinary provisional browse data and Note overlays are
not planning inputs. Device-local Listening requires a compatible voice marked as a local service;
installing voices and changing server Deck settings require the relevant online/device support.

There is no SQL migration, IndexedDB version change, additional durable store, event-format change or
parallel scheduler. Closing/restarting retains committed Review work; it does not resume the sitting or
restore its visit-local Undo stack. A new sitting uses a fresh local plan. Storage loss/eviction remains
an existing browser limitation; no reset or clearing operation is used as recovery.

## Local acceptance and exit

`review-outbox.ts` stores each answer in the matching account’s collection database, independently
of collection hydration completeness. IndexedDB version 3 adds `review-outbox` without clearing the
existing collection, rename outbox or Note drafts. A strict-durability transaction atomically commits:

- the original Review ID, Card ID, rating, JSON event time and answer duration;
- a sitting ID, monotonic sequence and the preceding event’s identity;
- the pre-answer Card needed to explain/recover the saved work;
- the updated sequence and sitting head in metadata.

The Review sequence counter and sitting heads survive a collection rebuild independently of its
download cursor. Rebuild retains synchronized Review receipts and refuses unresolved or archived work.

Study advances, updates progress, enables the next Card and releases exit only after the transaction’s
`complete` event. The same rule applies to Undo. While it is open, the header says Saving on this device
and shows the established busy control. A failed write leaves the visible answer and original retry
intent in memory, shows an actionable error and blocks exit/native navigation. Retry uses that same
identity, payload and time. A failed or interrupted local write never claims acceptance.

After local commit, network delivery is independent of animation, advance and exit. The old guard
lasted until every in-memory request had an acknowledgement; an interrupted request could leave it
locked indefinitely. It now protects only uncommitted local work. Forced process termination before
local commit cannot be recovered as a saved answer; browser storage eviction can remove local work.
Strict IndexedDB durability is a browser capability, not a backup or an eviction guarantee.

## Immutable Undo and exact delivery

Undo retains the established current-sitting LIFO stack, including completion until the learner exits.
It commits a separate immutable cancellation intent with its own ID, original event time and explicit
answer target before changing the queue. A quick Undo request during an answer transaction retains
its original cancellation ID/time and commits after that answer; navigation stays guarded through
both transactions. Original answer intents are never edited or removed, even when neither event has
reached the server. Exiting/reloading ends the local Undo stack; reopening does
not offer historical Undo. Reload preserves undelivered events, not the sitting’s queue or admission. Phase 8.5 can build a new
sitting from the retained complete snapshot and those events.

The coordinator sends a causal stream under a freshly validated matching account. A cancellation’s
answer and each preceding event must be acknowledged first. Network interruption, request timeout,
process suspension, a lost response or failed acknowledgement storage retain exact retry payloads.
A 15-second transport timeout releases the worker, never the local transaction guard. Connectivity
revalidation, authenticated reopening, focus, newly saved work and Settings Retry wake delivery.
A delivery that ends without an answer from the server (network error, timeout, 5xx) also tries
again by itself after 2, 5, 15, 30 and then every 60 seconds while the account stays validated. Before
this, one dropped request on reconnection stalled delivery until the app returned to the foreground,
and Today asked the learner to press Retry in Settings. A refusal (400, 403, 404, 409, 422) is never
retried automatically. No timestamp-based overwrite is used for Review events.

Today names the wait instead of pointing at Settings. Answers in flight read "Sending saved answers".
Answers whose last attempt failed read "Saved answers are waiting to be sent" with a Send now action.
Only a refusal, which needs a decision, links to Offline & sync. The restriction itself is unchanged:
a new online plan still waits until every saved answer is synchronized or archived.

Phase 8.6 sends the leading run of consecutive answers as one `POST /reviews/batch`, up to fifty per
request, and settles that run in one local transaction. The endpoint, its single server transaction,
its `reviewedAt` replay order and its per-event `skipped` reporting already existed; only the client
stopped sending one request per answer. A run extends only while the stored predecessor chain is
unbroken and every entry is a pending answer, so an Undo ends the run and travels on its own. An
answer saved with a working connection still goes immediately rather than waiting for a batch.

Each batched entry keeps its own acknowledgement, checked against its submitted Review and Card
identities exactly as a single delivery is. A `skipped` entry becomes rejected with the reported
reason and stops the pass; entries the server did apply keep their genuine acknowledgements. A
refused batch is retried one entry at a time, so the answer the server objected to is the one that
stops rather than the whole sitting. Payloads, event identities, ordering, retry exactness and
recovery are unchanged: the number of requests is what changed. Twelve answers at a 120 ms round trip
cost twelve requests and 1,935 ms before, and two requests and about 400 ms after.

An answer acknowledgement validates the submitted Review and Card identities. Undo acknowledges
its submitted ID, target and the authoritative cancellation ID. If another device already canceled
the target, the existing cancellation identity is returned explicitly. An immutable receipt in the
existing `sync_receipts` table binds this additional Undo command ID to its target/time/cancellation,
so it cannot later be reused as another Undo or answer. Missing targets reject instead
of silently doing nothing. Reusing an ID for different answer/cancellation content returns
`review_id_reused` (409), without changing history or revision. Undo stores its original submitted
instant in the existing `submitted_at` column; canonical cancellation timing retains its established
relationship to the target. Account locking serializes Undo with answers and restarts.
This is an additive shared response/schema change; no SQL migration or new server event model is needed.

The server retains canonical event ordering, replay, deterministic FSRS seeds, learning steps,
restart boundaries and original event time/timezone/day-cutoff behavior. Concurrent remote answers
remain immutable and participate in replay. Recoverable deletion accepts late events for retained
Cards; a purge rejects new events while exact already-committed retries remain acknowledgeable.
Server results reconcile Card projections; subsequent planning uses authoritative Review history and
workload admission rather than local predictions. Provisional projections never authorize an additional Card; new offline admission uses the validated
complete-snapshot planning path above.

## Recovery and account boundaries

Explicit rejections stop subsequent delivery. Later events remain local and visible, with Retry and
Copy recovery record. Invalid/mismatched acknowledgements remain pending. Storage/read errors are
visible; collection Rebuild refuses unresolved Reviews, recovery archives or unreadable records.
No command, receipt, original version or archive is deleted to simplify Settings.

Settings presents this work as one piece rather than one row per event. Waiting events are a count in
the section's status, refused ones are grouped by the reason the server gave, and Retry, Keep session for recovery and
Copy recovery record each appear once; the recovery copy carries every unsettled event. Retry always
retried the whole queue, so a button per row was the same button sixteen times, and the one answer
the server actually refused was indistinguishable from the fifteen waiting their turn. The summary
counts work that needs the owner separately from work that is merely queued, so one refused answer
among fifteen waiting reads as one. Every event keeps its record and its receipt.

For a permanently rejected ended sitting, Keep session for recovery requires confirmation. One local
transaction archives all its undelivered answers/cancellations and closes that sitting to further
writes. It preserves every original event and reports that they were not synchronized. Automatic
retry excludes this archive; a fresh server-authorized sitting can proceed from server schedules.
Archiving alone never fabricates a Review or server acknowledgement. Recovery-copy access stays
available. Synchronized history is kept on the device and not listed; while an archive holds events the
server never confirmed, the status says they were kept and not synchronized. If a validated
acknowledgement was already in flight during concurrent recovery closure, it is stored inside the
retained archive, which then counts as settled.
Its authoritative Card is reconciled; the closed sitting is never reopened for delivery.

Expiry/sign-out/account switching revoke delivery and local access before late results can publish.
The original account database remains intact and is revisited only after matching authentication.
Account cookies and session material never enter the outbox. Known local identity is not authentication.

## Verification and physical-phone acceptance

Real PostgreSQL/RLS coverage exercises original and altered exact retries, cancellation identity,
concurrent cancellation/later Review replay, retained deletion/purge, restart, account/expiry rejection
and delayed delivery across the original timezone/day-cutoff and learning-step boundary. Browser
coverage holds local transactions and server responses separately; exercises offline continuation,
reload, lost answer/cancellation responses, quota/abort and acknowledgement-storage failures,
account switching, sign-out, explicit archive recovery and bounded large history. A separate built-PWA
HTTP/PostgreSQL journey reopens offline with undelivered answers, Undo and regrading, loses a real
committed response, retries exactly and verifies immutable history and canonical schedules.

PR #51 pre-stabilization verification passed all 1,095 unit/PostgreSQL tests, 560 built phone/desktop interactions
(ten opt-in selection skips), 77 targeted mobile WebKit cases, both real-PWA Review journeys,
66 unchanged Windows visual contracts and all five enforced 55 FPS cases. Package typechecks,
source lint, isolation/design checks, tracked-file formatting and the production build also pass.
Matched baseline measurements and platform limits are in `interaction-performance.md`.

Phase 8.3 was merged through PR #50 and physically accepted by the owner. Phase 8.4 physical-iPhone
acceptance is separate from Chromium, WebKit, screenshot and database evidence. After protected delivery:

1. Open the installed PWA online, confirm Study readiness, start a multi-Card sitting and enable airplane
   mode. Grade, Undo, regrade and continue through the admitted Cards. Check familiar reveal/typing/
   learning motion and existing time limits; exit should release after the local save.
2. Exit with pending answers, close/reopen the PWA offline and inspect Settings. Saved answers must
   survive and historical Undo must remain unavailable. New offline Study follows the Phase 8.5
   planning and conservative admission rules above.
3. Reconnect/sign in to the same account. Verify pending delivery clears, history has no duplicate
   answers and Card intervals/learning steps match the authoritative results. Repeat interruption near
   answer/Undo delivery; Retry must preserve the original events.
4. Check Note conflict comparison/copy/apply recovery and saved Folder/Deck names. Small and large
   settled histories should be compact by default, disclose details accessibly and preserve originals.
5. Scroll Settings under the status bar in installed mode, portrait/landscape and light/dark themes.
   Confirm the safe-area cover stays opaque, fixed navigation stays still and the keyboard does not
   shift mounted forms. Browser emulation does not establish physical safe-area painting.
6. Compare cold/warm navigation, Study entry/exit and editor typing with the accepted experience.
   Sign out/switch accounts with pending work: the other account must not expose or send it; signing
   back into the original account should recover it.

## Phase 8.4 stabilization acceptance

PR #52 merged at `f37c236` with required checks passing, but its physical-iPhone acceptance failed.
PR #53 subsequently merged at `5d9c680`. The owner now confirms installed production iPhone acceptance
of offline access and the interaction follow-up. This closes the Phase 8.4 blocker, separately from
Phase 8.5 acceptance.
The stabilization preserves Review/Undo schemas, identities, causal predecessors, exact retry,
authoritative replay and retained recovery archives. Startup restoration is independent of a suspended
account fetch; a remembered account never authorizes delivery. The Study regression now checks local
committed intents, recorded HTTP and synchronized acknowledgements as separate milestones.

Offline readiness and saved work share one Settings card. Active work retains direct recovery actions;
settled receipts use optional, bounded history. Disclosure labels and controls appear as complete units during expansion,
and settled parents follow natural height. Grammar fields remain mounted through disclosure changes.
Password dialogs retain Radix focus management and recovery-code dismissal safeguards.

Before accepting production, repeat offline cold reopening of an upgraded existing download, live
connection loss, authenticated reconnection, saved Note/name work and admitted Study answer/Undo
persistence on the owner's installed iPhone. Confirm complete disclosure text and stable password
focus with the native keyboard. Browser evidence is separate from this device acceptance.

PR #52's pre-acceptance verification passed 1,096 unit/PostgreSQL tests, 570 built phone/desktop
interactions (ten existing opt-in skips), 36 focused Chromium/mobile WebKit cases and eight
worker-enabled PWA/database cases. The latter include the actual PR #50 shell upgrade and real
PostgreSQL Note/name delivery, Review/Undo persistence, exact retries and authoritative replay.
All 66 unchanged Windows visual contracts and five enforced 55 FPS performance cases pass.
Required hosted checks and the installed-iPhone acceptance above remain separate release gates.

## Phase 8.4 installed-iPhone acceptance

PR #53 merged at `5d9c680`. The owner confirms that offline access and the reported interaction
regressions work acceptably on the installed production iPhone. This closes the previous device
blocker; it is separate from instrumented browser frame measurements and Phase 8.5 acceptance.

## Phase 8.5 acceptance

PR #54 merged at `d69c69f` on 2026-10-15 with required CI and production migration checks passing.
The owner confirms that offline Study works on the installed iPhone. Its connectivity and learning
readiness acceptance failed, so the following stabilization requires a separate device pass.

The repair reproduces two false history restrictions: zero-based counter comparison rejects valid
mixed legacy/captured history, and rejecting every purged Card misclassifies retained attribution as
incomplete history. A content-free, read-only application-database audit confirms both patterns;
synthetic real PostgreSQL/RLS tests reproduce canonical counters, Undo, deletion and purge. The
owner's actual IndexedDB/outbox was not inspected, so the exact six-Card device queue is not claimed
as reproduced. Complete server snapshots and planner parity do not prove that device's download has
finished. Genuine missing history/settings/pending-work uncertainty remains conservative.

PostgreSQL/RLS tests compare complete downloaded snapshots against authenticated planning across
languages, directions, time budgets, study-day boundaries, inherited/paused scope, cancellation, restart
and changed settings. Causal pending answer/Undo/regrade matches real server delivery. Built-PWA
Chromium/mobile WebKit journeys cold-open after HTTP stops, start new Study, answer/Undo/regrade,
exit/reopen, withhold repeated admission and reconcile a lost response plus a concurrent remote answer.
Browser fixtures additionally exercise Typing/native Return, installed local voices, missing downloads,
settings uncertainty, session rejection and sign-out. Physical-iPhone evidence remains separate.

The stabilization release passes fifteen real PostgreSQL/RLS planner comparisons, twenty-two pure
snapshot guards and six worker-enabled HTTP/PostgreSQL PWA journeys across Chromium/mobile WebKit.
The final full unit/PostgreSQL run passes 1,139 tests. Canonical schedules and exact event identities
are compared after interrupted delivery, remote answers, Undo and regrading; completed reconciliation
also verifies that retained account revision, download cursor and learning readiness agree.

After protected stabilization delivery, use the installed production PWA and its existing download:

1. Receive the update online, confirm the download and installed target-language voices, then close all
   windows. Enable airplane mode and cold-open Today. Confirm familiar setup, correct language/direction,
   one-off time, admission explanation and responsive navigation without a storage reset.
2. Start Study offline. Use recognition, Typing/native Return and supported local Listening. Grade, Undo,
   regrade and finish or stop. Check progress, glass/motion, keyboard geometry and immediate advancement
   after local saving, including a learning/relearning retry when due.
3. Close/reopen offline. Confirm saved answers remain in Settings, no previous sitting/Undo stack is
   implied, and the next plan accounts for committed work across languages and the study-day cutoff.
   Where settings/history are uncertain, confirm new material/override are restricted with clear recovery.
4. Reconnect to the same account, including interruption near answer/Undo delivery. Confirm exact retries,
   no duplicate/lost answers and authoritative scheduling. Check sign-out/account switching retain work
   only in its owning account. Compare Today/Deck/Note/Settings responsiveness with accepted PR #53.
5. On home Wi-Fi and moving mobile internet, navigate Today/Library/Deck/Note, background and resume,
   and allow slow responses. Confirm no repeated false Offline transitions, stable geometry/setup and
   automatic recovery. In airplane mode, confirm prompt local access. One Check connection action
   should show checking and recover when healthy; repeated taps must not restart progress. Export
   content-free lifecycle diagnostics if native behavior differs from the verified browser journeys.
