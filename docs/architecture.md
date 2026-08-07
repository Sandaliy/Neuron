# Architecture

Written as the parts are built. The first entry will cover the offline store and how it syncs.

## DELETE-IN-PHASE-5

Temporary scaffolding that exists only to prove the stack works. All of it goes when the real web
app lands.

- `apps/api/src/spike-page.ts` and the `/spike` route in `apps/api/src/create-app.ts`. A page with
  sign up, sign in and session buttons, used to check the stack from a browser. It has no design and
  no translations on purpose.
- The in memory rate limiter in `apps/api/src/rate-limit.ts` stays, but its storage has to move to a
  shared store before real traffic. Every serverless instance currently counts on its own.
