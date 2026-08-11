# Architecture

Written as the parts are built.

## The data model

Twelve tables. Four belong to Better Auth and are not ours to shape. The rest are the collection.

### A note is not a card

This is the decision everything else follows from.

A **note** is the fact: a word with its article, plural, translation, example. A **card** is one direction
of asking about that note, and each direction has its own schedule.

`die Sorgfalt` produces up to four cards: recognising it when read, recalling it from the translation,
producing it from nothing, and hearing it. Recognising a word and producing it are different skills that
grow at different rates. Putting them on one schedule gets both wrong: the easy direction is asked too
often and the hard one not often enough.

The cost is that one imported list of 5000 words can become 15000 cards. That is why directions open one
at a time rather than all at once, which is what the `ladder` setting on a deck describes.

### A deck is also a folder

There is no separate folder table. A deck holding other decks is what a person calls a folder, and
studying one means studying everything underneath it at any depth.

Each deck carries `path`, an array of its ancestors, root first. "Everything under this folder" is then
one indexed query rather than a recursive walk:

```sql
where path @> array[$1]::uuid[]
```

The cost is that moving a deck has to rewrite the path of every row beneath it. That happens in one
statement, inside the transaction that moved the deck, in `deckRepository.move`. Two tests hold it to
that: one moves a three level subtree and checks every descendant, another moves a subtree up to the
root.

A check constraint refuses a deck that lists itself among its ancestors, and the depth is capped at
eight.

### The review log is append only

Every answer is a row in `reviews`. Nothing ever updates or deletes one.

The state of a card is a **projection** of that log. Given the rows, `replay` in `packages/core` rebuilds
the stability, the difficulty, the state and the due date exactly. The card row is a cache of the answer,
kept because reading it is cheaper than recomputing it.

Three things follow:

**Syncing two devices stops being a conflict problem.** Answering the same card on a phone with no
network and then on a laptop produces two log entries, not two competing versions of one row. They merge
by being put in order.

**The algorithm can change retroactively.** FSRS-7 arriving means replaying the history, not losing it.

**The statistics are measured rather than accumulated.** Real retention and real answer times come from
the log, not from counters that drift.

None of that survives the log being editable, so it is not editable:

- the application role has `SELECT` and `INSERT` on `reviews`, and nothing else
- a trigger refuses `UPDATE` and `DELETE` for everyone, the database owner included

The two are separate on purpose. A privilege stops applying the moment a connection uses a different
role, and a trigger stops applying to nobody.

There is exactly one legitimate delete: erasing an account has to erase the log with it. That case
announces itself by setting `app.erasing_account` for the transaction, and the trigger lets it through.
Without the escape hatch the cascade from removing a user would hit the trigger and make deleting an
account impossible, which is a worse failure than the one being prevented.

### The round trip is proven, not assumed

Stability and difficulty are `double precision`, not `numeric`. The scheduler works in IEEE 754 doubles
throughout, and a decimal column would round on the way in and out. Two devices replaying the same log
would then disagree in the last digits, drift apart over months, and show different due dates for the
same card. That failure is silent for a long time, so it is tested loudly:

- the seed generates a review history first and derives every card state by replaying it, so it never
  writes a number it invented
- a test reads the log back out of the database, replays it, and asserts the card row matches exactly,
  including the due date and the full precision of stability
- it runs over 25 seeded cards and again over a card answered eight times through the repository layer

## Two barriers around user data

### One, in the code

`createRepositories(db, userId)` is the only way in. No exported function takes a bare database handle,
and no repository method takes a user id. The user is supplied once and every statement afterwards
carries it. A query that forgot whose data it was reading is not something a reviewer has to catch,
because it is not something anyone can write.

Every statement runs inside a transaction that begins with

```sql
select set_config('app.user_id', $1, true)
```

as a bound parameter, not string interpolation into `SET LOCAL`, which takes no parameters. The third
argument makes the setting local to the transaction, so a pooled connection cannot carry one user's
identity into the next request.

