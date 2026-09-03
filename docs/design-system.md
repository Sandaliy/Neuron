# The design system

What the interface is made of, and the rules that keep a screen added in phase 9 looking like a screen
added in phase 5.

The gallery at `/dev/components` is the drawn version of this file. Read them together: this one says
why, the gallery says what it looks like, and the screenshot tests say whether either has changed.

**The system is written down in three places, and all three move together.** This file, the mockup at
`Design systems/neuron-visual-system new.html`, and the code. The mockup is the reference the visual
design was approved from, and it is what a later change is judged against, so a change that lands in
the code and not in the mockup makes the reference wrong. At the end of any piece of work that changes
how something looks, update all three: the component, this file and `docs/copy-audit.md` if the words
moved, and the mockup. `Design systems/neuron-visual-system current.html` is the version that was
approved before the phone passes and is kept as history; it is not edited again.

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

**Every field is 16px**, which is not a step on the scale. Below sixteen, iOS Safari zooms the page the
moment a field is focused and never zooms back out, and the whole app is left at about 110% and
scrolled sideways. It is a platform rule rather than a design decision, `--text-16` says so where it is
defined, and `tests/keyboard.spec.ts` fails if any field drops below it.

---

## Component inventory

Everything the interface is built from. A new component needs a written reason and all seven states
before it ships.

**Action** (`ui/button.tsx`). `primary`, `quiet`, `text`, `destructive`. One primary per screen; two
accent fills on one screen is a bug. Destructive is a slab shaped like `quiet` with the label in the
signal hue: it is never a filled red button, because a filled red button is a large area of the signal
hue and the hue exists for error text, but it was a word in a sentence and the two places it appears
are the last action in a dialog about deleting an account and the last action in a dialog about turning
off the second factor. Both read as a line of red text that happened to be there rather than as the
button that finishes, and one of them is irreversible. States: default, hover, active, focus, disabled,
loading, and the destructive tone. Forty four tall at the smallest, forty eight when it fills the width
of a form.

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
Maximum two floating layers on screen. A dialog is a centred panel, at every width, and everything it
holds fits without scrolling. A toast is one line with no action and leaves by itself.

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

| Level    | Blur | Tint, by layer  | Saturation | Where                                       |
| -------- | ---- | --------------- | ---------- | ------------------------------------------- |
| `full`   | 34px | .78 / .58 / .54 | 1.9        | The default, and what the mockup recommends |
| `subtle` | 14px | .90 / .72 / .66 | 1.4        | Phones that stutter                         |
| `off`    | none | opaque          | none       | The same surfaces without the blur          |

Three tints, because the three kinds of layer carry different text and the floor is always the quietest
text on the layer.

- `--g-alpha` is a toast, and a card or a row once the effect reaches them. They carry secondary text,
  which needs .78 over the worst backdrop.
- `--g-alpha-bar` is the floating bars. Every label on a bar is primary, so the floor is primary and the
  tint can be .58.
- `--g-alpha-sheer` is a dialog, which sits over a scrim that has already dimmed the backdrop and can
  therefore be sheerer still.

Off is not a failure state: it is what a browser without `backdrop-filter` already gets, and what the
declared fallback background paints first in every case.

**Transparency and contrast are one dial, not two.** The share of the backdrop that shows through a
tint is exactly one minus its alpha, so "more see through" and "less contrast" are the same request.
There is no third option: `backdrop-filter: brightness()` lowers the worst case and the visible
variation by the same factor and buys nothing.

What buys something is taking the quiet text off the layer. A bar's current tab is marked by the pill
travelling under it, not by the tone of the words, so every label on a bar can be primary, and that
moves the floor from secondary to primary. Measured over the worst backdrop a bar can have, which is
the theme's own primary text scrolling underneath it:

| On a bar at .58 | Dark         | Light        |
| --------------- | ------------ | ------------ |
| Primary         | **4.55**     | **6.46**     |
| Secondary       | 2.31, banned | 2.74, banned |

Both quieter tones are redefined to the primary one on a bar in `global.css`, the same way tertiary is
redefined to secondary on every other glass layer, so a label that moves onto a bar is corrected rather
than left to fail quietly. `src/styles/contrast.test.ts` reads the alphas out of the token file and
prints every ratio on each run.

### Where it applies

A second setting, and the reason the first rule exists.

| Scope      | What carries the effect                        |
| ---------- | ---------------------------------------------- |
| `floating` | Bars, the tab bar, sheets, toasts. The default |
| `all`      | Those, plus every card and every list row      |

