import { editorFields, filledPaths, readField } from '@neuron/shared';
import type { DeckNode, Note, PartOfSpeech } from '@neuron/shared';

import { useTranslate } from '../../i18n/locale';
import { settingsFor } from '../../lib/decks';
import { GroupLabel } from '../../ui/card';

import { NoteField } from './note-field';
import { NoteHeader } from './note-header';

/** Collection reading mounts no editor, autosave, scheduling or mutation controller. */
export function ReadOnlyNote({
  note,
  decks,
}: {
  readonly note: Note;
  readonly decks: readonly DeckNode[];
}) {
  const t = useTranslate();
  const settings = settingsFor(decks, note.deckId);
  const sections = editorFields({
    noteType: note.noteType,
    ...(typeof note.fields['partOfSpeech'] === 'string'
      ? { partOfSpeech: note.fields['partOfSpeech'] as PartOfSpeech }
      : {}),
    ...(settings.targetLanguage === undefined ? {} : { targetLanguage: settings.targetLanguage }),
    filled: filledPaths(note.fields),
  });
  return (
    <section data-screen="" data-note-reading="" className="flex flex-col gap-20">
      <NoteHeader title={t('note.edit')} decks={decks} deckId={note.deckId} readOnly />
      {sections.map((section) => {
        const fields = section.fields.filter((field) => {
          const value = readField(note.fields, field.path);
          return value !== undefined && value !== null && value !== '';
        });
        if (!fields.length) return null;
        return (
          <fieldset key={section.name} className="flex flex-col gap-16">
            {section.labelKey && <GroupLabel>{t(section.labelKey)}</GroupLabel>}
            <div
              className={
                section.name === 'grammar' ? 'grid grid-cols-2 gap-16' : 'flex flex-col gap-16'
              }
            >
              {fields.map((field) => (
                <div
                  key={field.path}
                  className={
                    section.name === 'grammar' && field.kind === 'multiline'
                      ? 'col-span-2 min-w-0'
                      : 'min-w-0'
                  }
                >
                  <NoteField field={field} value={readField(note.fields, field.path)} readOnly />
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
      {note.tags.length > 0 && (
        <div className="flex flex-col gap-8">
          <GroupLabel>{t('note.tags')}</GroupLabel>
          <p className="text-14 text-secondary">{note.tags.join(', ')}</p>
        </div>
      )}
      {note.source && (
        <div className="flex flex-col gap-8">
          <GroupLabel>{t('notes.filterSource')}</GroupLabel>
          <p className="text-14 text-secondary">{note.source}</p>
        </div>
      )}
    </section>
  );
}
