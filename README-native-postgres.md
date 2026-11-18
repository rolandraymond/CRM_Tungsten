# CRM on native Railway PostgreSQL

This version talks directly to PostgreSQL through the Express API. It does not call Supabase Auth, PostgREST, Realtime, or the Supabase browser SDK. The existing `auth` schema holds migrated identities; its name does not imply a running Supabase service. Historical SQL migrations remain in `supabase/` for reference. Do not run the old Supabase CLI migrations against this target.

## What was migrated

The reviewed import already populated `crm_tungsten` with 58 source tables. The application setup adds the three pending application migrations and native session/rate-limit tables, creating 71 tables across the reviewed schemas. The setup checks that original table counts and password fingerprints stay unchanged. It creates one internal workspace for the imported platform administrator and does not invent agency contacts, deals or approved plans from clinic patients.

The original accounts keep their user IDs and bcrypt password hashes. Sign in again with a source account's existing email/password; previous Supabase browser sessions are not accepted. Existing clinic memberships remain. The newer agency CRM starts empty apart from its workspace/memberships because those records were absent from this source snapshot. Clinic records appear in their clinic screens, not automatically in agency sales screens.

## Apply and run locally

First apply the accompanying guarded patch to your repository. The installer backs up changed files outside Git and refuses to overwrite unexpected edits.

From your repository root:

```bash
python3 scripts/configure_native_database.py --install-local-env
npm ci
npm ci --prefix apps/api --include=dev
npm ci --prefix apps/web --include=dev
npm test
npm run build
npm run dev
```

The database setup prompts privately for the Railway PostgreSQL administrator's **public** URL. Paste the URL of the same PostgreSQL service into which the reviewed dump was imported. The script always selects `crm_tungsten`, checks its owner, and refuses to reinitialize an existing native schema/runtime login. It executes setup in one transaction and does not switch any running deployment.

The script generates the limited `crm_tungsten_app` login, creates a private `api.env` under `~/Documents/Tungsten-CRM-Backups/native-runtime-.../`, and with `--install-local-env` merges its four settings into `apps/api/.env`. Existing Meta/Finance settings are preserved and the prior local environment is backed up privately. Keep these files off Git and out of chat.

Open Vite's printed local address. Verify sign-in, a page refresh, the real clinics/memberships, agency workspace access, one deliberate new contact, and sign-out. The frontend needs no `VITE_SUPABASE_*` values. Do not run the dump import again on the now-populated database.

## Railway cutover

Copy the generated private `api.env` values into the **CRM application service** Variables, not into another app's service. The required settings are:

| Variable | Value/purpose |
| --- | --- |
| `DATABASE_URL` | Generated URL for `crm_tungsten_app`, targeting `/crm_tungsten` |
| `DB_POOL_MAX` | `5` connections per application process |
| `SESSION_TTL_HOURS` | `12` |
| `NODE_ENV` | `production` |
| `SOCIALLENS_WEBHOOK_SECRET` | Generated random secret, if using the external SocialLens receiver |

Keep existing Meta and Finance integration settings when used. Supabase URL, publishable and service-role keys are no longer read by this runtime. Remove those obsolete values after the native deployment has been verified. Never substitute the PostgreSQL administrator URL for the generated application URL.

The generated public URL works from your computer and the application. Only change its host/port to Railway's internal database address if the application and database share the appropriate private network; retain its generated username/password and `/crm_tungsten`. Preserve the provider's SSL configuration. Do not use `postgres.railway.internal` from your laptop.

Use the repository root as the Railway build root:

```text
Build: npm ci --prefix apps/api --include=dev && npm ci --prefix apps/web --include=dev && npm run build
Start: npm start
Healthcheck: /health
```

Push the patch on your working branch and merge via a pull request according to the repository's protection rules. Deploy the new commit with the native environment settings together. Local `.env` edits do not change Railway Variables. The server checks the target database/login before opening its listening port. `/health` is a process health check; also verify a real sign-in after deployment.

Stop the old CRM instance from writing during the final cutover. The imported snapshot includes data only up to its dump time; do not assume later source edits are included. Roll back by restoring the previous application commit **and its previous environment settings** if needed; do not delete or restore over the other PostgreSQL databases. A rollback to the old source does not automatically copy new native writes back.

## Authentication and permissions

The API verifies existing bcrypt passwords and issues random opaque bearer tokens. Only token hashes and password fingerprints are stored in `private.native_sessions`. Logout revokes the token; expiration, bans, deletion and password changes invalidate it. Login limits are persisted in PostgreSQL. Account creation requires the relevant existing administrative access and a password of at least 12 characters (maximum 72 UTF-8 bytes). No public signup, email delivery, OAuth or password-recovery service is introduced by this patch.

The runtime login is `NOINHERIT`, has no ownership/superuser/BYPASSRLS privileges, and can switch only to the CRM-specific user/service roles. User queries run in individual transactions with the verified user ID in transaction-local claims, preserving the existing `auth.uid()` helpers and row policies. Background workers and authorized administration use the CRM-scoped service role. Native SQL uses parameterized values and checked identifiers.

## Integration differences

- Supabase Realtime subscriptions are replaced by polling every 15 seconds while the page is visible, plus refresh on focus. Notifications are not instantaneous.
- External SocialLens posts need `x-webhook-secret: <SOCIALLENS_WEBHOOK_SECRET>` and should pass `workspace_id` explicitly. Existing senders must be updated. Recent webhook logs require authenticated workspace owner access; they remain an in-memory diagnostic cache.
- Authenticated owners can exercise the internal SocialLens integration route with their bearer session. Meta webhook verification/signature checks remain required.
- No Storage objects were present in the reviewed source. This patch does not introduce an object-storage service.
- Automatically fabricated approved plans and default fabricated deal amounts were removed. Actual submitted plan values continue to be accepted; illustrative payloads in integration documentation are examples.

## Validation

`npm test` runs six unit/HTTP checks and skips the fixture integration suite by default. `npm run build` checks and builds both applications. The native integration suite was additionally run on disposable PostgreSQL 18 with the reviewed source dump, covering native login/reload/logout, session invalidation, user creation, CRM writes, SQL injection filtering, nested/composite relationships, clinic RPC idempotency, cross-workspace RLS, 40 concurrent queries using a pool of two, Meta persistence/deduplication, and SocialLens authentication/attribution. Four separate database sentinels stayed unchanged. Test fixture hashes/passwords are not source account passwords. The integration suite refuses nonlocal targets and requires an explicit test-only database setting; do not enable it on production.

Local tests do not prove that production networking, Railway Variables, Meta credentials or a user's remembered password are correct. Confirm those during the cutover.
