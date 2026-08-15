# The design system

What the interface is made of, and the rules that keep a screen added in phase 9 looking like a screen
added in phase 5.

The gallery at `/dev/components` is the drawn version of this file. Read them together: this one says
why, the gallery says what it looks like, and the screenshot tests say whether either has changed.

Direction: restrained technical minimalism, dark by default, mobile first. One accent, one signal hue,
two font weights, and depth that comes from the layer a thing sits on rather than from shading every
control.

---

## Tokens

Two layers, in `packages/config/tokens.css`. That file is the only place in the repository where a
colour value may be written.

**Layer 1 is raw.** Numbered neutrals, one accent ramp, one signal hue, the spacing steps, the type
scale, the durations. A palette with no opinion about where anything is used. Nothing outside the token
file may name one.

**Layer 2 is semantic.** Every name says what the value is for. This is the whole vocabulary a
component speaks, and it is why the light theme is a thirty line override rather than a second
stylesheet.

`scripts/check-design-tokens.mjs` runs in `pnpm lint` and fails the build on a colour literal, a
spacing value off the scale, a raw duration, or a raw token name in a component.

### What each semantic name means

**Surfaces**, in the order of the depth ladder. Never skip a rung, and never nest a card in a card.

| Token                      | Utility             | Means                                                          |
| -------------------------- | ------------------- | -------------------------------------------------------------- |
| `--bg-canvas`              | `bg-canvas`         | The page. Everything sits on this                              |
| `--surface-sunken`         | `bg-sunken`         | A well: something belonging to the screen rather than on it    |
| `--surface-card`           | `bg-card`           | A block of content on the canvas                               |
| `--surface-raised`         | `bg-raised`         | A card being hovered or pressed                                |
| `--surface-input`          | `bg-input`          | A field, which is a hole rather than a slab                    |
| `--surface-selected`       | `bg-selected`       | The chosen cell in a group: the tab bar's pill                 |
| `--surface-floating`       | `bg-floating`       | The translucent tint of a bar or a toast                       |
| `--surface-floating-solid` | `bg-floating-solid` | The same layer with no blur. The fallback, and the `off` level |
| `--surface-sheet`          | `bg-sheet`          | A sheet or a panel over a scrim, which can be sheerer          |
| `--surface-nested`         | `bg-nested`         | Glass inside glass, which is opaque by rule                    |
| `--skeleton`               | `bg-skeleton`       | The shape of content that has not arrived                      |
| `--scrim`                  | `bg-scrim`          | Flat colour behind a sheet. Never blurred                      |

**Text.** The utility prefix supplies the role, so `--text-secondary` is `text-secondary`.

| Token              | Means                                                              |
| ------------------ | ------------------------------------------------------------------ |
| `--text-primary`   | The words themselves                                               |
| `--text-secondary` | Explanation, and anything read after the primary line              |
| `--text-tertiary`  | Captions and counts. **Banned on glass**, see Accessibility below  |
| `--text-disabled`  | A control that cannot be used. Not content, and does not meet AA   |
| `--text-accent`    | A link, a text action, and a number worth noticing                 |
| `--text-on-accent` | A label on the accent fill. White in both themes                   |
| `--text-error`     | What went wrong. The signal hue appears here and in nothing larger |

**Borders**: `--border-subtle` (a hairline between things that belong together), `--border-default` (a
field at rest), `--border-strong` (a field being hovered, and the sheet grabber), `--border-glass` (the
rim of a floating layer), `--border-accent` (a focused field; the same value as `--text-accent`).

**Fills**, which a control paints rather than a surface: `--fill-accent` and `--fill-accent-hover` (the
one primary action), `--fill-accent-quiet` (the background of a due chip), `--fill-neutral` and
`--fill-neutral-hover` (a quiet action), `--fill-error-quiet` (a slipping chip), `--fill-switch-off`,
`--fill-seg-thumb`, `--track-rail`.

