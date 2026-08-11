import { describe, expect, it } from 'vitest';

import { DEFAULT_DECK_SETTINGS } from '@neuron/shared';

import { openingDirections } from './note-cards.js';

/**
 * Which cards a new note starts with.
 *
 * A vocab note can produce four. Creating four on day one triples the work of
 * day one for a note nobody has learned once yet, which is the failure this
 * project exists to avoid, so it starts with one and the rest open later.
 */

const ladder = DEFAULT_DECK_SETTINGS.ladder;

describe('openingDirections', () => {
  it('opens only the rung that needs nothing before it', () => {
    const opening = openingDirections(
      'vocab',
      { term: 'das Haus', translation: 'the house' },
      ladder,
    );

    expect(opening).toEqual(['recognition']);
  });

  it('does not open a direction the note cannot produce', () => {
    // A listening card needs audio. The ladder can ask for it all it likes.
    const opening = openingDirections('vocab', { term: 'das Haus', translation: 'the house' }, [
      { direction: 'listening', opensAtStability: 0 },
    ]);

    expect(opening).not.toContain('listening');
  });

  it('falls back to what the type can produce when the ladder does not overlap', () => {
    /**
     * A cloze note produces one direction called `cloze`, and the default
     * ladder talks about recognition and recall. Without the fallback the note
     * would be created with no cards at all, which from the outside looks
     * exactly like the note not being created.
     */
    const opening = openingDirections('cloze', { text: 'Ich {{gehe}} nach Hause' }, ladder);

    expect(opening).toEqual(['cloze']);
  });

  it('opens a listening card once there is audio to listen to', () => {
    const opening = openingDirections(
      'vocab',
      { term: 'das Haus', translation: 'the house', audio: 'haus.mp3' },
      [{ direction: 'listening', opensAtStability: 0 }],
    );

    expect(opening).toEqual(['listening']);
  });

  it('opens several at once when the ladder says several start together', () => {
    const opening = openingDirections('basic', { front: 'a', back: 'b' }, [
      { direction: 'recognition', opensAtStability: 0 },
      { direction: 'recall', opensAtStability: 0 },
      { direction: 'production', opensAtStability: 14 },
    ]);

    expect(opening).toEqual(['recognition', 'recall']);
  });
});
