---
name: therassistant-supabase-types-drift
description: TherassistantEHR's committed database.types.ts is ahead of the live Supabase DB — a naive `supabase gen types` regenerate will silently regress unrelated tables.
---

# TherassistantEHR Supabase types are ahead of the live DB

Many migrations under `artifacts/therassistant-ehr/supabase/migrations/`
(notably the 20260524–20260603 range, e.g. `20260528000000_stripe_connect_express.sql`)
are checked into the repo but have **not** been pushed to the live Supabase
project. The committed `lib/supabase/database.types.ts` was hand-augmented (or
generated from a non-live snapshot) so the codebase + tests assume those
columns exist.

**Why this matters:** running plain
`supabase gen types typescript --project-id <ref>` will overwrite the types
with the *live* (smaller) schema, silently regressing dozens of unrelated
tables/columns. Tests that wire the shared `schemaGuard` will then fail with
"unknown column 'stripe_connected_account_id'" etc. The schemaGuard itself
isn't broken — the live DB really is missing the column.

**How to apply:**
- Before a wholesale regen, diff `git checkout HEAD -- database.types.ts`
  against the regenerated output and identify which migrations are unapplied.
- Push missing migrations to live via the Supabase Management API
  (`POST https://api.supabase.com/v1/projects/<ref>/database/query` with
  `SUPABASE_ACCESS_TOKEN`) — the Postgres pooler password is **not** in env,
  so `psql` against the pooler won't auth. `DATABASE_URL` points at the local
  Replit `heliumdb`, not Supabase.
- For narrowly-scoped tasks (e.g. dropping a specific overlay entry), prefer
  surgical patches to the committed types over a full regen, then leave a
  follow-up to actually sync the live DB.
- When regenerating via `npx -y supabase@latest gen types typescript`, the
  npx stdout sometimes appends `npm notice ...` upgrade banners after the
  TS output. Strip them (`sed -i '/^npm notice/d'`) or the file fails
  esbuild parsing with "Expected ';' but found 'notice'".
- Several "missing" migrations actually have hidden prerequisites that
  never made it to prod (eligibility_benefit_segments table absent;
  professional_claims.archived_at column absent;
  staff_profiles.auth_user_id column absent). When the migration touches
  one of these, sanitize it with `to_regclass(...) is not null` / column
  presence gates before applying, instead of replaying the historical
  chain blindly.
