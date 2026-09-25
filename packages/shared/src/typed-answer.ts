/** Local feedback only. Never maps spelling quality to a scheduling rating. */
export type TypedFeedback = 'exact' | 'correct' | 'close' | 'incorrect';

export interface SpellingPart {
  readonly kind: 'correct' | 'incorrect' | 'missing' | 'extra';
  readonly text: string;
  readonly expected?: string;
}

/** Minimum-edit alignment keeps the suffix stable after an inserted or omitted letter. */
export function spellingFeedback(
  input: string,
  answer: string,
  variants: readonly string[] = [],
  language?: string,
): { answer: string; parts: SpellingPart[] } {
  const value = normalizeAnswer(input, language);
  const accepted = [answer, ...variants];
  const exact = accepted.find((candidate) => normalizeAnswer(candidate, language) === value);
  if (exact !== undefined)
    return { answer: exact, parts: [{ kind: 'correct' as const, text: input }] };
  const original = Array.from(input.normalize('NFC'));
  const a = original.map((letter) => normalizeAnswer(letter, language) || ' ');
  // Bound quadratic work for pasted essays; still display both complete strings.
  if (a.length > 200)
    return { answer, parts: [{ kind: 'incorrect' as const, text: input, expected: answer }] };
  function align(candidate: string) {
    const b = Array.from(normalizeAnswer(candidate, language));
    if (b.length > 200) return undefined;
    const cost = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        cost[i]![j] = Math.min(
          cost[i - 1]![j]! + 1,
          cost[i]![j - 1]! + 1,
          cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    const parts: SpellingPart[] = [];
    let i = a.length,
      j = b.length;
    while (i || j) {
      if (i && j && cost[i]![j] === cost[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
        parts.unshift({
          kind: a[i - 1] === b[j - 1] ? 'correct' : 'incorrect',
          text: original[--i]!,
          expected: b[--j]!,
        });
      } else if (j && cost[i]![j] === cost[i]![j - 1]! + 1) {
        parts.unshift({ kind: 'missing', text: b[--j]! });
      } else {
        parts.unshift({ kind: 'extra', text: original[--i]! });
      }
    }
    return { answer: candidate, parts, distance: cost[a.length]![b.length]! };
  }
  return (
    accepted
      .map(align)
      .filter((item) => item !== undefined)
      .sort((left, right) => left.distance - right.distance)[0] ?? {
      answer,
      parts: [{ kind: 'incorrect' as const, text: input, expected: answer }],
    }
  );
}

export function normalizeAnswer(value: string, language?: string): string {
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  // Turkish and Azerbaijani distinguish dotted and dotless I even in casing.
  return language === 'tr' || language === 'az'
    ? text.toLocaleLowerCase(language)
    : text.toLowerCase();
}

export function checkTypedAnswer(
  input: string,
  answer: string,
  variants: readonly string[] = [],
  language?: string,
): TypedFeedback {
  const accepted = [answer, ...variants];
  if (accepted.includes(input)) return 'exact';
  const value = normalizeAnswer(input, language);
  if (!value) return 'incorrect';
  const normalized = accepted.map((item) => normalizeAnswer(item, language));
  if (normalized.includes(value)) return 'correct';
  // A spelling difference is always feedback, never silently accepted. Bound
  // work for long pasted text; short words cannot safely receive typo tolerance.
  if (Array.from(value).length > 200) return 'incorrect';
  return normalized.some((target) => closeSpelling(value, target)) ? 'close' : 'incorrect';
}

function closeSpelling(value: string, target: string): boolean {
  const a = Array.from(value);
  const b = Array.from(target);
  if (Math.min(a.length, b.length) < 4 || b.length > 200) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const differences = a.flatMap((letter, at) => (letter === b[at] ? [] : [at]));
    if (differences.length === 1) return true;
    const [first, second] = differences;
    return (
      differences.length === 2 &&
      first !== undefined &&
      second === first + 1 &&
      a[first] === b[second] &&
      a[second] === b[first]
    );
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let offset = 0;
  for (let at = 0; at < long.length; at++) {
    if (long[at] !== short[at - offset] && ++offset > 1) return false;
  }
  return true;
}