`floating` is the rule the system is designed around. `all` is offered because it is the person's
phone that pays for it and they can hear the difference: on the five hundred row library the same
scroll goes from **60.0 fps with no blurred rows** to **56.5 fps with five hundred of them**, and on a
device half as fast again it falls apart. Both numbers come from `tests/performance.spec.ts`, which
measures each scope on every run.

With the effect off the scope has nothing to act on, so the group dims to 40% and its cells report
`aria-disabled` rather than disappearing. A control that vanishes teaches nobody why it went.

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

Measured, at the default and with the effect carried onto every row:

| Scope            | Frames a second | Worst frame | Blurred rows |
| ---------------- | --------------- | ----------- | ------------ |
| Panels only      | **60.0**        | 16.8 ms     | 0            |
| Panels and cards | 56.5            | 33.4 ms     | 500          |

Sixty is the display cap with no frame dropped. The same harness reports 58.7 fps at ten times
throttling for the default and 23.4 for panels and cards, so the number is a measurement and not a
ceiling the test cannot see past.

---

## Motion rules

Transform and opacity only. Never height, width, top, left, or filter.

**Every entrance fills `backwards`, never `both`.** `both` holds the last keyframe on the element for
as long as it lives, and a held transform, even `none`, keeps that element on a composited layer of its
own for ever. The screen stagger did exactly that to the container holding five hundred rows, and the
library scroll fell from 60 frames a second to 8.7 with nothing on screen looking any different. Exits
fill `forwards`, because something on its way out has to stay where it ended until it is unmounted.
`src/styles/motion.test.ts` fails the build on `both`.

- A screen arrives: 6px up and a fade over `--dur-3`, replayed whenever the route changes. The tabs are
  siblings, so nothing travels sideways between them, and what says the screen changed is that it
  arrives rather than appears.
- Its first four blocks arrive a beat behind it, 26ms apart, then it stops. Written once against
  `[data-screen] > *`, so a screen added later gets it by being a screen.
- Forward navigation enters from the right at 14px, backward from the left. The direction is a spatial
  claim and has to match the hierarchy.
- Sheets rise from the bottom edge over `--dur-4` with `ease-enter` and leave over `--dur-3` with
  `ease-exit`. Exits are always faster than entrances.
- A sheet pushes the screen behind it back to 0.945 with the top edge as the origin. The screen is
  still there and still theirs.
- The card reveal moves 10px and scales .99 to 1 over `--dur-2`. It says the answer was already there.
- A pushed screen brings its content a beat behind itself: four rows, 26ms apart, then it stops.
- The focus ring is instant. The halo behind it fades over `--dur-1`.
- What hangs under an open deck arrives with the reveal. The disclosure has already turned by then, so
  the movement is the answer to it.
- Something appearing in place rather than from somewhere pops: a chip, a strength bar, `--dur-2` on
  the spring, from 0.92.
- A press answers everywhere, and by less the larger the thing is: a control gives 0.985, a card or a
  row 0.99, a tab or a segmented cell 0.96. A large thing moving as far as a small one reads as loose.
- The segmented thumb and the tab pill travel over `--dur-3` on the spring, and give a little when the
  group is pressed. At `--dur-1` a thumb has not travelled as far as the eye is concerned, it has
  teleported; the platform's own controls take about this long, and the spring is what makes the
  arrival read as a settle rather than a stop.
- The tab bar leaves downward when the keyboard arrives, and comes back the same way.
- Errors shake once, 320ms, 4px. That is the only expressive motion in the system.
- No loops except the spinner and the skeleton sheen, and both stop when content arrives.
- `prefers-reduced-motion` collapses every duration to 1ms. States still change, nothing travels. The
  switch in Appearance does the same thing by hand.

Checked three ways: `src/styles/motion.test.ts` reads every keyframe in the stylesheet, including ones
no screen uses yet; `tests/motion.spec.ts` reads computed durations out of a real browser with the media
feature emulated and with the switch set; and the screenshot tests run with animations disabled so a
movement cannot hide a layout change.

---

## The keyboard, and where the bottom of the screen is

The two hardest things about a phone browser, and the two the interface was worst at.

**A `position: fixed` element is placed against the layout viewport**, and on iOS that viewport runs on
underneath Safari's toolbar. A bar at `bottom: 0` therefore hides behind the toolbar while the toolbar
is out, and floats far too high once it retracts. `src/lib/viewport.ts` measures the difference between
the layout viewport and the visual one and publishes it as two variables, because two different things
need two different answers:

