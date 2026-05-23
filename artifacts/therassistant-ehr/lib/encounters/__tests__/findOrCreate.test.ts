/**
 * Regression: two near-simultaneous "Check In" clicks must NOT produce a
 * duplicate encounter or duplicate clinical note for the same appointment.
 *
 * The DB partial unique indexes
 *   encounters(organization_id, appointment_id) where archived_at is null
 *   encounter_clinical_notes(organization_id, encounter_id) where archived_at is null
 * close the race; findOrCreateEncounter / findOrCreateNote catch the
 * resulting 23505 and re-select the winning row. This suite simulates the
 * race against a fake supabase that mimics the partial unique index.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  findOrCreateEncounter,
  findOrCreateNote,
  UNIQUE_VIOLATION,
  type EncountersSupabase,
} from "../findOrCreate";
import { validateInsert } from "../../supabase/__tests__/schemaGuard";

function asSupabase(fake: unknown): EncountersSupabase {
  return fake as EncountersSupabase;
}

const ORG = "org-1";
const APPT = "appt-1";
const APPT_FIXTURE = {
  client_id: "client-1",
  provider_id: "provider-1",
  scheduled_start_at: "2026-05-23T15:00:00.000Z",
  scheduled_end_at: "2026-05-23T16:00:00.000Z",
};

type EncRow = {
  id: string;
  organization_id: string;
  appointment_id: string;
  client_id: string | null;
  provider_id: string | null;
  archived_at: string | null;
};
type NoteRow = {
  id: string;
  organization_id: string;
  encounter_id: string;
  archived_at: string | null;
};

/**
 * Minimal fake supabase that enforces the same partial unique indexes the
 * real DB does. Inserts that would violate the index resolve with a
 * Postgres-style { code: "23505" } error, mirroring supabase-js behavior.
 *
 * `gate` is awaited inside `.maybeSingle()` and `.single()` so a test can
 * interleave operations from two concurrent callers (the classic race:
 * both SELECT, both miss, both INSERT, second one 23505s).
 */