**Focus**: `--focus-ring` is two pixels of accent at two pixels of offset; `--focus-halo` is the five
pixel glow behind it. The ring is instant and the halo fades over `--dur-1`.

**Elevation**: `--elev-1` a card, `--elev-2` a card being hovered, `--elev-3` chrome, `--elev-4` a
sheet. `--glass-rim`, `--glass-depth` and `--glass-edge` are the three parts of the glass edge.

### Scales

Spacing, 4px base: **4, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96**. The number in the utility is the
pixel value, so `p-16` is sixteen pixels.

Three more numbers exist as sizes rather than as rhythm, and the linter allows them only for that:
**44** (nothing tappable is smaller), **48** (a screen's own action), **52** (a dense note row).

Radius: **8** a chip, **12** a control, **18** a toast, **24** a card and the tab bar, **34** a sheet's
top corners, plus `full`.

Type: **12, 13, 14, 15, 17, 20, 24, 32, 44, 56**. Line height rises as size falls, and 44 and 56 are
numbers and one-word screen titles only. Body copy never goes below 14, and 12 is for mono labels and
counts. Letter spacing tightens only above 20, never on body text.

Weights: **400 and 600**. There is no third. Contrast comes from size and colour.

Motion: **`--dur-1` 90ms** a control changing state, **`--dur-2` 160ms** a reveal or a toast,
**`--dur-3` 240ms** a screen change or a scrim, **`--dur-4` 340ms** a sheet rising. Curves:
`ease-enter` arrives and settles, `ease-exit` leaves quickly, `ease-inout` changes on the spot,
`ease-spring` is the switch knob and the travelling pill and nothing else.

---

## Typography

One family: the platform's own interface face. SF Pro on an iPhone and a Mac, Segoe UI Variable on
Windows, Roboto on Android. Optical sizing, hinting and Cyrillic are already tuned for reading on a
phone, it costs zero bytes, and it is the reason system apps feel settled rather than designed.

Nothing is downloaded, so there is no `font-display`, no swap, and no reflow when a face lands late.

Numbers keep their own family. Every count, interval and code is set in the mono stack and marked
`data-numeric`, which also makes it tabular, so a count going from 9 to 10 does not move the row it
sits in.

Components name a role rather than a family: `font-ui`, `font-display`, `font-reading`, `font-mono`.
All four resolve to the same stack today. The mockup's second option sets the words in a reading serif,
and switching to it is two lines in `tokens.css` and nothing anywhere else.

---

## Component inventory

Everything the interface is built from. A new component needs a written reason and all seven states
before it ships.

**Action** (`ui/button.tsx`). `primary`, `quiet`, `text`, `destructive`. One primary per screen; two
accent fills on one screen is a bug. Destructive is text, never a red slab. States: default, hover,
active, focus, disabled, loading, and the destructive tone. Forty four tall at the smallest, forty
eight when it fills the width of a form.

**Field** (`ui/input.tsx`, `ui/textarea.tsx`, `ui/select.tsx`, `ui/range.tsx`, `ui/form-field.tsx`).
Text, textarea, select, range, and the code field, which is one field and not six boxes. `FormField`
carries the label, the hint, the error and the `aria-describedby` wiring. The password strength bar is
a `Progress` passed to `FormField` as `after`.

**Choice** (`ui/segmented.tsx`, `ui/switch.tsx`, `ui/checkbox.tsx`). Segmented replaces radios
everywhere and is for two or three options; it is native radio inputs, so the arrow keys are the
browser's own, and the thumb travels on `transform`. A switch is a capsule and a white disc. A
checkbox's mark is the accent fill framed by an inset ring, not a tick glyph.

**Row** (`ui/row.tsx`). `Row` is a deck row, a settings row, or anything with a title, a subtitle and
something at the far end. `TreeRow` and `TreeChildren` are the deck tree: indentation and a hairline,
never a second noun. `DenseRow` is a note in a list of five hundred: two lines, 52px, no avatar and no
icon. A pressable row is a button, and its focus ring is inset so a group's overflow cannot clip it.

**Container** (`ui/card.tsx`). `Card`, `Panel` (a well), `RowGroup` (rows sharing one card, separators
starting at the text), `GroupLabel`.

**Floating** (`ui/dialog.tsx`, `ui/toast.tsx`, `ui/sheen.tsx`, and the tab bar in `app/shell.tsx`).
Maximum two floating layers on screen. A dialog is a bottom sheet on a phone and a centred panel above
the breakpoint. A toast is one line with no action and leaves by itself.

**Status** (`ui/chip.tsx`, `ui/progress.tsx`, `ui/spinner.tsx`, `ui/states.tsx`). Four chip tones and
no others: due, new, slipping, scheduled. The spinner appears only inside a control that was pressed; a
screen gets a skeleton.

---

## Glass

One implementation, four ingredients: a translucent tint, a backdrop blur, a hairline border, and light
gathering at the edge. Glass says one thing, that this surface is above the content.

**Nothing in the content flow is ever glass.** Cards, list rows, fields and the study card are opaque,
always. Only bars, the tab bar, sheets, toasts and panels carry it.

**Never stack two blurred layers.** A glass element inside glass drops its blur and takes an opaque
nested tint. The rule is enforced in `global.css`, not left to discipline.

**Never animate the blur radius.** Layers arrive by transform and opacity with the radius already
fixed. `src/styles/motion.test.ts` and a Playwright test both check it.

### The three levels

| Level    | Blur | Tint      | Saturation | Where                                       |
| -------- | ---- | --------- | ---------- | ------------------------------------------- |
| `full`   | 34px | .78 / .54 | 1.9        | The default, and what the mockup recommends |
| `subtle` | 14px | .90 / .66 | 1.4        | Phones that stutter                         |
| `off`    | none | opaque    | none       | The same surfaces without the blur          |

The second tint number is for a sheet, which sits over a scrim that has already dimmed the backdrop and
can therefore be sheerer. Off is not a failure state: it is what a browser without `backdrop-filter`
already gets, and what the declared fallback background paints first in every case.

### The setting, and the ceiling

Settings › Appearance carries the choice, and it is a device preference: applied before React exists,
written synchronously, and never synced to the account. A phone and a laptop have different reasons for
their answer.

The level painted is the chosen one capped by what the device can afford. Three signals lower the
ceiling on their own, and when one does, the panel says so in plain words rather than quietly
disagreeing with the control:

- the system asks for reduced motion,
- the device reports four gigabytes of memory or less,
- a measured frame rate during a scroll falls below 55.

The first two are read before the first paint, in `index.html` and again in `preferences/glass.ts`. The
third arrives while the app is running, from `preferences/frame-rate.ts`, and steps the ceiling down one
level at a time. It needs two bad windows, not one, and it is session scoped: the next load measures
again.

### The budget

`apps/web/tests/performance.spec.ts` scrolls the library with five hundred rows, at the default level,
in a 375 by 812 viewport at two device pixels per css pixel, with the processor throttled to a quarter
speed through the debugger. The budget is 55 frames a second.

Measured: **60.0 fps, worst frame 16.8 ms**. That is the display cap with no frame dropped. The same
harness reports 58.4 fps at ten times throttling and 21.0 fps at twenty, so the number is a measurement
and not a ceiling the test cannot see past.

---

## Motion rules

Transform and opacity only. Never height, width, top, left, or filter.

- Forward navigation enters from the right at 14px, backward from the left. The direction is a spatial
  claim and has to match the hierarchy.
- Sheets rise from the bottom edge over `--dur-4` with `ease-enter` and leave over `--dur-3` with
  `ease-exit`. Exits are always faster than entrances.
- A sheet pushes the screen behind it back to 0.945 with the top edge as the origin. The screen is
  still there and still theirs.
- The card reveal moves 10px and scales .99 to 1 over `--dur-2`. It says the answer was already there.
- A pushed screen brings its content a beat behind itself: four rows, 26ms apart, then it stops.
- The focus ring is instant. The halo behind it fades over `--dur-1`.
- Errors shake once, 320ms, 4px. That is the only expressive motion in the system.
- No loops except the spinner and the skeleton sheen, and both stop when content arrives.
- `prefers-reduced-motion` collapses every duration to 1ms. States still change, nothing travels. The
  switch in Appearance does the same thing by hand.

Checked three ways: `src/styles/motion.test.ts` reads every keyframe in the stylesheet, including ones
no screen uses yet; `tests/motion.spec.ts` reads computed durations out of a real browser with the media
feature emulated and with the switch set; and the screenshot tests run with animations disabled so a
movement cannot hide a layout change.

---

## Composition rules

- One gutter: 20 on a phone, and content never touches it.
- A screen is a title block, content, and one floating layer. Titles are one line; a title that needs
  two is the wrong title.
- One primary action per screen. Everything else is quiet or text.
- Depth ladder in order: canvas, card, raised, floating. Never skip a rung, never nest a card in a card.
- Vertical rhythm from the scale only: 8 inside a group, 20 between groups, 24 between blocks.
- A sheet is for a decision belonging to the screen behind it. Anything with its own title and its own
  back is a screen.
- No screen is mostly empty. If content is thin, the screen carries the next action and the reason for
  it. None of the three states is a centred icon in a void.
- Numbers are mono and tabular. Counts and dates never shift the layout as they change.
- Frequent actions live in the bottom third. Minimum touch target 44. Safe area insets are respected,
  and so is the on-screen keyboard.

---

## Accessibility

Every ratio is computed from the token values by `src/styles/contrast.test.ts`, which prints all forty
on every run. AA is the floor, not the target.

| Surface                          | Primary | Secondary | Tertiary      | Accent |
| -------------------------------- | ------- | --------- | ------------- | ------ |
| Dark, canvas                     | 16.52   | 8.38      | 6.09          | 8.36   |
| Dark, card                       | 14.92   | 7.57      | 5.50          | 7.56   |
| Dark, bar glass, worst backdrop  | 9.06    | 4.60      | 3.34 · banned | 4.59   |
| Dark, sheet over the scrim       | 9.88    | 5.02      | banned        | —      |
| Light, canvas                    | 16.18   | 6.85      | 4.52          | 7.22   |
| Light, card                      | 16.91   | 7.16      | 4.73          | 7.54   |
| Light, bar glass, worst backdrop | 11.15   | 4.72      | 3.12 · banned | 4.98   |
| Light, sheet over the scrim      | 10.68   | 4.52      | banned        | —      |

White on the accent fill measures 6.68 in dark and 7.54 in light, so a filled control never changes its
label colour. Error text measures 6.89 on a dark card and 6.64 on a light one, and an error is always
marked by border and wording too, never by colour alone. The focus ring measures at least 7.12 against
every surface it can land on, well over the 3 it needs.

The glass rows use the worst backdrop that can really occur: the layer sitting directly over a
primary-text glyph. **Tertiary text is banned on glass in both themes**, and the ban is enforced rather
than documented: a blurred layer redefines `--text-tertiary` to the secondary tone, so a caption that
moves onto glass is corrected instead of failing quietly.

Disabled text sits below AA by design. A disabled control is not content, and its label is always
repeated in an adjacent hint that does pass.

---

## The words

Every string exists in both languages, written from the same intent rather than translated from each
other. Russian uses ты everywhere; the app belongs to one person.

### Glossary, and the only permitted pairs

| Concept           | English                        | Русский                            | Never                                 |
| ----------------- | ------------------------------ | ---------------------------------- | ------------------------------------- |
| deck (= folder)   | deck                           | набор                              | folder, папка, колода                 |
| note              | note                           | запись                             | заметка, факт                         |
| card              | card                           | карточка                           | —                                     |
| review            | review, to review              | повтор, повторить                  | ревью, тренировка                     |
| due               | to review, today               | на повтор, сегодня                 | просрочено, к сдаче                   |
| new               | new                            | новое                              | невыученное                           |
| stability         | holds for about 2 months       | держится ≈2 месяца                 | стабильность                          |
| difficulty        | hard for you                   | трудное для тебя                   | сложность, difficulty                 |
| target retention  | how often you want to remember | как часто хочешь вспоминать        | удерживаемость, ретеншн               |
| lapse             | forgot 3 times                 | забыл 3 раза                       | срыв, ошибка, провал                  |
| leech             | slipping                       | ускользает                         | пиявка, проблемное                    |
| session           | session                        | подход                             | сессия, сеанс                         |
| streak            | 6 days in a row                | 6 дней подряд                      | серия, стрик                          |
| daily time budget | minutes a day                  | минут в день                       | лимит, бюджет времени                 |
| wave              | wave, 8 new words let in       | волна, впустили 8 новых слов       | батч, партия                          |
| two-factor auth   | 2FA                            | двухфакторная аутентификация (2FA) | вход в два шага, двухэтапная проверка |
| recovery code     | recovery code                  | резервный код                      | код доступа, код восстановления       |
| direction         | ask both ways                  | спрашивать с двух сторон           | направление, реверс                   |

One word for one thing. A deck can contain decks, so the interface never says folder; nesting is shown
by indentation, not by a second noun.

### Copy rules

- Write each language natively. A word-for-word calque is a bug, and so is inventing a folksy
  replacement for a term people already know. 2FA is the name in both languages.
- A button says what will happen: a verb with its object, every time. A bare verb makes somebody look
  back at the heading to find out what they are agreeing to.
- An error says what happened, then what to do. No apology, no exclamation mark. Two sentences at most,
  and the second one is always doable.
- Outcome, not mechanism. The algorithm is our problem; the person needs to know what it costs them, in
  time and words kept.
- Shorter than you think. A label is shorter than a sentence, and most places need neither.
- A language names itself. Settings › Language is the one place a string is never translated.

The full string list, with what is wrong with each, is in `docs/copy-audit.md`, regenerated by
`pnpm copy-audit`.

---

## Adding a screen

1. Write both languages first, from the glossary. If a term is missing, add the pair to the glossary
   before writing the screen.
2. Name the one primary action. If there are two, it is two screens.
3. Compose from the inventory. A new component needs a written reason and all seven states.
4. Use semantic tokens only. If you need a value with no semantic name, add the semantic name. Never
   reach into the raw layer from a component.
5. Draw loading, empty and error at the same time as the default. A screen without its three states is
   not finished.
6. Check both themes and glass off. Anything that only works in one of them is not built yet.
7. Measure any new colour pairing and write the ratio next to it. AA is the floor.
8. Add it to the gallery at `/dev/components`, and add a screenshot test.
9. Scroll it on a phone. Below 55 frames a second the screen changes, not the phone.

---

## Running the checks

```
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm lint` includes the token check. `pnpm test` includes the contrast measurements and the motion
source check.

```
pnpm --filter @neuron/web test:screens
```

The Playwright suite: the gallery and the main screens in both themes at 375 and 1440, the reduced
motion checks, and the frame rate budget. It starts the dev server itself.

Baselines carry the platform in their name, because the interface face is the platform's own: the same
page is set in SF Pro on a Mac and Segoe UI on Windows, and neither is wrong. The committed baselines
are `win32`. That is also why the suite is not in CI, where the runner is Linux and has neither face. A
baseline is updated deliberately with `test:screens:update`, and the diff is the review.
