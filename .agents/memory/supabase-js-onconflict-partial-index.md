---
name: supabase-js onConflict cannot target partial unique indexes
description: Why upserts that target partial unique indexes silently fail with supabase-js, and the workaround.
---

Rule: do NOT design schema so a supabase-js `.upsert({ onConflict: "a,b,c" })` has to match a partial unique index. The client only emits `ON CONFLICT (a,b,c)` with no `WHERE` predicate, and Postgres rejects with `there is no unique or exclusion constraint matching the ON CONFLICT specification`.

**Why:** Postgres requires the arbiter inference predicate to be subsumed by the partial index's `WHERE` clause. supabase-js v2 has no API to set that predicate. We hit this when adding per-user Gmail isolation (`integration_connections.owner_user_id`) and tried to split rows with two partial uniques.

**How to apply:**
- Prefer `unique nulls not distinct (a, b, c)` (PG 15+) when you need both nullable and non-nullable owner rows to coexist with one constraint.
- If you must keep partial indexes, do NOT upsert via supabase-js — use a `select` + `update | insert` two-step in a transaction, or call a SECURITY DEFINER RPC.
- Validate ON CONFLICT targets by inserting one of each row type during the migration test, not by reading the index definition.