function makeFakeDb(opts: { gate?: () => Promise<void> } = {}) {
  const encounters: EncRow[] = [];
  const notes: NoteRow[] = [];
  let nextEnc = 0;
  let nextNote = 0;
  const gate = opts.gate ?? (async () => {});

  const supabase = {
    from(table: "encounters" | "encounter_clinical_notes") {
      const isEnc = table === "encounters";
      return {
        select() {
          let orgId = "";
          let keyField = "";
          let keyValue = "";
          return {
            eq(_f: string, v: unknown) {
              orgId = String(v);
              return {
                eq(f2: string, v2: unknown) {
                  keyField = String(f2);
                  keyValue = String(v2);
                  return {
                    is(_f3: string, _v3: unknown) {
                      return {
                        limit() {
                          return {
                            async maybeSingle() {
                              await gate();
                              const rows = isEnc
                                ? encounters.filter(
                                    (r) =>
                                      r.organization_id === orgId &&
                                      r[keyField as "appointment_id"] === keyValue &&
                                      r.archived_at === null,
                                  )
                                : notes.filter(
                                    (r) =>
                                      r.organization_id === orgId &&
                                      r[keyField as "encounter_id"] === keyValue &&
                                      r.archived_at === null,
                                  );
                              return { data: rows[0] ?? null, error: null };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          validateInsert(table, row);
          return {
            select() {
              return {
                async single() {
                  await gate();
                  if (isEnc) {
                    const dup = encounters.find(
                      (r) =>
                        r.organization_id === row.organization_id &&
                        r.appointment_id === row.appointment_id &&
                        r.archived_at === null,
                    );
                    if (dup) {
                      return { data: null, error: { message: "duplicate key", code: UNIQUE_VIOLATION } };
                    }
                    const id = `enc-${++nextEnc}`;
                    const inserted: EncRow = {
                      id,
                      organization_id: String(row.organization_id),
                      appointment_id: String(row.appointment_id),
                      client_id: (row.client_id as string | null) ?? null,
                      provider_id: (row.provider_id as string | null) ?? null,
                      archived_at: null,
                    };
                    encounters.push(inserted);
                    return { data: inserted, error: null };
                  }
                  const dup = notes.find(
                    (r) =>
                      r.organization_id === row.organization_id &&
                      r.encounter_id === row.encounter_id &&
                      r.archived_at === null,
                  );
                  if (dup) {
                    return { data: null, error: { message: "duplicate key", code: UNIQUE_VIOLATION } };
                  }
                  const id = `note-${++nextNote}`;
                  const inserted: NoteRow = {
                    id,
                    organization_id: String(row.organization_id),
                    encounter_id: String(row.encounter_id),
                    archived_at: null,
                  };
                  notes.push(inserted);
                  return { data: inserted, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  return { supabase, encounters, notes };
}

test("findOrCreateEncounter: two concurrent calls produce a single encounter", async () => {
  // Gate every supabase call so both callers reach their SELECT before
  // either reaches its INSERT — the exact double-click interleaving.
  let pending: Array<() => void> = [];
  const allWaiters: Array<Promise<void>> = [];
  const gate = () => {
    const p = new Promise<void>((resolve) => pending.push(resolve));
    allWaiters.push(p);
    return p;
  };
  const releaseAll = async () => {
    while (pending.length || allWaiters.length) {
      const toRelease = pending;
      pending = [];
      toRelease.forEach((r) => r());
      // Yield so newly-issued ops can register their waiters.
      await new Promise((r) => setImmediate(r));
      // Drop the resolved ones from allWaiters by replacing with a fresh batch.
      if (pending.length === 0) break;
    }
  };

  const { supabase, encounters } = makeFakeDb({ gate });
  const now = "2026-05-23T15:00:00.000Z";

  const p1 = findOrCreateEncounter(asSupabase(supabase), ORG, APPT, APPT_FIXTURE, now);
  const p2 = findOrCreateEncounter(asSupabase(supabase), ORG, APPT, APPT_FIXTURE, now);

  // Repeatedly release pending awaits until both promises settle.
  let settled = false;
  const done = Promise.all([p1, p2]).then((r) => {
    settled = true;
    return r;
  });
  while (!settled) {
    await new Promise((r) => setImmediate(r));
    const toRelease = pending;
    pending = [];
    toRelease.forEach((r) => r());
  }
  await releaseAll();
  const [r1, r2] = await done;

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.encounterId, r2.encounterId, "both callers must converge on the same encounter id");
  assert.equal(encounters.length, 1, "exactly one encounter row in the DB");
  // Exactly one caller observed the insert as 'created'; the loser re-selected.
  assert.equal([r1.created, r2.created].filter(Boolean).length, 1);
});

test("findOrCreateNote: two concurrent calls produce a single note", async () => {
  let pending: Array<() => void> = [];
  const gate = () => new Promise<void>((resolve) => pending.push(resolve));

  const { supabase, notes } = makeFakeDb({ gate });
  const now = "2026-05-23T15:00:00.000Z";

  const p1 = findOrCreateNote(asSupabase(supabase), ORG, "enc-x", "client-1", "provider-1", now);
  const p2 = findOrCreateNote(asSupabase(supabase), ORG, "enc-x", "client-1", "provider-1", now);

  let settled = false;
  const done = Promise.all([p1, p2]).then((r) => {
    settled = true;
    return r;
  });
  while (!settled) {
    await new Promise((r) => setImmediate(r));
    const toRelease = pending;
    pending = [];
    toRelease.forEach((r) => r());
  }
  const [r1, r2] = await done;

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.noteId, r2.noteId, "both callers must converge on the same note id");
  assert.equal(notes.length, 1, "exactly one clinical note row in the DB");
  assert.equal([r1.created, r2.created].filter(Boolean).length, 1);
});

test("findOrCreateEncounter: serial second call returns the existing row (no insert)", async () => {
  const { supabase, encounters } = makeFakeDb();
  const now = "2026-05-23T15:00:00.000Z";

  const r1 = await findOrCreateEncounter(asSupabase(supabase), ORG, APPT, APPT_FIXTURE, now);
  const r2 = await findOrCreateEncounter(asSupabase(supabase), ORG, APPT, APPT_FIXTURE, now);

  assert.equal(r1.ok && r2.ok, true);
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.encounterId, r2.encounterId);
  assert.equal(r1.created, true);
  assert.equal(r2.created, false);
  assert.equal(encounters.length, 1);
});

test("regression: migration adds partial unique index on encounters(org, appointment) where archived_at is null", () => {
  const sql = readFileSync(
    "supabase/migrations/20260529000000_encounters_appointment_dedupe_unique.sql",
    "utf8",
  );
  assert.match(sql, /create unique index[\s\S]*encounters[\s\S]*organization_id[\s\S]*appointment_id/i);
  assert.match(sql, /where\s+archived_at\s+is\s+null/i);
});

test("regression: check-in route delegates to the shared find-or-create helper", () => {
  const src = readFileSync(
    "app/api/check-ins/appointment/start-note/route.ts",
    "utf8",
  );
  assert.match(src, /findOrCreateEncounter/);
  assert.match(src, /findOrCreateNote/);
});

test("regression: create-from-appointment route delegates to the shared find-or-create helper", () => {
  const src = readFileSync(
    "app/api/encounters/create-from-appointment/route.ts",
    "utf8",
  );
  assert.match(src, /findOrCreateEncounter/);
});
