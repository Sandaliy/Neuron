/** Queries return only affected identifiers. $1 is always the explicit account. */
export interface IntegrityCheck {
  readonly id: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly context: string;
  readonly sql: string;
}

/** Guard untrusted JSON before casting, while keeping the parent PK index usable. */
const uuidFromJson = (expression: string) =>
  `(case when ${expression} ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then (${expression})::uuid else null end)`;

// Keep the account-scoped parent join hash/merge eligible even when a new
// account is absent from statistics. Materialization prevents the outer
// violation predicates from reducing FULL JOIN to a quadratic nested loop.
const cardNotes = `with card_notes as materialized (
  select c.id,c.deck_id,c.deleted_at as card_deleted_at,
    n.id as visible_note_id,n.deck_id as note_deck_id,n.deleted_at as note_deleted_at
  from (select id,note_id,deck_id,deleted_at from cards where user_id=$1) c
  full join (select id,deck_id,deleted_at from notes where user_id=$1) n on n.id=c.note_id
)`;

export const structuralChecks: readonly IntegrityCheck[] = [
  {
    id: 'collection-parent',
    severity: 'error',
    context:
      'Parent is missing/inaccessible or is not a Folder. Inspect authoritative parent links under the same account.',
    sql: `select d.id from decks d left join decks p on p.user_id=$1 and p.id=d.parent_id
      where d.user_id=$1 and d.parent_id is not null and (p.id is null or p.kind<>'folder')`,
  },
  {
    id: 'collection-path',
    severity: 'error',
    context:
      'Cached ancestry disagrees with its parent. Includes tombstones; inspect moves and sync revisions.',
    sql: `select d.id from decks d left join decks p on p.user_id=$1 and p.id=d.parent_id
      where d.user_id=$1 and ((d.parent_id is null and d.path<>'{}'::uuid[])
        or (p.id is not null and d.path is distinct from p.path || p.id))`,
  },
  {
    id: 'collection-cycle-depth',
    severity: 'error',
    context:
      'Parent links cycle or exceed eight ancestors. Walk is capped at nine edges and does not trust cached paths.',
    sql: `with recursive ancestry as (
      select id as origin, id, parent_id, array[id] as seen, 0 as depth, false as cycle
      from decks where user_id=$1
      union all
      select a.origin,p.id,p.parent_id,a.seen || p.id,a.depth+1,p.id=any(a.seen)
      from ancestry a join decks p on p.id=a.parent_id and p.user_id=$1
      where not a.cycle and a.depth<9
    ) select distinct origin as id from ancestry where cycle or depth=9`,
  },
  {
    id: 'collection-live-parent',
    severity: 'error',
    context:
      'A live collection has a deleted parent. Deleted descendants with independent deletion operations are valid.',
    sql: `select d.id from decks d join decks p on p.id=d.parent_id and p.user_id=$1
      where d.user_id=$1 and d.deleted_at is null and p.deleted_at is not null`,
  },
  {
    id: 'collection-live-provenance',
    severity: 'warning',
    context:
      'Live collection retains deletion provenance. Review restoration history; legacy deleted rows without provenance are allowed.',
    sql: `select id from decks where user_id=$1 and deleted_at is null and deletion_id is not null`,
  },
  {
    id: 'note-parent',
    severity: 'error',
    context:
      'Note parent is missing/inaccessible or not a leaf Deck. Live Notes under deleted Decks are intentional and are not flagged.',
    sql: `select n.id from notes n left join decks d on d.id=n.deck_id and d.user_id=$1
      where n.user_id=$1 and (d.id is null or d.kind<>'deck')`,
  },
  {
    id: 'note-type',
    severity: 'error',
    context:
      'Note type is missing or inaccessible. Retained references to deleted types need separate historical assessment.',
    sql: `select n.id from notes n left join note_types t on t.id=n.note_type_id
        and (t.user_id=$1 or t.user_id is null)
      where n.user_id=$1 and t.id is null`,
  },
  {
    id: 'note-import-owner',
    severity: 'error',
    context:
      'Import provenance is missing/inaccessible. A Note may move away from its original import Deck and survive Import Undo.',
    sql: `select n.id from notes n left join import_batches b on b.id=n.import_batch_id and b.user_id=$1
      where n.user_id=$1 and n.import_batch_id is not null and b.id is null`,
  },
  {
    id: 'card-parent',
    severity: 'error',
    context:
      'Card Note or Deck is missing/inaccessible. Retained deleted and purged Cards must still have account-bound parents.',
    sql: `${cardNotes}, card_parents as materialized (
      select c.id,c.visible_note_id,d.id as visible_deck_id,d.kind
      from card_notes c full join (select id,kind from decks where user_id=$1) d on d.id=c.deck_id
    ) select id from card_parents
      where id is not null and (visible_note_id is null or visible_deck_id is null or kind<>'deck')`,
  },
  {
    id: 'card-deck-copy',
    severity: 'error',
    context:
      'Card Deck differs from its Note, including retained Cards. Inspect the atomic Note move and revisions.',
    sql: `${cardNotes} select id from card_notes
      where id is not null and deck_id<>note_deck_id`,
  },
  {
    id: 'card-live-deleted-note',
    severity: 'error',
    context:
      'Live Card belongs to a deleted Note. Independently retired Cards beneath live Notes are valid.',
    sql: `${cardNotes} select id from card_notes
      where id is not null and card_deleted_at is null and note_deleted_at is not null`,
  },
  {
    id: 'card-slot',
    severity: 'error',
    context:
      'Non-Cloze direction has a nonzero slot. Cloze zero is assessed against the maintained parser only in deep mode.',
    sql: `select id from cards where user_id=$1 and direction<>'cloze' and slot<>0`,
  },
  {
    id: 'card-memory',
    severity: 'error',
    context:
      'Schedule is structurally unusable: partial/nonfinite memory, nonfinite timestamps, or a non-pristine new state. No FSRS recomputation is used.',
    sql: `select id from cards where user_id=$1 and (
      not isfinite(due) or (last_review is not null and not isfinite(last_review))
      or (reset_at is not null and not isfinite(reset_at))
      or (placed_due is not null and not isfinite(placed_due))
      or (state<>'new' and (stability is null or difficulty is null or last_review is null))
      or (stability is not null and (stability<=0 or stability>='Infinity'::float8))
      or (difficulty is not null and not (difficulty between 1 and 10))
      or (state='new' and (reps<>0 or lapses<>0 or learning_step<>0)))`,
  },
  {
    id: 'review-card-owner',
    severity: 'error',
    context:
      'Immutable Review has no accessible same-account Card. Escalate before any learning-history operation.',
    sql: `with review_cards as materialized (
      select r.id,c.id as visible_card_id
      from (select id,card_id from reviews where user_id=$1) r
      full join (select id from cards where user_id=$1) c on c.id=r.card_id
    ) select id from review_cards where id is not null and visible_card_id is null`,
  },
  {
    id: 'review-cancellation',
    severity: 'error',
    context:
      'Cancellation target is missing/inaccessible, another Card, or another cancellation/reset. Cancellation time may equal the original answer time.',
    sql: `select r.id from reviews r left join reviews t on t.id=r.cancels_review_id and t.user_id=$1
      where r.user_id=$1 and r.cancels_review_id is not null and
        (t.id is null or t.card_id<>r.card_id or t.cancels_review_id is not null or t.resets_learning)`,
  },
  {
    id: 'review-memory',
    severity: 'error',
    context:
      'Immutable event has partial/nonfinite predecessor memory or nonfinite event times. Original offline submitted time is not compared with arrival order.',
    sql: `select id from reviews where user_id=$1 and (
      not isfinite(reviewed_at) or not isfinite(placed_due)
      or (state_before<>'new' and (stability_before is null or difficulty_before is null))
      or (stability_before is not null and (stability_before<=0 or stability_before>='Infinity'::float8))
      or (difficulty_before is not null and not (difficulty_before between 1 and 10)))`,
  },
  {
    id: 'review-restart',
    severity: 'error',
    context:
      'Reset event lacks its same-account restart receipt or has a different revision. Current Card location may have changed since restart.',
    sql: `select r.id from reviews r left join learning_restarts l on l.id=r.restart_id and l.user_id=$1
      where r.user_id=$1 and r.resets_learning and (l.id is null or r.rev<>l.rev)`,
  },
  {
    id: 'restart-count',
    severity: 'error',
    context:
      'Immutable restart receipt Card count differs from its reset events, including retained/purged Cards. Empty restarts are valid.',
    sql: `select l.id from learning_restarts l where l.user_id=$1 and
      l.card_count<>(select count(*) from reviews r where r.user_id=$1 and r.restart_id=l.id and r.resets_learning)`,
  },
  {
    id: 'restart-note-owner',
    severity: 'error',
    context:
      'Note-scoped restart names a missing/inaccessible Note. A later Note move or purge preserves the original restart scope.',
    sql: `select l.id from learning_restarts l left join notes n on n.id=l.note_id and n.user_id=$1
      where l.user_id=$1 and l.note_id is not null and n.id is null`,
  },
  {
    id: 'receipt-created-entity',
    severity: 'error',
    context:
      'Successful offline creation receipt has no accessible persisted entity. Tombstones count as present; failed/conflicting deliveries need no entity.',
    sql: `select null::uuid as id from sync_receipts s where s.user_id=$1 and (
      (s.outcome->'noteCreate'->'result'->>'status'='applied' and not exists (
        select 1 from notes n where n.user_id=$1 and n.id=${uuidFromJson("s.outcome->'noteCreate'->'result'->>'noteId'")})) or
      (s.outcome->'deckCreation'->'result'->>'status'='applied' and not exists (
        select 1 from decks d where d.user_id=$1 and d.id=${uuidFromJson("s.outcome->'deckCreation'->'result'->>'entityId'")})))`,
  },
  ...['import_batches', 'study_presets', 'practice_runs', 'learning_restarts'].map(
    (table): IntegrityCheck => ({
      id: `${table}-parent`,
      severity: 'error',
      context:
        'Referenced collection is missing/inaccessible. Historical receipts need not match current Note/Card location or live state.',
      sql: `select x.id from ${table} x left join decks d on d.id=x.deck_id and d.user_id=$1
      where x.user_id=$1 and x.deck_id is not null and d.id is null`,
    }),
  ),
  ...[
    'decks',
    'notes',
    'cards',
    'reviews',
    'study_presets',
    'import_batches',
    'practice_runs',
    'learning_restarts',
  ].map((table): IntegrityCheck => ({
    id: `${table}-revision`,
    severity: 'error',
    context:
      'Revision is negative, above the account head, or outside exact protocol number range. Shared revisions, zero and gaps in surviving rows are valid.',
    sql: `select x.id from ${table} x join "user" u on u.id=$1 where x.user_id=$1
      and (x.rev<0 or x.rev>u.current_rev or x.rev>9007199254740991)`,
  })),
  {
    id: 'note-purge',
    severity: 'error',
    context:
      'Purged Note retains content or has an unpurged Card. Reviews and scheduling attribution intentionally survive purge.',
    sql: `select n.id from notes n where n.user_id=$1 and n.purged_at is not null and
      (n.fields<>'{}'::jsonb or n.tags<>'{}'::text[] or n.source is not null or n.rank is not null
       or exists(select 1 from cards c where c.user_id=$1 and c.note_id=n.id and c.purged_at is null))`,
  },
  {
    id: 'collection-purge',
    severity: 'error',
    context:
      'Purged collection retains metadata or unpurged immediate descendants/Notes. Deleted operation IDs need not agree across independently deleted descendants.',
    sql: `select d.id from decks d where d.user_id=$1 and d.purged_at is not null and
      (d.name<>'' or d.settings is not null or d.deletion_id is not null
       or exists(select 1 from decks c where c.user_id=$1 and c.parent_id=d.id and c.purged_at is null)
       or exists(select 1 from notes n where n.user_id=$1 and n.deck_id=d.id and n.purged_at is null))`,
  },
  {
    id: 'purged-conflict-content',
    severity: 'error',
    context:
      'Conflict payload for a purged entity was not redacted. Identifiers only; inspect confidentially without exporting payloads.',
    sql: `select x.id from sync_conflicts x where x.user_id=$1 and (x.losing<>'{}'::jsonb or x.kept is not null) and (
      (x.entity='decks' and exists(select 1 from decks d where d.user_id=$1 and d.id=x.entity_id and d.purged_at is not null)) or
      (x.entity='notes' and exists(select 1 from notes n where n.user_id=$1 and n.id=x.entity_id and n.purged_at is not null)) or
      (x.entity='cards' and exists(select 1 from cards c where c.user_id=$1 and c.id=x.entity_id and c.purged_at is not null)))`,
  },
  {
    id: 'undo-receipt',
    severity: 'error',
    context:
      'Undo alias does not resolve to an immutable cancellation of its named target. Receipt fingerprints and payloads are never printed.',
    sql: `select null::uuid as id from sync_receipts s
      left join reviews c on c.user_id=$1 and c.id=${uuidFromJson("s.outcome->'reviewUndo'->>'cancellationId'")}
      where s.user_id=$1 and s.outcome ? 'reviewUndo' and
      (c.id is null or c.cancels_review_id::text is distinct from s.outcome->'reviewUndo'->>'targetId')`,
  },
];