| Variable                   | Is                                                        | Used by                                   |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `--keyboard-inset`         | The gap when it is a keyboard, and zero otherwise         | The padding a full page form reserves     |
| `--chrome-inset`           | The gap when it is the browser's own furniture, else zero | The tab bar                               |
| `--visual-viewport-height` | How tall the part on screen actually is                   | The band a dialog is centred in           |
| `--visual-viewport-top`    | Where the part on screen starts                           | The top edge of that band                 |
| `data-keyboard` on `html`  | `open` or `closed`                                        | Anything that hides or tightens for a key |

The tab bar's own offset is `max(safe-area-inset-bottom - 12px, 8px)`, not the safe area plus a gap. A
phone's home indicator occupies 34 pixels and a floating bar is meant to sit close to it, the way the
platform's own do; a gap on top of that left the bar hovering 54 pixels up, which reads as a bar that
has come loose.

**A dialog is centred in the part of the page a person can see.** `[data-dialog-band]` is a full width
band as tall as `--visual-viewport-height`, and the dialog is centred inside it, so when the keyboard
takes the bottom 336 pixels the band becomes 476 tall and the dialog moves up with it. The band carries
the `z-index`, not the dialog: a fixed element creates a stacking context of its own, so a number on
the dialog inside counts for nothing against the scrim outside it.

The band centres its dialog with `margin: auto` and scrolls, and neither is
decoration. Flex alignment centres by overflowing equally in both directions, so a dialog taller than
the band loses its top edge off the top of the screen with no way to scroll back to it, and one
Android browser reports a visible height smaller than the truth while its keyboard animates. An
automatic margin centres what fits and resolves to zero when nothing does; the scroll is what makes a
dialog reachable even when the measurement is wrong. `tests/keyboard.spec.ts` sets the band to 200
pixels and checks the top edge is still on screen.

A dialog used to be a sheet against the bottom edge on a phone. That is the wrong shape for anything
with more than a field in it. A sheet grows upward from the bottom, so its heading is at the top of a
tall box and its content is at the foot of the screen; setting up the second factor put the QR code,
the setup key, the field for the code and the button in that order below the fold, and every one of
them needs the keyboard. Centred, the same content is measured against the middle of the screen and
both edges give way at once.

**Everything a dialog holds fits without scrolling, at 375 by 812, in both languages.** That is a rule
and it is measured: `tests/dialogs.spec.ts` opens every dialog in the app and fails if the scrolling
part holds more than it can show. Anything that does not fit is a screen that wants splitting into
steps, and setting up the second factor is now four of them rather than three.

**A dialog is still three parts, not one scrolling block.** A heading that stays, a body that scrolls
if it has to, and a footer that stays. Compose one with `DialogBody`, `DialogFooter` and, when there is
a form involved, `DIALOG_FORM` on the form itself so the form is the column rather than the dialog.
Anything that has to be answered before the action goes in the footer with it: the box confirming the
recovery codes have been saved is there, because at the foot of a scrolling column it was below the
fold while the button it unlocks was above it.

**A full page form is a card in the middle too.** The signed out screens used to pin the heading to the
top and push the form against the bottom edge, which produced "Sign in" alone at the top of an empty
screen and the fields 500 pixels below it. The card is centred with `m-auto` rather than
`justify-center`, because flex alignment clips the top of anything taller than the screen and there is
no scrolling back to it; the room inside contracts while the keyboard is up, and the page reserves the
keyboard's height underneath so the foot of the form can be scrolled to.

**The tab bar leaves.** It belongs to the bottom of the screen and the keyboard has taken that.

These are checked in `tests/keyboard.spec.ts`, which stages a 336 pixel keyboard by setting the three
variables the tracker sets and then measures where things actually are.

---

## Composition rules

- One gutter: 20 on a phone, and content never touches it.
- A screen is a title block, content, and one floating layer. Titles are one line; a title that needs
  two is the wrong title.
- One primary action per screen. Everything else is quiet or text.
- Depth ladder in order: canvas, card, raised, floating. Never skip a rung, never nest a card in a card.
- Vertical rhythm from the scale only: 8 inside a group, 20 between groups, 24 between blocks.
- A dialog is for a decision belonging to the screen behind it. Anything with its own title and its own
  back is a screen.
- A dialog fits a phone whole. If it does not, it is more than one step.
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
9. If it has a field, open it with the keyboard up and check the action is still reachable. A dialog
   uses `DialogBody` and `DialogFooter`; a full page form reserves `--keyboard-inset` underneath.
10. If it is a dialog, check it fits 375 by 812 whole, in both languages, with nothing below the fold.
11. Scroll it on a phone. Below 55 frames a second the screen changes, not the phone.
12. Draw the change in the mockup as well. `Design systems/neuron-visual-system new.html` is the
    reference the system is judged against, and a change that is only in the code makes it wrong.

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
