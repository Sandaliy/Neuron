# apps/api

Hono on the Node runtime, deployed to Vercel Functions. It owns accounts, sessions and, later, sync.

## Routes

| Route           | What it does                                        |
| --------------- | --------------------------------------------------- |
| `GET /health`   | Says the server is up. No database, no session      |
| `GET /db-check` | Asks the database for its time. Proves the wiring   |
| `GET /me`       | The signed in user, or 401 when there is no session |
| `/api/auth/*`   | Better Auth: sign up, sign in, sign out             |
| `GET /spike`    | Temporary check page. Deleted in phase 5            |

## Running it

Needs `DATABASE_URL`, `DATABASE_URL_AUTH`, `BETTER_AUTH_SECRET` and `APP_ORIGIN` in the `.env` file
at the top of the repository. A missing one stops the server at startup with a message naming it.

`APP_ORIGIN` is the whole of the address question: a comma separated list whose first entry is the
canonical address of the web app. Better Auth signs cookies for it, CORS answers with it, links point
at it, and every entry on the list is allowed to make a request. There is no `BETTER_AUTH_URL`, on
purpose. Two variables holding the same address is two variables that can disagree, and when they do
every sign in is refused with a 403 that says nothing.

```
pnpm dev            starts on http://localhost:8787
pnpm db:generate    writes a migration from the schema
pnpm db:migrate     applies migrations to the database
```

## Layout

```
src/index.ts        entry point Vercel deploys
src/create-app.ts   builds the Hono app and mounts the routes
src/dev.ts          local server, reads .env first
src/env.ts          the only file that reads process.env
src/auth.ts         Better Auth, argon2id, cookie sessions
src/db/             drizzle client, schema, health query
src/rate-limit.ts   limiter interface plus an in memory version
```
