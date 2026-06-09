---
name: Reading the real runtime env on Replit
description: Shell env can be stale after secret changes; how to read the authoritative value and the Next.js private-folder gotcha
---

# Verifying environment variables the running app actually sees

**Problem:** After a secret/env var is changed, a fresh `bash`/`node` process may still report the OLD value — the shell environment can lag. Do not trust `process.env` from bash to confirm a just-changed secret.

**Authoritative method:** Restart the workflow (so the server picks up the new value), then read the value from *inside the running server*. A throwaway unauthenticated API route is the reliable channel:
- Add a temporary route that returns safe diagnostics about the env value (never the secret itself): parsed host/port/db, structural flags (length, has `@`, starts with scheme, etc.), and a masked head/tail. This pinpoints malformed connection strings without leaking the password.
- Curl it via `https://$REPLIT_DEV_DOMAIN/<route>`.
- Remove the route + restart when done.

**Next.js App Router gotcha:** A route folder whose name starts with `_` (e.g. `app/api/_dbcheck`) is a *private folder* — excluded from routing, returns 404. Name diagnostic routes without a leading underscore.

**Replit-managed secrets:** Some keys (e.g. `DATABASE_URL`) are populated by Replit and cannot be set via `requestEnvVar`/`setEnvVars` (conflict / "should not be requested"). `deleteEnvVars` removes only shared env vars, not secrets. The user must edit/delete such keys manually in the Secrets panel — give them the exact value to paste.
