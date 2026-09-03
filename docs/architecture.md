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

### The restricted roles

Neon hands out `neondb_owner`. That role can drop tables and carries `BYPASSRLS`, which means the
policies above would not apply to it at all. Enabling row level security while connecting as the owner
looks like protection and is none.

So there are three connection strings:

| Variable             | Role           | Used by                                                           |
| -------------------- | -------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`       | `neuron_app`   | the api, the seed, anything at run time                           |
| `DATABASE_URL_AUTH`  | `neuron_auth`  | Better Auth, and nothing else                                     |
| `DATABASE_URL_OWNER` | `neondb_owner` | migrations, the seed's own setup, the benchmark, erasing accounts |

`neuron_app` can read and write rows and can do nothing else: no create, no drop, no ownership, no
`BYPASSRLS`, and on `reviews` no update or delete. The owner credential never goes near the deployed
server.

The roles are created without a password by migrations `0002_isolation.sql` and `0005_auth_isolation.sql`,
so nothing secret is committed. `pnpm --filter @neuron/api db:role` generates one for each, sets it,
checks that neither came out with `BYPASSRLS`, and writes both connection strings into `.env`. Running it
again rotates both passwords, which means the server needs the new values too.

Roles created through SQL do not appear in the Neon console and their password cannot be reset there. If
it is ever lost, drop and recreate the role in a new migration.

### Why authentication gets a role of its own

Phase 3 left the four Better Auth tables with no policy at all. The reason was real: signing in has to
find a user by email before there is a user to be, so a policy keyed on the current user locks everyone
out at the first step. The consequence was also real: the application role could rewrite any row in
`user`, including another person's email address, and read any row in `account`, where the argon2id
hashes are.

One role cannot tell the two paths apart. Any flag the application could set to announce "this statement
is part of signing in" is a flag the application could set at any other time, so it is not a barrier, it
is a comment. What does separate them is a credential the application does not hold.

Hence `neuron_auth`: the four auth tables in full, none of the collection, handed to Better Auth and to
nothing else. And `neuron_app`, narrowed on the same tables:

| Table          | What `neuron_app` may do                                         |
| -------------- | ---------------------------------------------------------------- |
| `user`         | read ten columns, write seven, on the row matching `app.user_id` |
| `session`      | nothing                                                          |
| `account`      | nothing                                                          |
| `verification` | nothing                                                          |

The ten readable columns are the preferences and the version counter. `email`, `name` and `image` are not
among them, so `select *` from that role now fails outright rather than returning something it should not
have. The seven writable ones are the preferences plus `current_rev` and `updated_at`. There is no policy
for `INSERT` and none for `DELETE`, so the application role cannot create an account or remove one
whatever a route handler tries.

The auth tables use `ENABLE ROW LEVEL SECURITY` without `FORCE`, unlike the collection. `FORCE` also binds
the table owner, and the owner is what applies migrations and runs the account erasure task. On Neon the
owner carries `BYPASSRLS` and steps over both settings anyway, so `FORCE` would buy nothing there and
would break the same work on a plain Postgres.

`note_types` is the other exception, and a smaller one. The three built in types belong to nobody, so
anyone may read a row with no owner and only the owner of a row may write one. The built in types are
therefore visible and untouchable.

### Leaving, and the only place a row is removed

Deleting an account does not delete anything. It replaces the name and the email with placeholders, drops
every credential and every session, marks the row with `deletion_requested_at`, and soft deletes the
collection. The person is signed out everywhere and cannot sign in again.

The rows go thirty days later, in `pnpm db:erase`, which holds the owner credential and runs from a
terminal rather than from a request. That is the only code in the project that removes a review.

The trigger that keeps the log append only used to let a delete through whenever `app.erasing_account` was
set to `on`, and any connection can set that string. The missing `DELETE` grant was the only thing
standing between application code and the review log, which is one barrier where the rest of the schema
has two. Now the flag is necessary and not sufficient: the deleting role also has to own the table.
`neuron_app` fails that test whatever it sets and whatever grant it somehow acquires, and a test says so.

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

Every table that takes part in sync has an index on `(user_id, rev)`, `reviews` included since phase 4.

`GET /sync?since=` is one ordered read across all of them, merged by revision. A page always ends on a
revision boundary and never inside one, because a single transaction takes one number and can write
several rows under it: cutting between two of those would leave a client holding half a transaction and
believing it had all of it. A transaction larger than the page is therefore sent whole rather than split.

## The index decision, measured

A card reaches its deck through its note, so "what is due in this folder" was a join. The alternative was
to copy `deck_id` onto the card, which creates a second place where the same fact lives.

The choice was made by measuring, on 50000 cards across 200 decks, with
`pnpm --filter @neuron/api db:bench`. Median of five runs after a warm up:

| Query                                      | Joined through notes | Deck on the card |
| ------------------------------------------ | -------------------- | ---------------- |
| Cards due in a folder, limit 200           | 8.29 ms              | **2.72 ms**      |
| Card counts per deck, for the library tree | 43.83 ms             | **17.74 ms**     |

Both run on every app open, so the copy was added. The cost is that moving a note has to move its cards.
That happens in one place, `noteRepository.moveToDeck`, and a test moves a note with two cards and checks
both followed it.

Two other queries needed no decision:

| Query                                            | Time    | Plan                               |
| ------------------------------------------------ | ------- | ---------------------------------- |
| Cards due across the whole collection, limit 200 | 0.31 ms | index scan on `cards_user_due_idx` |
| Everything changed since a revision              | 0.24 ms | index scan on `cards_user_rev_idx` |

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
pnpm db:role         give both restricted roles a password, write their connection strings
pnpm db:test-db      create the throwaway database the tests empty
pnpm db:bench        rebuild the 50000 card fixture and print query plans
pnpm db:erase        remove accounts whose thirty days are up, and sweep the rate limiter
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

## The api

### Import duplicate updates

`PATCH /notes/:id` accepts `merge: true` with fields and the same note type, but no metadata changes.
The server checks that the normalized term has exactly one live same-type match and that it is the
requested note. Other note types are not targets. A merge fills only schema-defined blanks and missing
grammar leaves. Note updates take the user's revision-counter lock before reading current fields, so
concurrent additions cannot overwrite populated values. The normal shared card reconciliation path is
used, with any card removal refused for merge. Identical retries do not rewrite the note.

Import row IDs and decisions are retained for one in-page attempt, including Resume. Batch undo
soft-deletes only batch-created notes and cards. Merged additions to older notes stay; reviews are
immutable. There is no snapshot rollback or persisted reload-resume mechanism.

### One error shape

Every failure leaves the api as

```json
{ "error": { "code": "name_taken", "status": 409, "correlationId": "0199..." } }
```

The code is a translation key, not a sentence. An English string baked into a route handler is a string
that can only ever be shown to half the people using this, and nobody notices until the interface is
already built around it.

Nothing else crosses. Not a stack trace, not a driver message, not a column name: a database error naming
the constraint that failed is useful to us and is a map of the schema to anybody else. The detail goes to
the server log against `correlationId`, and the id goes to the client, so "it said something went wrong"
can be traced back to one request.

`42501`, a missing privilege, is answered as `not_found`. From the outside those are the same thing, and
they should be, because "you may not read that" confirms that it exists.

### The review endpoint does not believe the client

The client computes the new card state on the device. It has to: that is what makes the app work offline
and what makes the buttons feel instant. It also means a modified client could send any state it liked.

So the server loads the card, runs the same scheduler from `packages/core`, and stores its own answer.
What the client computed is compared and thrown away. When the two disagree past rounding, the response
carries `resync: true` and the client fetches that card again.

The review id comes from the client, which is what makes a retry harmless: inserting the same id twice
succeeds and changes nothing. This is not hypothetical. A phone on the underground sends an answer, loses
the connection before the reply, and sends again. Without the id one tap becomes two reviews and the
card's schedule moves somewhere neither the person nor the algorithm chose.

The fuzz generator is seeded from that id rather than from the clock, so a retry recomputes exactly what
the first attempt did and a client that seeds the same way lands its cards on the same days.

### Rate limiting counts in Postgres

The in memory limiter from phase 0.5 is gone. Every serverless invocation may be a fresh instance, so an
attacker spread across instances got as many attempts as there happened to be instances.

The counters live in `rate_limits` and are spent through `rate_limit_take`, one function, one round trip,
atomic. The function runs as its owner and `neuron_app` has no privilege on the table, so application
code can spend from a bucket and can neither read the counters nor clear them. Keys are hashed, so a copy
of the table says how often something was tried and nothing about who.

Signing in is limited twice, once per address and once per account, because a script spread over a botnet
only tries a few times from each address. The wait doubles with every window that goes over: a typo costs
seconds and a list costs the afternoon.

## Known limitations

Things that do not work yet, on purpose, with the reason and the phase that closes them.

**Email is not delivered.** No domain, and a free mail service will only deliver to arbitrary addresses
from a verified one. What exists instead is the seam: a `Mailer` interface, a `LogMailer` that writes the
message to the server log, and `MAILER` to choose between them. Email verification and password reset by
link are implemented in full behind `AUTH_REQUIRE_EMAIL_VERIFICATION`, which defaults to false. Both are
driven end to end by tests that run with the flag on and read the token back out of the LogMailer, so the
code being switched on has already run. Turning it on is a domain, a provider and that one flag. Closed
in phase 11.

**Two details of the mail tokens are worth knowing before that day.** The reset token is a row, consumed
on use, and stored as a SHA-256 digest rather than in the clear, which Better Auth does not do on its
own. The verification token is a signed JWT rather than a row, so it expires but is not consumed; using
it twice gains nothing, because the handler returns before it would create a session, and the test says
so. If a strictly single use verification link is ever needed, it needs a row of its own.

**Registration is open, with two temporary guards.** `AUTH_REGISTRATION_OPEN` closes it with one switch
in the Vercel settings, and `AUTH_MAX_REGISTRATIONS_PER_DAY` caps successful registrations per address
per day at three. Both exist only because there is no email verification. Both become unnecessary in
phase 11 and should be removed then rather than left to rot.

**The password policy is a length floor and a small list.** Ten characters, no character class rules, and
a few dozen of the passwords a list attack starts with. A real check means a breach corpus, which is a
service call or a large file shipped to the browser. Worth doing in phase 11, when there is a mail sender
to warn somebody with.

**A recovery code is the whole credential, not a step towards one.** With no mail sender there is no way
to prove somebody owns an address, so recovery rests on something they hold. Anybody with one of the ten
codes is in the account, without the password. The screen that issues them says exactly that, in both
languages, and the text is a translation key rather than a sentence chosen by the server. This stops
being the only route back in phase 11.

**The codes for a lost phone are encrypted, not hashed.** The account recovery codes are argon2id hashes,
the same as a password, because nothing ever needs to read one back. The second set, issued when TOTP is
turned on, belongs to Better Auth's two factor plugin, which has to be able to list what is left and so
stores them symmetrically encrypted with `BETTER_AUTH_SECRET`. That is weaker, and it is the plugin's
design rather than a choice made here. Both sets are reachable only by the authentication role.

**Sign in with Google was removed on purpose in phase 4.5.** Not forgotten and not broken. Email and
password is the only way in. Putting it back means credentials from the Google Cloud console, a
`socialProviders` block in `src/auth.ts`, the account linking rules that decide whether a Google sign in
attaches to an existing password account or makes a second one, and a button on the sign in screen.
Nothing else in the schema needs to change: the `account` table already carries the provider columns.

**The conflict log is written and never read.** `sync_conflicts` records the version that lost a merge,
whole. The screen that offers "this is what your other device had" belongs with the interface. The rows
have to start being written now, because a conflict that was not recorded at the time cannot be recovered
afterwards.

**The browser app is the product surface.** `apps/web` now contains the React application, its shell,
authentication and recovery flows, read-only library, Today screen, settings, and the component
gallery. Vercel rewrites `/api/*` to the Hono deployment so session cookies stay on one browser origin.
Production uses the production api. A preview derives the matching api branch URL from Vercel's
generated web branch URL and refuses to build if that mapping is unavailable. The old `/spike` page
remains deleted.

**Preview data is separate and empty.** The long-lived Neon `preview` branch is schema-only, and its
`neuron_preview` database contains no production rows. Its application role, authentication role, and
Better Auth secret exist only in the api's Vercel Preview environment. Production credentials remain
scoped to Production. Preview deployments share this database for now. Per-pull-request database
branches are deferred until role provisioning and migrations can be automated without an owner
credential in a deployed application.
