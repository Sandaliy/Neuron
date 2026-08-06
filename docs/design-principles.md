# Design principles

The direction is restrained technical minimalism. Dark theme by default. The interface should feel
like an instrument, not like a poster.

These rules are decided. They are not open for redesign per screen.

## Colour

- Colour comes from CSS custom properties only. A hex value never appears in a component.
- The tokens live in [packages/config/tokens.css](../packages/config/tokens.css). Dark is defined on
  `:root`, light under `[data-theme="light"]`.
- One accent, `--accent`. It marks the primary action and the focus ring, nothing else. A screen
  with two accented elements has a bug.
- `--success`, `--warn` and `--danger` are shared by both themes and are reserved for state, not for
  decoration.

| Token         | Dark      | Light     |
| ------------- | --------- | --------- |
| `--bg`        | `#0B0B0C` | `#FBFBFC` |
| `--surface`   | `#131316` | `#FFFFFF` |
| `--surface-2` | `#1A1A1E` | `#F4F4F6` |
| `--border`    | `#26262B` | `#E4E4E8` |
| `--text`      | `#ECECEE` | `#17171A` |
| `--text-dim`  | `#8B8B93` | `#6E6E76` |
| `--accent`    | `#4D7FE8` | `#3565CE` |

## Type

- At most two font weights per screen.
- Contrast comes from size and colour. If a heading needs to stand out more, it gets larger or it
  gets `--text` against `--text-dim`. It does not get bolder.

## Space and shape

- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Nothing between the steps.
- Radius scale: 6, 10, 14. Nothing else.
- Every value is a token. `--space-16`, `--radius-10`, and so on.

## Motion

- Two durations, `--duration-fast` at 120 ms and `--duration-slow` at 180 ms.
- One curve, `cubic-bezier(0.2, 0, 0, 1)`, exposed as `--ease`.
- An animation has to communicate a state change or a spatial relationship. Decoration is not a
  reason to animate.
- `prefers-reduced-motion: reduce` sets both durations to 1 ms. The tokens handle this, so a
  component that uses them is already correct.

## What the interface does not have

- No emoji.
- No gradients. The single exception is the session progress bar.
- No decorative illustrations.
- No shadow deeper than two levels.

## Icons

Lucide, 1.5 px stroke, rendered at 16 or 20 px. No other icon set.

## Mobile first

Mobile is the primary target, not an adaptation of the desktop layout.

- Frequent actions sit in the bottom third of the screen, within thumb reach.
- Minimum touch target is 44 px.
- Safe area insets are respected on every screen that touches an edge.
- Every screen is checked at 375 px wide before it counts as done.

## Accessibility

- Every interactive element is reachable by keyboard and shows a visible focus state.
- The focus ring uses `--accent` and is never removed without a replacement.
- Loading, empty and error states exist for every view. An empty list never renders as a blank area.
- Error text says what happened and what to do next, in plain language. A stack trace or a raw error
  code never reaches the screen.
