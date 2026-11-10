# apps/web

The React application: a Vite build, deployed to Vercel as the project `neuron-web`.

## One origin

Every request the browser makes goes to the origin the page came from. `vercel.ts` rewrites `/api` to
the production api in production and to the api deployment for the same Git branch in Preview. The
Vite proxy does the same in development.

This is not a convenience. A session cookie is not sent to a different site, so an app talking to the
api on its own hostname signs in and is immediately signed out again. Nothing here may use an
absolute url to the api.

## Deployment

The Vercel project `neuron-web` in the `parkour-clan` team, connected to GitHub, so every push to `main`
deploys `https://neuron-web-parkour-clan.vercel.app`. The settings as configured in Vercel:

| Setting          | Value            |
| ---------------- | ---------------- |
| Root Directory   | `apps/web`       |
| Framework Preset | Vite             |
| Build Command    | default          |
| Install Command  | default          |
| Output Directory | default (`dist`) |

`vercel.ts` holds the `/api` rewrite described above. Without it the browser talks to a second origin,
refuses to send the session cookie, and every sign in is followed immediately by a sign out. Do not
delete it.

A branch pushed without being merged gets a preview at
`https://neuron-web-git-<branch>-parkour-clan.vercel.app`, with the slashes turned into hyphens. Use
that address and not the deployment alias: `APP_ORIGIN` trusts the branch pattern and not
`neuron-<hash>-parkour-clan`, and the wrong one ends in "The server does not recognise this web
address" on the first request.

## Running it

```
pnpm dev
```

That starts the api on 8787 and this on 5173, bound to every interface, so the app can be opened from
a phone on the same network at `http://<this machine's address>:5173`.

## Layout

| Path            | Holds                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| `src/app/`      | The shell, the session gate, and the preference sync                               |
| `src/features/` | One directory per screen group: auth, dev, import, library, notes, settings, today |
| `src/ui/`       | The design system: Radix primitives styled with the tokens                         |
| `src/lib/`      | The api client, the Better Auth client, and the query hooks                        |
| `src/i18n/`     | Which language is on. The catalogue itself is in `packages/shared`                 |
| `src/theme/`    | Which theme is on, and the copy of that logic `index.html` runs first              |
| `scripts/`      | Draws the icons in `public/` from the design tokens                                |

## Rules that are checked, not remembered

- No colour literal in a component, and no spacing value off the scale. `scripts/check-design-tokens.mjs`
  fails the lint if either appears.
- No user visible string in a component. Every one is a key in `packages/shared/src/i18n`, which does
  not compile if a key exists in one language and not the other.
- Nothing tappable smaller than 44 px, and no input smaller than 16 px, or iOS zooms the page.
