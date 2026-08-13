# apps/web

The React application: a Vite build, deployed to Vercel as the project `neuron-web`.

## One origin

Every request the browser makes goes to the origin the page came from. `vercel.json` rewrites `/api`
to the api deployment in production, and the Vite proxy does the same in development.

This is not a convenience. A session cookie is not sent to a different site, so an app talking to the
api on its own hostname signs in and is immediately signed out again. Nothing here may use an
absolute url to the api.

## Running it

```
pnpm dev
```

That starts the api on 8787 and this on 5173, bound to every interface, so the app can be opened from
a phone on the same network at `http://<this machine's address>:5173`.

## Layout

| Path            | Holds                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `src/app/`      | The shell, the session gate, and the preference sync                        |
| `src/features/` | One directory per screen group: auth, library, today, settings              |
| `src/ui/`       | The design system: Radix primitives styled with the tokens                  |
| `src/lib/`      | The api client, the Better Auth client, and the query hooks                 |
| `src/i18n/`     | Which language is on. The catalogue itself is in `packages/shared`          |
| `src/theme/`    | Which theme is on, and the copy of that logic `index.html` runs first       |
| `scripts/`      | Draws the icons in `public/` from the design tokens                         |

## Rules that are checked, not remembered

- No colour literal in a component, and no spacing value off the scale. `scripts/check-design-tokens.mjs`
  fails the lint if either appears.
- No user visible string in a component. Every one is a key in `packages/shared/src/i18n`, which does
  not compile if a key exists in one language and not the other.
- Nothing tappable smaller than 44 px, and no input smaller than 16 px, or iOS zooms the page.