### Two, in the database

Row level security is enabled and forced on `decks`, `notes`, `cards`, `reviews`, `study_presets` and
`import_batches`. The policy is the same on each:

```sql
using       (user_id = current_setting('app.user_id', true))
with check  (user_id = current_setting('app.user_id', true))
```

`current_setting` with the second argument returns null instead of raising when nothing set it, and null
fails the comparison. A connection that never identified a user reads an empty database. Denied by
default is the behaviour we want, because that is the shape a bug takes: some path that skipped the
repository layer.

### The restricted role

Neon hands out `neondb_owner`. That role can drop tables and carries `BYPASSRLS`, which means the
policies above would not apply to it at all. Enabling row level security while connecting as the owner
looks like protection and is none.

So there are two connection strings:

| Variable | Role | Used by |
| --- | --- | --- |
| `DATABASE_URL` | `neuron_app` | the api, the seed, anything at run time |
| `DATABASE_URL_OWNER` | `neondb_owner` | migrations, the seed's own setup, the benchmark |

`neuron_app` can read and write rows and can do nothing else: no create, no drop, no ownership, no
`BYPASSRLS`, and on `reviews` no update or delete. The owner credential never goes near the deployed
server.

The role is created without a password by migration `0002_isolation.sql`, so nothing secret is committed.
`pnpm --filter @neuron/api db:role` generates one, sets it, checks that the role really did come out
without `BYPASSRLS`, and writes the connection string into `.env`. Running it again rotates the password.

Roles created through SQL do not appear in the Neon console and their password cannot be reset there. If
it is ever lost, drop and recreate the role in a new migration.

### What the auth tables do not have

`user`, `session`, `account` and `verification` carry no policies, deliberately.

Signing in has to find a user by email before there is a user to be. A policy keyed on the current user
would lock everyone out at the first step. Those tables are reached only through Better Auth, which looks
rows up by session token and by email and never by a client supplied id.

The gap this leaves is worth stating plainly: the application role can update any row in `user`, not only
the current user's. Nothing in the repository layer does, and the only write it makes there is bumping
the version counter for the user it was built with. Closing it properly means giving Better Auth its own
role, which belongs with the work on authentication in phase 4 rather than here.

`note_types` is the other exception, and a smaller one. The three built in types belong to nobody, so
anyone may read a row with no owner and only the owner of a row may write one. The built in types are
therefore visible and untouchable.

## The version counter

`user.current_rev` is a per user counter. Every write takes the next number and stamps it on the rows it
writes, both inside one transaction:

```sql
update "user" set current_rev = current_rev + 1 where id = $1 returning current_rev
```

The update takes a row lock, so two devices writing at the same moment queue up rather than both reading
the same number. A test runs eight concurrent writes and asserts the numbers are unique and contiguous,
because a client asking for "everything after the number I last saw" depends on nothing slipping between
two of them.

Every table that takes part in sync has an index on `(user_id, rev)`. The pull and push endpoints
themselves are phase 4. The columns could not wait: adding `rev` to six tables later means six migrations
over live data.

## The index decision, measured

A card reaches its deck through its note, so "what is due in this folder" was a join. The alternative was
to copy `deck_id` onto the card, which creates a second place where the same fact lives.

The choice was made by measuring, on 50000 cards across 200 decks, with
`pnpm --filter @neuron/api db:bench`. Median of five runs after a warm up:

| Query | Joined through notes | Deck on the card |
| --- | --- | --- |
| Cards due in a folder, limit 200 | 8.29 ms | **2.72 ms** |
| Card counts per deck, for the library tree | 43.83 ms | **17.74 ms** |

Both run on every app open, so the copy was added. The cost is that moving a note has to move its cards.
That happens in one place, `noteRepository.moveToDeck`, and a test moves a note with two cards and checks
both followed it.

