# apps/api

Hono on the Node runtime, deployed to Vercel Functions. It owns accounts, sessions and, later, sync.

## Routes

| Route           | What it does                                               |
| --------------- | ---------------------------------------------------------- |
| `GET /health`   | Says the server and its required database schema are ready |
| `GET /db-check` | Adds a database-time query to the same schema check        |
| `GET /me`       | The signed in user, or 401 when there is no session        |
| `/api/auth/*`   | Better Auth: sign up, sign in, sign out                    |
| `GET /spike`    | Temporary check page. Deleted in phase 5                   |

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
pnpm db:verify-release checks the migration journal and both restricted roles
```

Pull requests validate migration files and exercise migration compatibility in isolated throwaway
databases. Preview builds do not compare their proposed schema with the shared Preview database and never
receive an owner credential.

After a protected `main` update, production migration files are applied by the trusted `Production
migrations` GitHub workflow. Its owner URL is scoped to the `production-migrations` GitHub environment,
which accepts only protected branches; pull request code cannot execute with it. The workflow verifies the
journal after migration. The concurrent production build waits at its restricted-role compatibility gate
while the trusted migration is still running, so a normal deployment-before-migration race resolves
automatically. Vercel never receives the owner variable: production builds and request runtime use only
`DATABASE_URL` (`neuron_app`) and `DATABASE_URL_AUTH` (`neuron_auth`).

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
