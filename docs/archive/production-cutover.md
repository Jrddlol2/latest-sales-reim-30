# Production cutover controls

Demo content stays enabled during product review. It is now isolated behind one server-side master switch instead of requiring code deletion.

## Current testing mode

```text
DEMO_MODE=true
AUTH_MODE=demo
ENABLE_DEMO_LOGIN=true
AUTO_SEED=true
```

This keeps the role launcher, fake employee directory, demo-data settings panel, seed/reset endpoints, and automatic year-of-history seed available.

## Production cutover

Set `DEMO_MODE=false` before deploying the production environment. That single switch:

- omits fake users and demo reference records from the in-memory bootstrap;
- disables the public demo-account endpoint;
- blocks the Admin seed, seed-year, and reset endpoints;
- skips startup auto-seeding; and
- tells the frontend to hide the Demo Data settings tab.

Also set `AUTH_MODE=microsoft`, `ENABLE_DEMO_LOGIN=false`, `VITE_ENABLE_DEMO_LOGIN=false`, and `AUTO_SEED=false` as explicit defense-in-depth configuration. The extra flags make the intended state obvious during review even though `DEMO_MODE=false` is authoritative on the server.

## Required before that switch

The current backend still uses in-memory arrays. With demo mode disabled there are intentionally no fake users to sign in as, so production cutover must wait for:

1. the persistent database migration described in `docs/DATABASE-MIGRATION.md`;
2. provisioned real employee records with real Entra `oid` values;
3. the approved Microsoft OIDC/session adapter; and
4. replacement of the temporary `X-User-Id` trust path.

Do not treat `DEMO_MODE=false` by itself as production authentication. It removes demo surfaces; it does not install the missing database or Microsoft session implementation.
