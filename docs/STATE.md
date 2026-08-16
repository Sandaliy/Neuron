# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-08-16, on `docs/second-phone-pass`, newest commit `a69cb17`. Phase 5.5, the design
pass, is merged and live. `e44748d` made it behave on a phone, `d9f75a8` was the second pass over the
same ground, and the working tree now holds a third: dialogs are centred panels, the signed out
screens are centred cards, the bar is nearly twice as transparent, and turning off the second factor
or deleting an account costs a code from the app.

## Now

**Phase 5.5 is built, passing and live.** The app is at
[neuron-web-parkour-clan.vercel.app](https://neuron-web-parkour-clan.vercel.app), wearing the approved
design system. Sign up, sign in, the ten codes, recovery by code, the second factor, settings, the read
only library tree and Today. Two themes, two languages, three glass levels.

`pnpm typecheck`, `pnpm lint` and `pnpm test` all pass: 708 tests, none skipped. The Playwright suite,
`pnpm --filter @neuron/web test:screens`, passes its 80 checks. The third pass is not committed yet.

**`docs/design-system.md` is the reference now, and `/dev/components` is the drawn version of it.**
Read both before changing anything visual. `docs/design-principles.md` is a pointer to it; every value
that used to be in that file is wrong.

### What the design pass changed

Tokens are two layers, raw then semantic, and `scripts/check-design-tokens.mjs` fails the build on a
colour literal, a spacing value off the scale, a raw duration, or a raw token named in a component.

Glass is a setting, not a look: three levels, device local, applied before React exists, and the level
painted is the chosen one capped by what the device can afford. Nothing in the content flow is glass,
two blurred layers never stack, the blur radius is never animated.

The frame rate is measured, not asserted: 500 rows, the default level, a quarter speed processor, 375
by 812, **60.0 fps with a worst frame of 16.8 ms**. Contrast is measured too, forty ratios printed on
every test run. Type is the platform's own face, so nothing is downloaded and nothing reflows.

### What the phone pass changed

Six things reported from a real iPhone. Fields were fifteen pixels, and iOS Safari zooms the page the
moment a field under sixteen is focused and never zooms back; sixteen is a size in the theme now.
Dialogs became three parts instead of one scrolling block. The tab bar sits against the bottom of what
is on screen, which takes measuring, because a fixed element is placed against the layout viewport and
that runs on underneath Safari's toolbar. Where the glass applies became a real setting.

Measuring the motion found a real bug: every entrance filled `both`, which holds the last keyframe for
ever, and a held transform keeps the element on a composited layer. The container holding five hundred
rows became one 38,000 pixel layer and the library scroll fell to **8.7 fps** with nothing on screen
looking different. Entrances fill backwards now and `motion.test.ts` fails the build on `both`.

### What the behaviour pass changed

The flicker was the app writing the server's answer back over the person's choice. Theme and language
are device preferences now: read while their module is evaluated, applied before React exists, written
synchronously in the click handler, told to the server afterwards with the answer discarded. One theme
switch went from 63 component renders across 3 commits, 52 of them arriving after the network at 872
ms, to 9 renders in 1 commit with nothing waiting on a request.

Dialogs learned to sit above the on-screen keyboard, `src/lib/viewport.ts` was written to measure where
it is, Inter's subsets got their `unicode-range`, sign up started asking for the password twice, and
`docs/copy-audit.md` listed 153 interface strings with what looks wrong with each.

### What the second phone pass changed

The tab bar jumped because its offset was written into `bottom` and part of that offset changes on
every change of scroll direction. The lift is a `translate` now. Panels and cards only moved a quarter
of the interface, because `Card` painted its own surface in a utility and a utility beats the
components layer. The keyboard had four more faults, all of them about a sheet moving in layout while
it was also animating. A press answers in ninety milliseconds each way, from the stylesheet rather than
from each control. "Turn off 2FA" existed on accounts with no second factor, because `GET /account`
never reported the state; it does now.

Three things were found while measuring: every toast was drawn behind the tab bar because its padding
named a variable nothing defines, the specular streak forced a synchronous layout on every scrolled
frame, and the first screen asked its two opening questions one after the other.

### What the dialog pass changed

Eight things reported from the iPhone, and the shape of the dialog was behind most of them.

**A dialog is a centred panel now, at every width.** It was a sheet against the bottom edge on a phone,
which is the wrong shape for anything with more than a field in it: a sheet grows upward, so its
heading is at the top of a tall box and its content is at the foot of the screen. Setting up the second
factor put the QR code, the setup key, the field for the code and the button in that order below the
fold, and every one of them needs the keyboard. `[data-dialog-band]` is a band as tall as
`--visual-viewport-height`, and the dialog is centred in it, so the keyboard shortens the band and the
dialog moves up with it. The band carries the `z-index`: a fixed element makes a stacking context of
its own, so the number that was on the dialog counted for nothing against the scrim, and the scrim was
painted over the dialog and swallowed every press aimed at it.

**Everything a dialog holds fits a 375 by 812 phone, in both languages, and that is measured.**
`tests/dialogs.spec.ts` opens every dialog and fails if the scrolling part holds more than it can show.
Enrolling in the second factor is four steps instead of three, the QR and the code no longer share one.
The ten recovery codes fit by putting the confirmation box in the footer with the button it unlocks,
by dropping the heading the dialog title already carried, and by sitting the codes at thirteen pixels
in a tighter well.

**The signed out screens are centred cards.** Heading pinned to the top and fields against the bottom
edge produced "Sign in" alone above 500 pixels of nothing. Centred with `m-auto`, not `justify-center`,
which clips the top of anything taller than the screen.

**The bar is nearly twice as transparent, and the arithmetic is the reason it can be.** For a fixed
worst case the share of the backdrop showing through is one minus the alpha, so transparency and
contrast are one dial and the floor is the quietest text on the layer. Taking the quiet tone off a bar
moves the floor from secondary to primary, so `--g-alpha-bar` is .58 where `--g-alpha` is .78: measured
4.55 to 1 in dark and 6.46 in light, against AA's 4.5. Secondary and tertiary are redefined to primary
on a bar in the stylesheet, so a label that moves onto one is corrected rather than left to fail.

**Turning off the second factor costs a code from the app as well as the password.** The thing being
removed is the protection against somebody who already has the password. The check is a guard on
`/two-factor/disable` in `apps/api/src/auth/plugin.ts`, the password is checked first so a mistyped one
does not burn a code, and the code is spent through the same replay claim the verification path uses.
**Deleting an account costs the same two things**, in `apps/api/src/routes/account.ts`, replacing the
phrase that had to be typed: copying a phrase off the screen above the box proves nothing.

**Destructive is a slab now**, shaped like `quiet` with the label in the signal hue. It was a word in a
sentence, and the last action in a dialog about deleting an account read as a line of red text that
happened to be there.

**Settings says less.** Three captions gone, "Less movement" is "Animations" with the switch the right
way round, the second factor is one row named for the thing with On or Off underneath, and deleting an
account is called that with the explanation inside.

### What the second dialog pass changed

Six more, reported from the phone once the first pass was live.

**The dialog flew off the top of the screen when the keyboard opened.** The band centred it with flex
alignment, which overflows equally in both directions, so anything taller than the band lost its top
edge and could not be scrolled back to. `margin: auto` centres what fits and resolves to zero when
nothing does, and the band scrolls now, so a browser reporting a visible height smaller than the truth
cannot strand a dialog. The band also sits at `--visual-viewport-top` rather than at zero, because on
iOS the visual viewport scrolls independently of the layout one while the keyboard is up.

**Closing the second factor dialog at the QR left an account stuck.** The lost phone codes were held
in `sessionStorage` the moment the server issued them, so the next open resumed on the screen that
shows them, and that screen cannot be dismissed. The second factor was not even on. Nothing is held
until the code from the app has come back, an abandoned set is discarded when the account says the
second factor is off, and the two flows that issue ten codes no longer share one storage key: the set
held by the second factor was being picked up by the registration screen.

**The dialog drew a focus ring around itself** on any step with no field in it, because it takes the
focus on open so the trap has somewhere to start. The trap still holds and the first Tab still reaches
the first control.

**The focus ring on the last field was clipped along the bottom**, which reads as the button
underneath sitting on top of it. The scrolling part of a dialog has room for a ring on all four sides
now, not two.

**Changing a password signed the person out on the device they changed it on.** The after hook took
every session, including the one that had just asked, and the client was also sending
`revokeOtherSessions`, which made Better Auth mint a replacement session that the hook then deleted as
well. Every session except the one that asked, and the flag is gone from the client.

**The codes a new account gets are a centred card**, the same as every other signed out screen. The
tagline and the sentence about there being no email recovery are gone from registration.

## Done

| Phase | What it produced                                                                                          | Doc                            |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0     | pnpm monorepo, TypeScript, ESLint, Prettier, Vitest, GitHub Actions on Node 24                            | `phase-0.md`                   |
| 0.5   | Better Auth, Neon Postgres, deployed to Vercel and verified end to end online                             | `phase-0.5.md`                 |
| 1     | FSRS-6 scheduler in `packages/core`, checked against the reference implementation                         | `phase-1.md`                   |
| 2     | Workload manager: answer time, forecast, budget, throttle, balancing, backlog, session builder, simulator | `phase-2.md`                   |
| 2.5   | Reran the simulator under realistic load, changed the metric, rewrote the claims                          | `phase-2.5.md`                 |
| 3     | Twelve tables, row level security, repository layer, isolation tests                                      | `phase-3.md`, `phase-3-run.md` |
| 4     | Two database roles, the whole api, sync, the review endpoint, rate limiting in Postgres                   | `phase-4.md`                   |
| 4.5   | Google removed, recovery codes, optional TOTP, the mail seam, the admin reset script                      | `phase-4.5.md`                 |
| 5     | The web app: shell, design system, two themes, two languages, every auth screen, library tree, Today      | `phase-5.md`                   |
| 5.5   | The approved design system: two token layers, the inventory, glass, motion, the gallery, screenshots      | `docs/design-system.md`        |

## What phase 5 changed

**The api answers under `/api`, and `/health` still answers at the root.** The browser has to see one
origin or it will not send the session cookie, so `apps/web/vercel.json` forwards `/api` to the api
deployment with one path preserving rule. Better Auth already lived at `/api/auth`; the collection
lived at the root, and no single rule covers both. Moving it was cheaper than two rules nobody would
understand a month later.

**The design system is enforced, not described.** `scripts/check-design-tokens.mjs` runs in `pnpm lint`
and fails on a colour literal or a spacing value off the scale anywhere in `apps/web/src`. Tailwind is
wired to `packages/config/tokens.css` with the default palette and spacing scale switched off, so the
only utilities that exist are the ones the design system allows and the number in the class is the
pixel value.

**The theme is decided twice on purpose.** A plain script in `index.html` sets it before the stylesheet
loads, so no load ever flashes the wrong colours, and `src/theme/theme.ts` holds the same rule for the
running app. `theme.test.ts` runs both against the same cases so they cannot drift.

**Contrast is measured, not asserted.** `contrast.test.ts` reads the tokens and computes every text
pair. Dark: 16.68 and 5.82 to 1. Light: 17.30 and 4.89 to 1. A label on the accent needs a different
answer in each theme, so `--accent-text` is the page background in dark and white in light.

**Today shows due and new as two facts.** A collection imported an hour ago has nothing due and plenty
new, and one number saying "nothing is waiting" reads as a broken app. The minutes estimate uses
`DEFAULT_ANSWER_SECONDS` from `packages/core` and says "about", because measuring needs the review log
and the client has none until sync lands in phase 8.

## What phase 4.5 changed

**Recovery codes are the credential, not a step towards one.** Ten at registration, single use, argon2id
hashed with the same parameters as a password. With no mail sender there is no way to prove somebody
owns an address, so recovery rests on something they hold. Anybody with a code is in the account without
the password, and the text next to the codes says that in both languages.

**Registration is open behind two temporary guards.** `AUTH_REGISTRATION_OPEN` closes it with one switch
in Vercel. `AUTH_MAX_REGISTRATIONS_PER_DAY` caps successful registrations per address at three a day,
counting successes rather than attempts, which is what the rate limiter already counts.

**TOTP is optional and cannot lock anyone out.** Enrollment is inactive until a code from the app is
typed back, and turning it on issues a second, separate set of codes for a lost phone. Better Auth
accepts any code inside the skew window; `src/auth/totp-replay.ts` pins the step a code came from and
refuses anything at or below it, so a code works exactly once.

**The mail seam is built and switched off.** `src/mailer.ts` holds the interface and a log mailer.
Verification and password reset are written in full behind `AUTH_REQUIRE_EMAIL_VERIFICATION` and driven
end to end by tests that run with it on, reading the token out of the log mailer.

## Next

1. **Commit the dialog pass and push the branch.** The working tree holds it, all three gates pass, and
   nothing is verified on a real phone until a preview builds it.
2. **Check the new dialogs on a real phone**, in both themes and both languages. The enrollment steps,
   the ten codes, deleting an account, and turning the second factor off. All of it was measured
   against a staged 336 pixel keyboard, which proves the arithmetic and not iOS Safari.
3. **Look at the bar at .58 on a real screen.** The ratio clears AA over the worst backdrop this app
   can produce. Whether it reads as thin rather than washed out is a judgement nobody can make from a
   contrast number.
4. **Decide where the api runs.** It answers from `iad1` and requests enter at `fra1`, which is about
   350 ms a request from Europe and 3.9 s on a cold start. Moving it to `fra1` is one line, but the
   database has to move with it.
5. **Walk through the checks** in `phase-5.md`, in order. Most need a real phone and a real
   authenticator app.
6. **Apply the copy** over the list in `docs/copy-audit.md`, and regenerate it with `pnpm copy-audit`.
7. **Phase 6**, the cards themselves: the note editor, the three note types, import from JSON and CSV
   with a preview, duplicate detection, and taking an import back whole.

## Open threads

- **Two deploys work, as of 13 August.** `neuron-api` from `apps/api`, `neuron-web` from `apps/web`,
  both connected to GitHub. `https://neuron-api-parkour-clan.vercel.app/health` answers, and the app is
  at `https://neuron-web-parkour-clan.vercel.app`. Vercel Authentication is off on both, or the preview
  and the app would both sit behind an SSO page. Push a branch and let the preview build it; merge to
  `main` only once it is green. The deployment section of `CLAUDE.md` has the rest.
- **`APP_ORIGIN` is the only address variable, as of 15 August.** One comma separated list on the api.
  The first entry is canonical: Better Auth signs cookies for it, CORS answers with it, reset links
  point at it, and `GET /health` reports it so the question can be answered with one request. Every
  entry is allowed to make a request, and an entry after the first may contain `*`, which is how the
  preview deployments are trusted as a pattern rather than one hostname at a time. `BETTER_AUTH_URL`
  is gone: it held the same address and could disagree with it, and when it did every sign in and
  every sign up was refused with a 403 nobody could read. Moving to a real domain is this one entry.
- **Preview deployments sign in against the production api and the production database, but only at
  the branch address.** `APP_ORIGIN` trusts `https://neuron-web-git-*-parkour-clan.vercel.app`, which
  is the branch alias. Vercel also gives every build a deployment alias, `neuron-<hash>-parkour-clan`,
  and that one matches no pattern in the list: opening it ends in "The server does not recognise this
  web address" on the first request. Use the branch alias when handing a preview to somebody, or add
  the deployment form to `APP_ORIGIN`. The api's own preview deployments have never had
  `DATABASE_URL`, so they do not boot; nothing points at them.
- **The two registration guards are temporary.** Both exist only because there is no email verification.
  Remove them in phase 11 rather than leaving them to rot.
- **The password policy is a length floor and about forty entries.** `packages/shared/src/password.ts`.
  A real check needs a breach corpus, which is a service call or a large file to ship. Phase 11.
- **Mail is not delivered.** `MAILER=log` writes to the server log and sends nothing. Needs a domain and
  a provider. Two details are written up in `docs/architecture.md`: the reset token is a row, consumed,
  stored as a digest, and the verification token is a signed JWT that expires but is not consumed.
- **The codes for a lost phone are encrypted, not hashed.** Better Auth's two factor plugin has to list
  what is left, so it cannot hash them. The account recovery codes are hashed. Both are auth role only.
- **`sync_conflicts` is written and never read.** The screen belongs with the interface. The rows have to
  start being written now, because a conflict that was not recorded cannot be recovered afterwards.
- **No service worker, so the app needs a connection.** Offline and the install prompt both land in
  phase 8, together. A half built service worker serves a stale page that survives a reload, which is
  the one failure a person testing this cannot diagnose.
- **The library is read only.** Making, renaming and moving decks is phase 6. The tree proves the
  chain: database, repository, api, client, screen.
- **The Today estimate is not a forecast yet.** It multiplies the due count by one default answer time.
  The real thing needs the review log on the client, which arrives with sync in phase 8.
- **The screenshot baselines are `win32`, and the suite is not in CI.** The interface face is the
  platform's own, so the same page is set in SF Pro on a Mac and Segoe UI on Windows and neither is
  wrong. A Linux runner has neither, so its baselines would have to be generated on a Linux machine.
  Run `pnpm --filter @neuron/web test:screens` before and after anything visual, and update a baseline
  deliberately with `test:screens:update` so the diff is the review.
- **Panels and cards is offered and costs what it costs.** 56.5 frames a second against 60 on this
  profile, and it falls apart on a slower one. That is the person's choice to make, and the frame rate
  watchdog is what catches it when they make it on a phone that cannot afford it.
- **The keyboard behaviour is tested against a staged keyboard, not a real one.** `keyboard.spec.ts`
  and `dialogs.spec.ts` set the three variables `viewport.ts` publishes and measure where things land.
  The arithmetic and the CSS are proved; iOS Safari's own behaviour still wants checking by hand.
- **The dialog pass is not committed.** Fifty odd files in the working tree, every gate green. The
  mockup at `Design systems/neuron-visual-system new.html` is updated with it and is not in git, so it
  cannot be recovered from a branch if it is lost.
- **Registering is stubbed in the browser tests.** `tests/fixtures.ts` answers `/sign-up/email` with a
  fixed set of ten codes so the screen that follows it can be photographed. The real endpoint is
  covered by `apps/api/src/auth/registration.test.ts`.
- **`auth.recoveryCodes.subtitle` was shortened to make the codes fit a phone.** It said the codes work
  once and are the only way back in; it now says both in one line. If the warning above it is ever
  softened, this is the sentence that was carrying the rest.
- **Enrolling in the second factor is a fixture, not a round trip, in the browser tests.**
  `tests/fixtures.ts` answers `/two-factor/enable` and `/recovery/regenerate` with fixed values so the
  screenshots are stable. The real flow is covered by `apps/api/src/auth/totp.test.ts` against a real
  database, and the two have never been run end to end together.
- **The copy from the design pass is not applied.** The glossary is in `docs/design-system.md` and the
  strings the new controls needed were written in both languages, but the rest of the interface still
  says what `docs/copy-audit.md` lists. The library is called Library, not Decks, for one.
- **The copy pass has not landed.** `docs/copy-audit.md` lists 153 strings with 47 flagged: 27 where
  the two languages differ in length by more than 40%, 22 errors that name a problem without a next
  step, 6 controls labelled with a bare verb. Regenerate it with `pnpm copy-audit` after rewriting.
- **`prettier --check` fails on ten files**, all older than this session, mostly line endings on a
  Windows checkout. Was twenty four; everything touched since has been formatted.
- **No custom domain.** Deliberate, see the decision log.

## Decisions

Why things are the way they are. Do not relitigate these without a reason.

| Date       | Decision                                                                               | Why                                                                                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08    | Host on Vercel, not Cloudflare                                                         | Cloudflare's free tier CPU time limit makes password sign in impossible                                                                                                                                                                                                                              |
| 2026-08    | A deck and a folder are one entity                                                     | Studying a folder means studying its subtree. Each deck stores its ancestors as an array, so a subtree query is one statement, not a recursive walk                                                                                                                                                  |
| 2026-08    | `reviews` is append only                                                               | Card state is a projection of the log and can always be rebuilt. This is tested, not promised                                                                                                                                                                                                        |
| 2026-08    | Two barriers around user data                                                          | The repository layer cannot be called without a user context, and row level security compares rows independently. Code correctness is not the only defence                                                                                                                                           |
| 2026-08    | `packages/core` takes `now` and the RNG as parameters                                  | It must produce identical results in the browser offline and on the server during sync                                                                                                                                                                                                               |
| 2026-08-08 | The metric is peak load and predictability, not words per year                         | Volume scales with time invested and no policy beats that. What breaks people is the day that turns into 140 minutes without warning. Measured on 50 new cards a day, not Anki's default 20                                                                                                          |
| 2026-08-08 | Dropout is presented as an assumption with a sensitivity sweep                         | A simulated student does not quit. Modelling that would produce a result driven by assumptions rather than data                                                                                                                                                                                      |
| 2026-08-11 | Authentication gets its own database role                                              | One role cannot tell "part of signing in" from "a route handler". A credential the application does not hold can                                                                                                                                                                                     |
| 2026-08-11 | Deleting an account marks it, and a task run as the owner removes it thirty days later | The request path then has no route to a deleted review at all, which is stronger than a flag the request path is trusted not to set                                                                                                                                                                  |
| 2026-08-11 | Rate limiting lives in Postgres, not Redis                                             | Traffic is three people. A second service to run, pay for and notice the failure of is not worth a counter                                                                                                                                                                                           |
| 2026-08-11 | A sync page ends on a revision boundary, never inside one                              | Cutting inside one leaves a client holding half a transaction and believing it had all of it                                                                                                                                                                                                         |
| 2026-08-11 | A client may push `suspendedAt` on a card and nothing else                             | Everything about the schedule is derived from the review log. A client that could push a stability would not need to forge a review                                                                                                                                                                  |
| 2026-08-12 | Google sign in is removed, not deferred                                                | Email and password is the only way in. Twenty minutes in a console, a second provider to keep working, and an account linking rule, for three people who all have passwords                                                                                                                          |
| 2026-08-12 | A recovery code is a full credential and is hashed like a password                     | Nothing ever needs to read one back. A scheme that can produce the original means a copy of the table plus the key is a set of working logins                                                                                                                                                        |
| 2026-08-12 | An accepted TOTP code pins its step, and lower steps are refused                       | The skew window exists for clocks, not for replay. Without this a code read over somebody's shoulder keeps working for another minute and a half                                                                                                                                                     |
| 2026-08-12 | The password reset token is stored as a digest                                         | Better Auth stores it as a row identifier in the clear, so anybody who could read that table could reset any password in it                                                                                                                                                                          |
| 2026-08-12 | The message catalogue lives in `packages/shared/src/i18n/`                             | The api sends codes and never sentences, so the sentence for a code has to exist somewhere both ends agree on. `ru` is typed against `en`, so a missing key does not compile                                                                                                                         |
| 2026-08-12 | Test files share one database and never truncate it                                    | Emptying between tests pulls rows out from under the file running beside it. Every person and caller address is minted unique instead, and every query is scoped                                                                                                                                     |
| 2026-08-12 | Database pools hold at most two sockets                                                | The driver defaults to ten. A serverless invocation handles one request, and the test run opens enough pools that ten each exhausts the Neon endpoint                                                                                                                                                |
| 2026-08-12 | `vercel build` runs before every push to `main`                                        | The builder type checks with compiler options of its own, so four commits whose deploys failed had passed `pnpm typecheck` locally. Only the builder catches those                                                                                                                                   |
| 2026-08-12 | Vercel Authentication is off for the api                                               | Phase 5 calls this api from users' browsers, and an SSO page in front of it would block every one of them. Every route except `/health` still refuses a request with no session                                                                                                                      |
| 2026-08-13 | The whole api moved under `/api`, except `/health`                                     | The browser must see one origin or it withholds the session cookie. Auth was at `/api/auth` and the collection at the root, and one forwarding rule cannot cover both shapes                                                                                                                         |
| 2026-08-13 | A branch preview replaces the local `vercel build --prod`                              | The local build took fifty minutes and printed nothing, so it was going to be skipped. The preview runs the same builder with the same options, and a failure there sends no production email                                                                                                        |
| 2026-08-13 | Tailwind's default palette and spacing scale are switched off                          | The only utilities that exist are the design tokens, and the number in a class is the pixel value. A lint check fails on a colour literal, so the rule cannot be broken by accident                                                                                                                  |
| 2026-08-13 | The theme is applied by a plain script in `index.html`, before the stylesheet          | Applied from React instead, every load paints one frame of the wrong theme. The same rule in TypeScript is run against the same cases by one test, so the two copies cannot drift                                                                                                                    |
| 2026-08-13 | Theme and language live in local storage and on the account                            | Local storage is what the first paint can read; the account is what makes the choice follow somebody to a second device. Superseded on 2026-08-14                                                                                                                                                    |
| 2026-08-14 | The device wins for theme and language, and the account is only adopted once           | The account winning meant the server overwriting a choice made on this device, on every load and again on every switch, and two switches inside one round trip leaving the wrong one. A device that has never chosen still adopts the account's answer, so a new phone arrives in the right language |
| 2026-08-14 | A preference change never has a request in its path                                    | The person is looking at the control they moved. Nothing on screen may wait on a network that might be down, so the value is applied synchronously and the server is told afterwards, one request at a time, with the answer discarded                                                               |
| 2026-08-14 | Content already on screen is never replaced by a spinner or an error                   | A refetch that failed behind a rendered screen leaves it alone. The session gate used to swap the whole app for an error page when one background request dropped                                                                                                                                    |
| 2026-08-13 | The recovery codes are held in `sessionStorage` until the box is ticked                | A reload is the one exit a browser always keeps. Codes in tab storage for a few minutes is a smaller risk than a pull to refresh destroying the only credential an account has                                                                                                                       |
| 2026-08-15 | Tokens are two layers, and a component may only name the second                        | A component that reaches into the palette is what makes a second theme a second stylesheet. The linter fails the build on it, so the layer is a rule and not a habit                                                                                                                                 |
| 2026-08-15 | Glass is for floating layers only, and never stacks                                    | A blurred layer costs once per frame it covers. On a five hundred row list, blur on every row is dozens of layers repainting per frame, and the rule is enforced in css rather than left to discipline                                                                                               |
| 2026-08-15 | The glass level a device paints is the chosen one capped by what it can afford         | A phone that stutters cannot be identified from a user agent string. Reduced motion and reported memory are read before the first paint, and a scroll measured under 55 fps steps the ceiling down for the session                                                                                   |
| 2026-08-15 | The interface is set in the platform's own face                                        | Option A of the two in the mockup. It costs zero bytes, its Cyrillic and hinting are already tuned for a phone, and with nothing downloaded there is no swap and nothing reflows. The role tokens stay, so the reading serif is two lines away                                                       |
| 2026-08-15 | The gallery at `/dev/components` exists, and only outside production                   | A new screen is composed from what is drawn there rather than improvised, and a regression is visible in one place. `VERCEL_ENV` decides, and the production bundle does not contain it                                                                                                              |
| 2026-08-16 | A dialog is a centred panel at every width, and everything it holds fits a phone            | A sheet grows from the bottom, so its content ends up at the foot of the screen, and the keyboard takes 336 pixels of that. Centred, both edges give way at once. Anything that still does not fit is more than one step, and `dialogs.spec.ts` is what says so                                    |
| 2026-08-16 | Every label on a floating bar is primary, so the bar's tint can be .58 instead of .78      | Transparency and contrast are one dial: the share of the backdrop showing through is one minus the alpha, and the floor is the quietest text on the layer. `backdrop-filter: brightness()` buys nothing, it lowers the worst case and the variation by the same factor. The pill marks the tab    |
| 2026-08-16 | Turning off the second factor, and deleting an account, cost a code as well as a password  | Both are reachable from a session that is already open, which is what a borrowed unlocked laptop hands to somebody else. One removes the protection against somebody who has the password, the other cannot be undone. The typed phrase they replaced proves only that somebody can read and copy |
| 2026-08-16 | Destructive is a quiet slab with the label in the signal hue, not a word in a sentence     | A filled red button is still banned: the hue exists for error text. But the last action in a dialog about deleting an account has to read as the button that finishes, and as red text it did not                                                                                                 |
| 2026-08-16 | The mockup, the design docs and the code move together                                     | The mockup is what the visual design was approved from and what a later change is judged against. A change that lands only in the code makes the reference wrong, and then nobody can tell which of the two is the mistake                                                                        |
| 2026-08-15 | The Playwright suite runs on one worker                                                | One of its tests measures a frame rate with the processor throttled to a quarter speed. A second worker competes for exactly the resource being measured                                                                                                                                             |

## Verification commands

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass before any unit of work counts as done. Then push a branch and wait for the Vercel
preview to go green before merging to `main`. The full list is in `CLAUDE.md`.
