import { NOTE_TYPES, NOTE_TYPE_TEMPLATES, noteFieldSummary } from '@neuron/shared';
import type { NoteTypeName } from '@neuron/shared';

import { stableId } from './stable-id.js';

import type { Pool } from '@neondatabase/serverless';

/**
 * The three built in note types, which belong to nobody.
 *
 * They are the same for every account, so they are rows with no owner rather
 * than a copy per user. The isolation policy on that table lets everyone read a
 * row with no owner and lets nobody write one, which makes them visible and
 * untouchable.
 *
 * Their shape is generated from the definitions in packages/shared, so the
 * description stored in the database and the validation applied on every write
 * cannot drift apart.
 *
 * One function, called by the seed and by the test setup both, because two
 * versions of "put the built in types in place" is exactly the sort of thing
 * that ends up disagreeing about ids.
 */

/**
 * The fixed id of a built in type.
 *
 * @param name which type
 * @returns its id, the same in every database
 */
export function systemNoteTypeId(name: NoteTypeName): string {
  return stableId(`note-type:${name}`);
}

/**
 * Writes the built in types, or brings them up to date.
 *
 * Matches on the name rather than on the id. The name is what everything else
 * looks these rows up by, and it is what the unique index is on, so an existing
 * row is updated in place whatever id it happens to carry. Matching on the id
 * instead breaks the moment a database already holds a row written when the ids
 * were derived differently, which is not hypothetical: it happened here.
 *
 * @param pool a connection as the owner, since these rows have no owner and the
 *   restricted role is not allowed to write them
 */
export async function installSystemNoteTypes(pool: Pool): Promise<void> {
  for (const name of NOTE_TYPES) {
    await pool.query(
      `insert into note_types (id, user_id, name, is_system, field_schema, card_templates)
       values ($1, null, $2, true, $3, $4)
       on conflict (coalesce(user_id, ''), name) where deleted_at is null do update
         set field_schema = excluded.field_schema,
             card_templates = excluded.card_templates,
             is_system = true,
             updated_at = now()`,
      [
        systemNoteTypeId(name),
        name,
        JSON.stringify(noteFieldSummary(name)),
        JSON.stringify(NOTE_TYPE_TEMPLATES[name]),
      ],
    );
  }
}
