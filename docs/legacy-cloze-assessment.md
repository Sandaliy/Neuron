# Legacy Cloze slot assessment

## Proven cause and seed correction

The original database seed (`1dcb86d`) created one Card per Cloze Note without a slot.
The Phase 6 planner (`8e95105`, PR #3) introduced per-gap Cards, while the seed kept
the earlier construction. The repository's omitted-slot default is still 0.
Migration `0009_wooden_storm.sql` also gave pre-existing Cards slot 0 without
mapping historical Cloze content to a particular gap.
For the seed's bare `{{answer}}` gaps, `clozeGaps` numbers from 1; `possibleCards`
produces one Card per distinct number, sorted by number. Explicit numbers are
preserved and repeated numbers share a Card. Normal application creation uses
`openingCards` and persists its direction and slot.

The seed now calls that same opening planner, includes the slot in deterministic
Card identifiers, and carries the slot through both new and reviewed Card writes.
Its four Cloze Notes produce seven displayable Cards: slots `[1, 2]`, `[1, 2]`,
`[1, 2]`, `[1]`. The first two Notes still receive simulated histories, now for
each of their Cards. Each history independently replays to the stored FSRS state.
No scheduling, admission, Study, Note creation, sync or persistence contract changes.

New seed identities deliberately include the slot. This is a seed correction,
not a rewrite of existing Card identities. **Do not rerun the seed to repair an
existing account:** the seed erases and recreates its demo account and Reviews.

## Read-only inventory

`apps/api/src/db/seed/cloze-assessment.ts` requires an explicit connection and user id:

```powershell
# Supply CLOZE_ASSESS_DATABASE_URL through the local environment/secret store.
pnpm --filter @neuron/api exec tsx src/db/seed/cloze-assessment.ts <user-id>
# Optional local detail: identifiers, gap slots, history counts and lifecycle flags.
pnpm --filter @neuron/api exec tsx src/db/seed/cloze-assessment.ts <user-id> --details
```

Use the restricted application role. The tool binds `app.user_id`, explicitly
filters ownership, takes a repeatable-read READ ONLY transaction, and rolls back.
There is no connection fallback, migration, seed execution or mutation mode.
Default output contains aggregate counts only; detail contains no Note content,
email, credential or Review payload. Keep identifier details local.

Scope is deliberately narrow: system Cloze Notes owning `cloze` direction slot-0
Cards, including deleted Cards/Notes and deleted canonical siblings. It compares
against the maintained parser/planner, not an independent SQL gap regex. The
current parser accepts explicit `{{c0::answer}}`; those valid slot-0 faces are
excluded. Other invalid slots, converted Note types, custom types, missing Notes,
and unrelated unavailable faces are outside this inventory. Purged content is
not reconstructed and cannot establish a repair candidate.
Counts include retained deleted records; they are **not** a recomputation of
Daily Study eligibility, admission or overdue workload. Inactive/suspended flags
are available in detail. An empty result establishes only this named scope.

History counts include every immutable Review row, including pre-reset answers,
reset events and cancellation events. Neither `reps = 0` nor the effective replay
window is evidence of no history. A candidate also requires pristine new state,
no reset marker, no memory state and no placed due date.

On 2026-10-31, a read-only snapshot of **only the existing demo user in the locally
configured runtime database** found four affected Cards: three `ambiguous-gap`
and one `single-gap-unreviewed-candidate`. Together they owned 15 immutable Review
rows; there were no live canonical-slot collisions in this scope. No records were
changed. This is not an all-account production inventory, and the connection was
not independently matched to the deployed production configuration.

## Proposed historical resolution; approval required before implementation

| Case                                                                                        | Safe proposed treatment                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One canonical gap, pristine Card, zero immutable Reviews, no live or deleted target sibling | Candidate for changing **only the existing Card's slot** to the sole canonical slot (which need not be 1). Retain id, schedule, unlock/suspension state and every other value except required revision/update metadata. Recheck the Note and siblings transactionally before any write.                                                                                                                                                         |
| One gap, reviewed or stateful Card                                                          | Slot-only retarget can preserve identity, numerical FSRS state and Review foreign keys, because replay does not depend on slot. That does not prove the historical answers belong to the current gap. Require evidence of the intended semantic target and explicit approval; otherwise retire it with history retained.                                                                                                                        |
| Multiple gaps, even if only one gap is currently missing a Card                             | Do not infer the legacy Card's intended target from its slot or the missing slot. Require an explicit mapping decision or retire the invalid Card and create missing canonical Cards as new. Never copy one schedule/history onto several Cards.                                                                                                                                                                                                |
| A live canonical sibling already exists (PR #61's slot-0 plus slot-1 example)               | Keep that sibling's id, schedule and Reviews. PostgreSQL's live `(note_id, direction, slot)` unique index rejects retargeting slot 0 onto it. Do not merge identities, reparent Reviews, overwrite the valid Card, or infer that slot 0 means slot 2. Proposed default is approved soft deletion of the invalid Card, retaining its immutable Reviews; create only genuinely missing canonical Cards after approving their new-workload effect. |
| A deleted canonical sibling exists                                                          | Require a restore/history decision before retargeting, even though the partial live unique index would permit it. Do not create a future restore collision silently.                                                                                                                                                                                                                                                                            |
| Deleted Note/Card or malformed/gapless Note                                                 | Retain for a separate lifecycle/content decision. Do not revive deleted work or alter Note content as a repair side effect.                                                                                                                                                                                                                                                                                                                     |

Before any production migration, the owner must approve the account scope,
reviewed-Card semantic mappings, collision retirement policy, and whether/when
missing canonical Cards enter new-card admission. Existing invalid Cards may
still occupy planning/workload capacity until that separate change is approved.
The migration must preserve immutable Reviews and Card identity where retargeted,
use user binding and the account write lock, recheck revisions/collisions, publish
changed Card revisions through the existing sync stream, and address outstanding
offline events before reinterpretation or retirement. Verify schedule equality,
effective replay (including resets/cancellations), unchanged Review rows and
idempotency on a disposable snapshot first. No such migration is included here.

## Verification

- `seed.test.ts`: seven canonical Cloze identities/slots and displayable fronts/
  backs; exact replay of every reviewed Cloze slot; new-state checks for the
  others; fixed-time rerun equality of all Card identities/schedules and Review
  values. Existing collection, non-ASCII, state diversity and replay checks remain.
- `cloze-assessment.test.ts`: pristine candidates, explicit numbers including c0,
  ambiguity, live/deleted collisions, retained deletion, malformed content and
  immutable history despite zero reps; real PostgreSQL user isolation, unchanged
  Card/Review snapshots, unique-index rejection of a colliding retarget and a
  rollback-only demonstration that a reviewed single-gap Card's slot can change
  without changing its identity, schedule or Review rows. This last check proves
  numerical compatibility, not historical semantic intent.
- Existing `card-plan.test.ts`, `note-types.test.ts`, Study display tests and
  `tests/study.spec.ts` cover canonical generation and unchanged rendering/skipping.

Database verification uses a dedicated throwaway database, separate from the
runtime database and the parallel feature's test database. Browser checks use the
built application with the CI preview-server configuration.

Passing focused checks on 2026-10-31:

```text
pnpm exec vitest run --project api apps/api/src/db/seed/seed.test.ts apps/api/src/db/seed/cloze-assessment.test.ts
  seed: 9 passed; assessment: 10 passed
pnpm exec vitest run --project api apps/api/src/db/seed/cloze-assessment.test.ts
  final assessment, including the additional retarget demonstration: 11 passed
pnpm exec vitest run --project shared packages/shared/src/card-plan.test.ts packages/shared/src/note-types.test.ts
  38 passed
pnpm exec vitest run --project web apps/web/src/features/today/card-display.test.tsx
  6 passed
pnpm --filter @neuron/web test:screens:ci tests/study.spec.ts --project=webkit-phone-interaction
  12 passed: four Study checks each on phone, desktop and WebKit phone
pnpm --filter @neuron/api typecheck
  passed
```

Scoped ESLint, Prettier and `git diff --check` also pass. A same-time comparison
against `b5fedc6` in the disposable database found all 125 non-Cloze Card values
and 760 non-Cloze Review values unchanged (excluding generated Review ids and
write/revision metadata). Total Cards changed from 129 to 132 and Reviews from
774 to 783 because the additional Cloze gaps now have independent histories.
The assessment found four invalid Cloze Cards before correction and zero after.
