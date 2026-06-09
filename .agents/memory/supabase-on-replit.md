---
name: Supabase Postgres connection from Replit
description: Why Supabase direct connections fail on Replit and which connection string to use
---

# Connecting a Replit app to an external Supabase Postgres

**Rule:** Use the **Session pooler** connection string, never the "Direct connection".

- Direct connection host `db.<ref>.supabase.co` is **IPv6-only**. Replit cannot resolve it → `getaddrinfo ENOTFOUND db.<ref>.supabase.co`. No code fix helps; the host is simply unreachable.
- Session pooler host looks like `aws-<n>-<region>.pooler.supabase.com:5432`, username is `postgres.<project-ref>`, database `postgres`. This resolves and connects fine from Replit.
- **SSL is NOT required** for the pooler from Replit — plain `new pg.Pool({ connectionString })` (no `ssl` option) connects successfully. So node-postgres code that omits SSL is fine; don't add SSL workarounds preemptively.

**Why:** Supabase moved direct connections to IPv6; Replit's network resolves only the pooler's IPv4 endpoint.

**How to apply:** When a user connects their own Supabase DB, ask specifically for the *Session pooler* URI (Supabase dashboard → Connect → Session pooler). Common user mistakes seen: pasting the Direct connection, pasting only the password, leaving `[YOUR-PASSWORD]` unreplaced, or unencoded special chars in the password. Prefer an alphanumeric DB password to avoid URL-encoding issues.
