# Project state

Where the project stands right now. This file replaces reading `neuron-plan.md` and `phase-*.md`.
Update it with `/handoff` at the end of a working session.

Last updated: 2026-08-16, on `main`. Phase 5.5, the design pass, is merged and live. `e44748d` made
it behave on a phone, and `d9f75a8` is the second pass over that same ground: the bar, the glass
setting, the keyboard, how a press answers, and the second factor control that offered to turn off
something that was already off.

## Now

**Phase 5.5 is built, passing and live.** The app is at
[neuron-web-parkour-clan.vercel.app](https://neuron-web-parkour-clan.vercel.app), wearing the approved
design system. Sign up, sign in, the ten codes, recovery by code, the second factor, settings, the read
only library tree and Today. Two themes, two languages, three glass levels.

`pnpm typecheck`, `pnpm lint` and `pnpm test` all pass: 700 tests, none skipped. The Playwright suite,
`pnpm --filter @neuron/web test:screens`, passes its 62 checks, and the production deploy after the
merge went green.

**`docs/design-system.md` is the reference now, and `/dev/components` is the drawn version of it.**
Read both before changing anything visual. `docs/design-principles.md` is a pointer to it; every value
that used to be in that file is wrong.

### What the design pass changed

**Tokens are two layers.** A raw palette, then a semantic layer that is the only vocabulary a
component speaks. `scripts/check-design-tokens.mjs` fails the build on a colour literal, a spacing
value off the scale, a raw duration, or a raw token named in a component, so the second layer is a
rule rather than a habit.

**Glass is a setting, not a look.** Three levels, off, medium and max, device local, applied before
React exists and never synced. The level painted is the chosen one capped by what the device can
afford: reduced motion, four gigabytes of memory or less, or a scroll measured under 55 frames a
second. When the ceiling comes down the panel says so instead of quietly disagreeing with the control.
Nothing in the content flow is glass, two blurred layers never stack, and the blur radius is never
animated.

**The frame rate is measured, not asserted.** Five hundred rows in the library, the default level, a
375 by 812 viewport at two device pixels per css pixel, the processor throttled to a quarter speed:
**60.0 fps, worst frame 16.8 ms**, which is the display cap with nothing dropped. The same harness
reports 58.4 fps at ten times throttling and 21.0 at twenty, so it can see past the cap.

**Contrast is measured again, against the new tokens.** Forty ratios printed on every test run.
Secondary text on dark bar glass over its worst backdrop is 4.60 to 1 and 4.72 on light; tertiary
lands at 3.34 and 3.12, which is why it is banned there and the blurred layers redefine
`--text-tertiary` to the secondary tone rather than leaving it to discipline.

**Type is the platform's own face**, option A from the mockup. Nothing is downloaded, so there is no
swap and nothing reflows when a face lands late. The role tokens stay, so the mockup's reading serif
is two lines in `tokens.css` away.

### What the phone pass changed

Six things reported from a real iPhone, all fixed and all now tested.

**The zoom nobody could undo was the fields.** They were fifteen pixels, and iOS Safari zooms the page
the moment a field under sixteen is focused and never zooms back, so every screen opened at about 110%
and scrolled sideways. Sixteen is a size in the theme now, with the reason next to it.

**Sheets are three parts instead of one scrolling block**: a heading that stays, a body that scrolls,
and a footer that stays. Setting up 2FA needed the keyboard dismissed before Continue could be pressed.
A full page form gives its space back the same way, by collapsing the gap it was holding open and
reserving the keyboard's height underneath so there is somewhere to scroll to.

**The tab bar sits at the bottom on every size, against the bottom of what is on screen.** A fixed
element is placed against the layout viewport, which on iOS runs on underneath Safari's toolbar, so the
bar hid behind the toolbar while it was out and floated far too high once it retracted. The tracker
publishes the browser's own inset separately from the keyboard's, because the bar lifts for one and
leaves entirely for the other, and its offset is the safe area less twelve rather than plus a gap.

**Where it applies is a real setting**, panels only or panels and cards.

**Motion was specified and barely used.** Screens arrive, their first four blocks arrive a beat behind
them, deck children reveal, chips pop, presses answer by less the larger the thing is, and the
segmented thumb takes the screen duration rather than the control one.

**Measuring that found a real bug.** Every entrance filled `both`, which holds the last keyframe on the
element for ever, and a held transform keeps it on a composited layer of its own: the container holding
five hundred rows became one 38,000 pixel layer and the library scroll fell from 60 frames a second to
**8.7**, with nothing on screen looking any different. Entrances fill backwards now, exits fill
forwards, and `motion.test.ts` fails the build on `both`.

| 500 rows, 4x cpu | Frames a second | Worst frame | Blurred rows |
| ---------------- | --------------- | ----------- | ------------ |
| Panels only      | 60.0            | 16.8 ms     | 0            |
| Panels and cards | 56.5            | 33.4 ms     | 500          |

**Nobody can quietly degrade the interface now.** `/dev/components` draws every component in every
state, both themes, all three glass levels, and it is registered only outside production. The
Playwright suite photographs it and the five screens at 375 and 1440 in both themes, reads computed
durations back with reduced motion on, and measures the scroll.

Checked against the live deployment, not only locally: registering sets the session cookie on the web
host with `__Secure-` and `HttpOnly`, and a second request carrying only that cookie is accepted. The
account used for the check was deleted afterwards.

### What the behaviour pass changed

**The flicker was the app writing the server's answer back over the person's choice.** Not a stale
refetch: `staleTime` was already 30 seconds, `refetchOnWindowFocus` was already off, and a trace of
one theme switch contains exactly one request, a `PATCH`, and no refetch at all. What happened was
that `PreferencesSync` copied the account's theme and language down whenever they changed, and
`useUpdatePreferences` wrote the mutation's response into the query the session gate reads.

Three faults came out of that, all measured:

- On load the account overwrote the device. The page painted `light` from local storage at 105 ms,
  correctly, and `/account` answered at 886 ms and made it `dark`, in local storage too.
- Every switch re-rendered the whole signed in tree when the request came back, roughly a second
  later. 52 of the 63 component renders in a theme switch arrived after the network.
- Two switches inside one round trip finished out of order and the older answer won, leaving the
  device on the theme nobody picked, permanently.

Theme and language are device preferences now: read while their module is evaluated, applied before
React exists, written synchronously in the click handler, told to the server afterwards one request
at a time with the answer discarded. The account is read once, on a device that has never chosen.

| One theme switch                        | Before        | After  |
| --------------------------------------- | ------------- | ------ |
| Click to the DOM carrying the change    | 2.9 ms        | 2.5 ms |
| React commits                           | 3             | 1      |
| Component renders                       | 63            | 9      |
| Renders arriving after the network      | 52, at 872 ms | 0      |
| With the network refusing every request | works         | works  |

The language switch went from 174 renders across two commits, the second at 1761 ms, to 47 in two
commits both inside 1.1 ms. Its 47 are the text genuinely changing.

**Dialogs sit above the on-screen keyboard.** A sheet is positioned against the layout viewport and
iOS does not shrink that for a keyboard, so the keyboard was drawn over the field being typed into.
`interactive-widget=resizes-content` handles Android; for the rest `src/lib/viewport.ts` measures the
gap between the two viewports and publishes it as `--keyboard-inset`. At 375 px with a 336 px
keyboard the change password sheet's bottom edge moves from 812 to 476, and every field stays above
it.

**Inter does load, and the Cyrillic subset is there**, checked against the fetched files. Two things
around it were wrong: the per subset imports carry no `unicode-range`, so all four files were fetched
whatever language was on, and nothing stood in for Inter while it arrived. Text now shifts 0.24%
instead of 7.80% on the swap, and the line box does not move at all.

**Sign up asks for the password twice**, with live match feedback and a show and hide toggle on both
fields. There is no email recovery in this project, so a password typed wrong is an account nobody
can open.

**153 interface strings are listed in `docs/copy-audit.md`**, generated by `pnpm copy-audit`. The
parts that were not judgement calls are applied and now checked by a test: the second factor is
called two-factor authentication and 2FA, and Russian says ты in all thirty strings that said вы.

### What the second phone pass changed

Five things reported from the iPhone, and three found while measuring them.

**The tab bar jumped when the page was scrolled up.** Its offset was written into `bottom`, and part
of that offset is `--chrome-inset`, which changes every time Safari's toolbar slides in or out, which
is every change of scroll direction. That is a layout pass per reported step, and iOS reports the
move in two or three coarse steps, so the bar arrived in jumps. The lift is a `translate` now, with
the screen duration under it, so the same three steps read as one glide. The tracker also batches
into one frame and writes only what changed: it used to set three custom properties on the root
element per event, several times a frame, and each of those recalculates style for every element in
the document.

**Panels and cards only moved a quarter of the interface.** `Card` painted its own surface with
`bg-card`, and a utility beats the components layer, so the setting reached `RowGroup` and nothing
else. In Settings that is Security and Account changing and Appearance and Language not. The card
names no surface of its own now and the stylesheet paints it in both scopes, and the scope rules
moved after the level rules so a card outside the scope keeps its own surface when the glass is off.
Settings at that scope has a screenshot, which is what was missing when this shipped looking like it
worked.

**The keyboard, again.** Four separate faults:

- A sheet lifted itself in `bottom`, which is layout, on the frames it was also animating in on.
  That lift is a `translate` now and composes with the entrance rather than fighting it.
- Radix focused the first field on open, so iOS raised the keyboard across the sheet's entrance. Two
  system animations crossing, and the keyboard's curve is not one this app can time against. The
  sheet takes the focus instead, and the keyboard comes with the tap on a field, which is also the
  gesture that makes iOS willing to raise it at all.
- Revealing a focused field centred the input, so the sentence underneath went below the fold. That
  is why "At least 10 characters" was half visible. The whole field group is revealed now, and
  inside the sheet's own scroller rather than by `scrollIntoView`, which walks every scrollable
  ancestor including the page: a fixed sheet does not reliably stay put while the page under it is
  scrolled with the keyboard up, and that is the likeliest way Save ended up behind the keys.
- A full page form gives back its head room and its gaps as well as its middle, and the keyboard
  opening scrolls it to its foot, where the fields and the button both are. At 375 by 812 a keyboard
  leaves 476 pixels, and sign in now fits inside them.

**A press answered in ninety milliseconds each way, on one curve.** Down is immediate and back is the
screen duration on the spring. That asymmetry is most of what separates a control that feels like a
phone's from one that feels like a web page's, and it had to move into the stylesheet: a
`transition-*` utility on a component wins over the components layer, so every control was deciding
its own timing again. A word in a sentence dims rather than shrinking. The pill under the current tab
answers a press on that tab and no longer flinches when a different one is hit.

**The curves and the arrival.** `--ease-enter` was an exponential ease out, which spends its travel
in the first fifth of the duration and crawls after it; that is what reads as a swoosh followed by a
slow settle. `--ease-spring` overshot by 28 per cent, which on a segmented thumb is a bounce rather
than a settle. A screen change was a fade on the screen element over a stagger reaching 98 ms, one
fade multiplied by the other, so a tab whose content was already cached took a third of a second to
become legible and read as loading. The screen element no longer fades and the stagger ends at 62 ms.

**Glass: the tint is pinned, the edge is not.** Both rims carry light now rather than the top one
alone, which is what a pane with thickness does. The density is a different matter, and the
arithmetic is worth writing down. For a fixed worst case contrast, how much of the backdrop shows
through is exactly one minus the tint alpha, so a more see through layer is a lower contrast ratio
and nothing else. Dimming the backdrop with `backdrop-filter: brightness()` does not buy anything,
because it lowers the worst case and the visible variation by the same coefficient. Dark bar glass
measures 4.60 to 1 for secondary text and light measures 4.72, against AA's 4.5, so there is nothing
left to spend. More transparency means accepting a measured drop below AA over the worst backdrop,
which is a decision rather than a tweak.

**"Turn off 2FA" existed on accounts that had no second factor.** Settings drew both controls at
once, because nothing on the screen could tell the two states apart: `GET /account` never reported
it. It does now, from the column Better Auth keeps, and the row that applies is the only one drawn,
with the state written underneath it. The account is refetched after either control runs.

**Three things found while measuring.** Every toast was drawn behind the tab bar: its padding named
`--bar-gap`, which nothing defines, and an undefined variable inside `calc` makes the whole
declaration invalid. The specular streak read `offsetWidth` and `scrollHeight` inside its scroll
handler, which forces a synchronous layout of the document on every frame of every scroll, paid for a
highlight one pixel tall. And the first screen asked its two questions one after the other: the
session gate does not render the screens until the account has answered, so the deck tree was only
requested after it. Both start from the entry point now, before React is evaluated. Measured against
the live api from here, warm is 350 ms and cold is 3.9 s, and the api runs in `iad1` while requests
enter at `fra1`, so the Atlantic is crossed twice per request and was being crossed twice in a row.

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

1. **Look at the app on a real phone**, in both themes, and try the three glass levels. Everything
   below 55 frames a second is a bug this project wants to hear about; the setting is in
   Settings, Appearance.
2. **Check the keyboard on a real phone.** The sheet was verified at 375 px against a simulated
   336 px keyboard, which proves the arithmetic and the CSS but not iOS Safari's own behaviour. The
   second pass fixed four faults there, and not one of them can be confirmed from a desktop.
3. **Decide where the api runs.** It answers from `iad1` and requests enter at `fra1`, which is about
   350 ms a request from Europe and 3.9 s on a cold start. Moving it to `fra1` is one line, but the
   database has to move with it: moving one and not the other is worse than moving neither.
4. **Walk through the checks** in `phase-5.md`, in order. The first one, that the session survives a
   reload, has been done from here against the live address; the rest need a real phone and a real
   authenticator app.
5. **Apply the copy** from the design pass when it arrives, over the list in `docs/copy-audit.md`.
6. **Phase 6**, the cards themselves: the note editor, the three note types, import from JSON and CSV
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
  sets the three variables `viewport.ts` publishes and measures where things land. The arithmetic and
  the CSS are proved; iOS Safari's own behaviour still wants checking by hand.
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
| 2026-08-15 | The Playwright suite runs on one worker                                                | One of its tests measures a frame rate with the processor throttled to a quarter speed. A second worker competes for exactly the resource being measured                                                                                                                                             |

## Verification commands

```
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass before any unit of work counts as done. Then push a branch and wait for the Vercel
preview to go green before merging to `main`. The full list is in `CLAUDE.md`.
