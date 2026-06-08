---
name: Shared schemaGuard for fake supabase clients
description: Where the in-test schema guard lives, how to wire it into hand-rolled fakes, and the hand-maintained overlays that paper over a stale generated types file.
---

The schema guard for in-memory supabase fakes lives at `lib/supabase/__tests__/schemaGuard.ts`. Wire it into any hand-rolled fake's `insert` / `update` / `upsert` path with `validateInsert` / `validateWritePayload`.

**Why:** Without it, fakes silently accept payloads with wrong column names or invalid enum values that production then rejects.

**How to apply:**
- Read-only fakes (no `.insert/.update/.upsert`) don't need wiring.
- When the guard fires in a test, first check whether the offending column/enum value has a migration. If yes, extend the `EXTRA_COLUMNS` / `EXTRA_ENUM_VALUES` overlay so the test sees the real shape — do not mass-regenerate types from a partial DB.
- If there is no migration adding the column/value but production code writes it, still add it to the overlay so tests pass, and flag it as a separate production bug (the DB will reject the write at runtime). Examples we've already hit: `professional_claims.patient_responsibility_amount` and `encounters.encounter_status='draft'`.
