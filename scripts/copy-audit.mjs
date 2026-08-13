/**
 * Every user visible string, in both languages, with what looks wrong with it.
 *
 * Run with `pnpm copy-audit`. It writes `docs/copy-audit.md`, which is the list
 * the copy pass works from, and it is a script rather than a document so the
 * list can be regenerated after the copy changes instead of going stale.
 *
 * The flags are mechanical. Some of them are wrong, and the length one in
 * particular fires on short labels where a few characters either way is a large
 * percentage. It is a list to read, not a list of defects.
 *
 * The rules that are not judgement calls, the form of address and the name of
 * the second factor, are checked by `packages/shared/src/i18n/i18n.test.ts`
 * instead, where a regression fails the build.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  .split(path.sep)
  .join('/');

function load(file) {
  const src = readFileSync(`${root}/packages/shared/src/i18n/${file}`, 'utf8');
  const start = src.indexOf('{', src.indexOf('export const'));
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src
    .slice(start, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return eval(`(${body})`);
}

const en = load('en.ts');
const ru = load('ru.ts');
const keys = [...new Set([...Object.keys(en), ...Object.keys(ru)])].sort();

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = `${dir}/${e}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) out.push(full);
  }
  return out;
}

const used = new Set();
for (const dir of [`${root}/apps/web/src`, `${root}/apps/api/src`, `${root}/packages/shared/src`]) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/'([a-z][a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)'/g)) used.add(m[1]);
  }
}

const PRONOUN = /(?<!\p{L})(?:вы|вас|вам|вами|ваш(?:а|е|и|его|ей|их|у|им|ими|ем)?)(?!\p{L})/iu;
const IMPERATIVE = /(?<!\p{L})[а-яё]{2,}(?:йте|ите|ьте)(?!\p{L})/iu;
const CALQUE = /в два шага|двухэтапн|двухшагов/iu;

// A button whose label is a bare verb says nothing about what it changes.
const BARE_VERB_EN =
  /^(save|cancel|continue|retry|try again|turn on|turn off|enable|disable|remove|delete|close|copy|download|send|submit|confirm|next|back|ok)$/i;
const BARE_VERB_RU =
  /^(сохранить|отмена|отменить|продолжить|повторить|включить|выключить|удалить|закрыть|скопировать|скачать|отправить|подтвердить|далее|назад|выйти)$/i;

// An error that names a problem and no way forward.
const ACTIONABLE =
  /[.!?]\s+[A-ZА-ЯЁ]|,\s*(чтобы|so that|then)|попроб|подожди|выбери|введи|задай|напиши|запроси|подтверди|try|wait|pick|choose|type|ask|check|use|keep|save/i;

const rows = keys.map((key) => {
  const e = en[key];
  const r = ru[key];
  const flags = [];

  if (e === undefined) flags.push('only-ru');
  if (r === undefined) flags.push('only-en');
  if (!used.has(key) && !key.startsWith('error.')) flags.push('unreferenced');

  if (typeof e === 'string' && typeof r === 'string') {
    const ratio = Math.max(e.length, r.length) / Math.max(1, Math.min(e.length, r.length));
    if (ratio > 1.4) flags.push(`length-${Math.round((ratio - 1) * 100)}%`);

    const eVars = [...e.matchAll(/\{(\w+)/g)]
      .map((m) => m[1])
      .sort()
      .join(',');
    const rVars = [...r.matchAll(/\{(\w+)/g)]
      .map((m) => m[1])
      .sort()
      .join(',');
    if (eVars !== rVars) flags.push('placeholders-differ');

    const se = (e.match(/[.!?](\s|$)/g) || []).length;
    const sr = (r.match(/[.!?](\s|$)/g) || []).length;
    if (Math.abs(se - sr) > 0) flags.push(`sentences-${se}v${sr}`);

    if (PRONOUN.test(r) || IMPERATIVE.test(r)) flags.push('form-of-address');
    if (CALQUE.test(r)) flags.push('calque');

    const buttonish =
      /\.(submit|enable|disable|confirm|copy|download|regenerate|resend|retry|save|cancel|continue|signOut|setUp)$/.test(
        key,
      ) || /^common\./.test(key);
    if (buttonish && (BARE_VERB_EN.test(e.trim()) || BARE_VERB_RU.test(r.trim())))
      flags.push('bare-verb-label');

    if (
      key.startsWith('error.') ||
      /\.(invalid|failed|exhausted|unavailable|reused|tooShort|tooLong|tooCommon|closed)$/.test(key)
    ) {
      if (!ACTIONABLE.test(e) || !ACTIONABLE.test(r)) flags.push('no-next-step');
    }
  }

  return { key, en: e, ru: r, flags, used: used.has(key) };
});

/** Maps a flag to the family it belongs to, so the summary counts add up. */
function family(flag) {
  if (flag.startsWith('length-')) return 'length';
  if (flag.startsWith('sentences-')) return 'sentences';
  if (flag === 'placeholders-differ') return 'placeholders';
  if (flag === 'bare-verb-label') return 'bare-verb';
  return flag;
}

