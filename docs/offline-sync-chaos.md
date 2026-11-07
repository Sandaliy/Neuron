# Offline sync chaos testing

The harness runs the built PWA in separate browser contexts against loopback HTTP and disposable
PostgreSQL. It exercises the normal UI, service worker, IndexedDB, outbox coordinators, application
routes and restricted database role. The existing live-test server substitutes session lookup. The
harness can move that fixture from the original account to an expired session and a different
account. It does not issue real Better Auth cookies.

## Run and reproduce

Use a disposable database. Setup applies migrations and empties the test database once per
invocation using the same setup as the API suite. Set `DATABASE_URL_TEST` to its owner URL and
`DATABASE_URL` to the application-role URL for a **different database**. The test infrastructure
uses the latter's credentials to connect as the restricted role in the disposable database. A
local PostgreSQL installation needs the same WebSocket proxy as CI, configured with
`DATABASE_URL_TEST_WS_PROXY`. Do not point the suite at a shared database or run two suites against
the same disposable database at once.

Run these commands from the workspace root after configuring the database.

```powershell
pnpm --filter '@neuron/web...' build
pnpm --filter @neuron/web exec playwright install chromium webkit
$env:SYNC_CHAOS_DISPOSABLE_DB = 'true'

# CI selection: one mixed-delivery seed and one session-expiry scenario
pnpm --filter @neuron/web test:sync-chaos --project=chromium

# Eight seeds plus the session-expiry scenario on each browser
$env:SYNC_CHAOS_STRESS = 'true'
pnpm --filter @neuron/web test:sync-chaos

# One reported seed on its original browser
$env:SYNC_CHAOS_SEED = '104'
pnpm --filter @neuron/web test:sync-chaos --project=chromium
Remove-Item Env:SYNC_CHAOS_SEED, Env:SYNC_CHAOS_STRESS
```

On Linux, export the equivalent variables and use Playwright's `install --with-deps` when system
dependencies are missing. The explicit seed overrides the stress list. To run only the expiry
scenario, leave the seed unset and pass `--grep expiry`. The suite uses one worker, zero retries
and a 90-second bound per case. CI runs the two Chromium cases in the database-backed verification
job and keeps the report and test results if they fail. On the Windows reference run, the CI selection took 23 seconds and the 18-case stress run took about 5 minutes 18 seconds, excluding browser installation and build.

The seed fixes the staging order and ratings. Request and database barriers control the fault
schedule and commit order. Generated UUIDs and timestamps come from the application on each run.
Unrelated parallel requests may appear in a different order in the trace. Open the Playwright
report under `apps/web/artifacts/sync-chaos/playwright-report` for the named invariant that failed and the
browser trace. Each case writes `sync-chaos.json` under `apps/web/artifacts/sync-chaos/test-results` with its
seed, operation order, device labels, HTTP outcomes and fault boundaries. The JSON contains no
request bodies, account identifiers, session material or database URLs. All records in the
browser traces belong to synthetic fixtures.

## Faults and assertions

| Scenario                                                                           | Boundary proof                                                                                                                                                                                                                                                                                                                                                                                    | Persisted checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two offline devices edit the same Note, create collections and Study the same Card | The first answer socket closes before dispatch and the Review table stays empty. Its exact retry commits before a held reply. B commits and acknowledges its answer before A receives its earlier reply. A's Undo commits before its socket closes and its page reopens. A duplicate of the earlier answer acknowledgement is actually returned on the next Undo attempt and leaves Undo pending. | The same immutable command bytes are retried. Undo targets the original answer and the replacement waits for a valid acknowledgement. PostgreSQL retains the three answers and one cancellation. The stored Card matches read-only canonical replay. B's Note edit wins and A retains its losing draft and explicit `changed_remotely` outcome. Each collection creation has one row and one receipt. Both browser caches match the full authoritative pull after foreground validation. |
| Expiry after a creation commits with a later Note edit pending                     | The creation row and receipt exist before a reply. Real account middleware returns 401 under the expired fixture session and the browser revokes the visit before release.                                                                                                                                                                                                                        | Pending intents remain in the original IndexedDB. The other account sees only its own collection and no original receipts under RLS. Restoring the original account retries the exact creation, settles the waiting edit and converges without creating a second row.                                                                                                                                                                                                                    |

The duplicate response is a stale acknowledgement replayed in place of another HTTP response. One
fetch still gets at most one response. An expected conflict or 401 is verified as an outcome,
including what the browser retains. An unexpected status, missing row, changed retry or divergent
projection fails the case.

## Reauthentication defect under critical review

On protected main, after Settings observes an expired session, signing in with fresh credentials
can leave the browser on Sign in. The real Better Auth sign-in returns 200 and the browser's new
cookie reaches the second account through the real account endpoint. The protected UI still does
not open. The isolated reproduction makes no offline mutations. The expiry smoke case takes a
fresh navigation after sign-in so it can check durable recovery separately.

Run the intentionally failing reproduction with the same disposable setup and
`DATABASE_URL_AUTH` configured for the authentication role:

```powershell
$env:SYNC_CHAOS_REAUTH_REPRO = 'true'
pnpm --filter @neuron/web test:sync-chaos --project=chromium
Remove-Item Env:SYNC_CHAOS_REAUTH_REPRO
```

The reproduction records only HTTP statuses and the final route. Browser tracing is disabled
for this case because it uses real authentication cookies. Keep it outside the protected
regression selection until critical review resolves the sign-in behavior.

## Held branches

These cases are for the combined tree after the respective critical reviews. The harness starts
from protected main.

| PR  | Integration coverage                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #71 | Export with one committed-but-unacknowledged operation, one local-only operation and an immutable Undo. Check the export's authoritative snapshot and another account's isolation. Repeat schema coverage for direction provenance after #86.                                        |
| #74 | Cut transport after an atomic Import chunk commits, then close and reopen with the frozen checkpoint while a second device syncs. Verify stable Note and Card identities, revision bounds, exact retry and Import Undo. Exercise fill-blank merge under its documented retry limits. |
| #86 | Interleave the opening Review, remote suspension/resume and local Undo across devices. Hold the opening acknowledgement, retry it exactly and verify direction provenance, cancellation and the agreed retention policy.                                                             |
| #87 | Deliver equal-time recovery answers across devices with an interrupted batch, Undo or reset. Compare canonical ordering and Slipping Cards evidence after convergence on the combined #86/#87 tree.                                                                                  |

The current suite covers bounded single-Card and single-page collections. Review batches, Practice,
multi-page pull faults, storage quota/eviction, OS process termination and installed-device
acceptance remain separate coverage.