Two other queries needed no decision:

| Query | Time | Plan |
| --- | --- | --- |
| Cards due across the whole collection, limit 200 | 0.31 ms | index scan on `cards_user_due_idx` |
| Everything changed since a revision | 0.24 ms | index scan on `cards_user_rev_idx` |

The counts query is the slowest thing in the schema at 17.74 ms, and it is a sequential scan by nature:
it aggregates over every card the user has. That is fine at 50000 and will not be at 500000. When it
stops being fine, the answer is a maintained counter per deck rather than a better index.

## Conventions

- ids are UUID version 7, generated by the client, so a row created with no network keeps the identity it
  was born with and inserts still land at the right hand edge of the index
- every timestamp is `timestamptz`, never `timestamp`
- `snake_case` in the database, `camelCase` in TypeScript
- every row a user owns carries `user_id`, `created_at`, `updated_at`, `deleted_at` and `rev`
- deletes are soft everywhere; nothing in the application issues a `DELETE` against a user row

### Exceptions to the last two, and why

**`reviews` has no `updated_at` and no `deleted_at`.** The table is append only, so both columns would be
lies about what can happen to a row in it. It carries `user_id`, `reviewed_at` and `created_at`.
`reviewed_at` is when the person answered, taken from their device. `created_at` is when the row reached
the server. They differ after a session spent with no network, and the difference is the first thing
worth looking at when a sync problem needs explaining.

**`note_types` has no `rev` and no `user_id` on its built in rows.** They are shared by every account and
do not sync, because they are the same everywhere.

## Validation

`fields` on a note is `jsonb`, and Postgres will accept any shape at all in it. What makes a `vocab` note
actually have a term and a translation is a Zod schema in `packages/shared`, applied in the repository
layer before every write. That guarantee holds only because nothing else writes to the table, which is
the reason the repository layer is the only way in. The code comment where this happens says so.

What the database does enforce, in check constraints:

- a rating is one of the four words, a direction is one of the five, a state is one of the four
- difficulty is between 1 and 10, stability is above zero, `reps` and `lapses` are not negative and
  `lapses` never exceeds `reps`
- a new card has no memory state, and a card with a memory state is not new

That last one is the `NewCardState | ReviewedCardState` union from `packages/core` written out in SQL. A
row the TypeScript type could not describe cannot be stored either.

## Running the database

```
pnpm db:generate     write a migration from the schema
pnpm db:migrate      apply migrations, as the owner
pnpm db:seed         fill the demo collection
```

and, in `apps/api`:

```
pnpm db:role         give the restricted role a password, write DATABASE_URL
pnpm db:test-db      create the throwaway database the tests empty
pnpm db:bench        rebuild the 50000 card fixture and print query plans
```

The migration runner is ours rather than `drizzle-kit migrate`, which reports a failure as an exit code
and nothing else. It runs the same files in the same order through the same journal, and prints what went
wrong. The test setup calls the same function.

### Tests that need a database

They run against a throwaway database named by `DATABASE_URL_TEST`, and refuse to run if it points at the
same database as `DATABASE_URL`. Without it they skip with a message naming the variable, rather than
passing quietly.

The isolation tests go straight at the database as the restricted role rather than through the
repositories. That is the point: the repositories are the first barrier, row level security exists to
hold when the first barrier has a bug in it, and testing it through the code it is meant to be
independent of would prove nothing.

## DELETE-IN-PHASE-5

Temporary scaffolding that exists only to prove the stack works. All of it goes when the real web
app lands.

- `apps/api/src/spike-page.ts` and the `/spike` route in `apps/api/src/create-app.ts`. A page with
  sign up, sign in and session buttons, used to check the stack from a browser. It has no design and
  no translations on purpose.
- The in memory rate limiter in `apps/api/src/rate-limit.ts` stays, but its storage has to move to a
  shared store before real traffic. Every serverless instance currently counts on its own.