const counts = {};
for (const row of rows)
  for (const f of row.flags) {
    const name = family(f);
    counts[name] = (counts[name] || 0) + 1;
  }

const flagged = rows.filter((r) => r.flags.length);

const esc = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');

const lines = [];
lines.push('# Copy audit');
lines.push('');
lines.push(
  'Every user visible string in the product, in both languages, with what looks wrong with it.',
);
lines.push('');
lines.push('Regenerate with `pnpm copy-audit`. Do not edit by hand.');
lines.push('');
lines.push(
  'Generated from `packages/shared/src/i18n/en.ts` and `ru.ts`, which is where every string lives:',
);
lines.push(
  'nothing user visible is written in a component. The flags are mechanical and some of them are',
);
lines.push(
  'wrong; the length one fires on short labels where two characters either way is a large',
);
lines.push('percentage. They are a list to read, not a list of defects.');
lines.push('');
lines.push('## Already applied');
lines.push('');
lines.push('These were not judgement calls, so they are done rather than listed:');
lines.push('');
lines.push('- English says two-factor authentication, then 2FA after the first mention.');
lines.push('- Russian says двухфакторная аутентификация, then 2FA. "Вход в два шага" is gone.');
lines.push('- Russian addresses the reader as ты throughout. Thirty strings used вы.');
lines.push('- The four security buttons name what they change instead of naming a verb.');
lines.push(
  '- `common.close` and `common.loading` exist. Both were English written into a component.',
);
lines.push('');
lines.push(
  'The first three are checked by `packages/shared/src/i18n/i18n.test.ts`, so they cannot',
);
lines.push('come back without failing the build.');
lines.push('');
lines.push('## The count');
lines.push('');
lines.push('| | |');
lines.push('| --- | --- |');
lines.push(`| Strings, each in two languages | **${keys.length}** |`);
lines.push(`| Referenced by name somewhere in \`apps/\` | ${rows.filter((r) => r.used).length} |`);
lines.push(
  `| Reached only through a computed key (\`error.\${code}\`) | ${rows.filter((r) => !r.used && r.key.startsWith('error.')).length} |`,
);
lines.push(
  `| Present in one language only | ${rows.filter((r) => r.flags.some((f) => f.startsWith('only-'))).length} |`,
);
lines.push(`| Carrying at least one flag | ${flagged.length} |`);
lines.push('');
lines.push('## What the flags mean');
lines.push('');
lines.push('| Flag | Meaning | Count |');
lines.push('| --- | --- | --- |');
const meanings = {
  length:
    'The two languages differ in length by more than 40%. Russian normally runs 10 to 15% longer than English, so a gap this wide usually means one side says something the other does not.',
  sentences:
    'One language uses a different number of sentences from the other. Same signal as length, harder to argue with.',
  placeholders: 'The two carry different placeholders. One of them will render a literal brace.',
  'form-of-address': 'Russian addresses the reader as вы. This project uses ты.',
  calque: 'A phrase translated word for word out of English. Nobody says it in Russian.',
  'bare-verb': 'A control whose label is a verb and nothing else. It does not say what it affects.',
  'no-next-step': 'An error or refusal that names the problem without saying what to do about it.',
  'only-en': 'Exists in English only.',
  'only-ru': 'Exists in Russian only.',
  unreferenced: 'No code refers to this key. Either dead, or reached through a computed key.',
};
for (const [flag, meaning] of Object.entries(meanings)) {
  lines.push(`| \`${flag}\` | ${meaning} | ${counts[flag] ?? 0} |`);
}
lines.push('');
lines.push('## Flagged strings');
lines.push('');
lines.push('| Key | Flags | English | Russian |');
lines.push('| --- | --- | --- | --- |');
for (const r of flagged) {
  lines.push(`| \`${r.key}\` | ${r.flags.join(', ')} | ${esc(r.en ?? '')} | ${esc(r.ru ?? '')} |`);
}
lines.push('');
lines.push('## Every string');
lines.push('');
lines.push('| Key | English | Russian |');
lines.push('| --- | --- | --- |');
for (const r of rows) {
  lines.push(`| \`${r.key}\` | ${esc(r.en ?? '')} | ${esc(r.ru ?? '')} |`);
}
lines.push('');

writeFileSync(`${root}/docs/copy-audit.md`, lines.join('\n'));

console.log(`total ${keys.length}, flagged ${flagged.length}`);
console.log(JSON.stringify(counts, null, 1));
