/** Local feedback only. Never maps spelling quality to a scheduling rating. */
export type TypedFeedback = 'exact' | 'correct' | 'close' | 'incorrect';

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
