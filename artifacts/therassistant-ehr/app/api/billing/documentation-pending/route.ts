/**
 * GET /api/billing/documentation-pending
 *
 * "Documentation Pending" workqueue: appointments that cannot be
 * billed because the clinical documentation is missing or incomplete.
 *
 * Returns one row per appointment, pre-classified into one or more
 * tabs ("Unsigned Notes", "Draft Notes", "Missing Time",
 * "Missing Diagnosis", "Missing Treatment Plan", "Late Documentation").
 *
 * Rows that have been "held from billing" or "marked not billable"
 * via the action route are filtered out by default; pass
 * `status=hold` or `status=not_billable` to surface them.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function billingRisk(days: number | null): "low" | "medium" | "high" | "critical" {
  if (days == null) return "low";
  if (days >= 60) return "critical";
  if (days >= 30) return "high";
  if (days >= 14) return "medium";
  return "low";
}

function agingBucket(days: number | null): "0_30" | "31_60" | "61_90" | "90_plus" {
  const d = days ?? 0;
  if (d <= 30) return "0_30";
  if (d <= 60) return "31_60";
  if (d <= 90) return "61_90";
  return "90_plus";
}

export type DocPendingTab =
  | "unsigned_notes"
  | "draft_notes"
  | "missing_time"
  | "missing_diagnosis"
  | "missing_treatment_plan"
  | "late_documentation";

export type DocPendingRow = {
  id: string; // appointment id
  encounter_id: string | null;
  client_id: string | null;
  client_name: string;
  clinician_id: string | null;
  clinician_name: string;
  date_of_service: string | null; // ISO date
  appointment_type: string | null;
  scheduled_duration_minutes: number | null;
  note_status: string | null;
  days_since_appointment: number | null;
  missing_elements: string[];
  billing_risk: "low" | "medium" | "high" | "critical";
  reminder_sent_at: string | null;
  reminder_count: number;
  total_charge: number;
  tabs: DocPendingTab[];
  state: "open" | "hold" | "not_billable" | "supervisor_review";
  routed_to_clinician_id: string | null;
  payer_name: string | null;
  aging_bucket: string;
};

export type DocPendingSummary = {
  total_count: number;
  total_dollars: number;
  oldest_age_days: number | null;
  urgent_count: number;
  by_tab: Record<DocPendingTab, number>;
};

const ACTION_EVENT_PREFIX = "doc_pending_";

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    // ── Universal filter rail (server-side) ──────────────────────────
    const filterTab = (searchParams.get("tab") ?? "").trim() as
      | DocPendingTab
      | "";
    const filterClinician = (searchParams.get("clinician") ?? "").trim();
    const filterPayer = (searchParams.get("payer") ?? "").trim();
    const filterClient = (searchParams.get("client") ?? "").trim();
    const filterDosFrom = (searchParams.get("dosFrom") ?? "").trim();
    const filterDosTo = (searchParams.get("dosTo") ?? "").trim();
    const filterStatus = (searchParams.get("status") ?? "open").trim();
    const filterPriority = (searchParams.get("priority") ?? "").trim();
    const filterAgingBucket = (searchParams.get("agingBucket") ?? "").trim();
    const filterMinAmount = Number(searchParams.get("minAmount") ?? "");
    const filterMaxAmount = Number(searchParams.get("maxAmount") ?? "");

    // Look back 18 months — long enough to cover any timely-filing window.
    const lookbackFrom = new Date();
    lookbackFrom.setMonth(lookbackFrom.getMonth() - 18);

    const { data: apptRows, error: apptError } = await (supabase as any)
      .from("appointments")
      .select(
        "id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_type, appointment_status, archived_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .in("appointment_status", ["checked_in", "completed", "no_show", "scheduled"])
      .gte("scheduled_start_at", lookbackFrom.toISOString())
      .order("scheduled_start_at", { ascending: true });

    if (apptError) throw apptError;

    const appts = (apptRows ?? []) as DbRow[];
    if (appts.length === 0) {
      return NextResponse.json({
        success: true,
        organizationId,
        items: [],
        summary: emptySummary(),
      });
    }

    const apptIds = appts.map((a) => text(a.id)).filter(Boolean);
    const clientIds = [...new Set(appts.map((a) => text(a.client_id)).filter(Boolean))];
    const providerIds = [...new Set(appts.map((a) => text(a.provider_id)).filter(Boolean))];

    const [
      { data: encounters },
      { data: clients },
      { data: providers },
      { data: encounterNotes },
      { data: clinicalNotes },
      { data: claims },
      { data: payerProfiles },
      { data: treatmentPlans },
      { data: audit },
    ] = await Promise.all([
      supabase
        .from("encounters")
        .select(
          "id, appointment_id, client_id, provider_id, started_at, ended_at, soap_note, encounter_status, archived_at",
        )
        .eq("organization_id", organizationId)
        .in("appointment_id", apptIds),
      clientIds.length
        ? supabase.from("clients").select("id, first_name, last_name").in("id", clientIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      providerIds.length
        ? supabase
            .from("providers")
            .select("id, first_name, last_name, display_name")
            .in("id", providerIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      supabase
        .from("encounter_notes")
        .select(
          "id, encounter_id, note_status, signed_at, signed_by_provider_id, updated_at, note_body",
        )
        .eq("organization_id", organizationId),
      supabase
        .from("encounter_clinical_notes")
        .select("id, encounter_id, note_status, signed_at, updated_at, plan, assessment")
        .eq("organization_id", organizationId),
      (supabase as any)
        .from("professional_claims")
        .select(
          "id, appointment_id, encounter_id, total_charge, diagnosis_codes, payer_profile_id, claim_status",
        )
        .eq("organization_id", organizationId)
        .in("appointment_id", apptIds),
      (async () => {
        // Filled in after we know which payer ids we need.
        return { data: [] as DbRow[] };
      })(),
      clientIds.length
        ? (supabase as any)
            .from("treatment_plans")
            .select("id, client_id, plan_status, start_date, end_date")
            .eq("organization_id", organizationId)
            .in("client_id", clientIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      (supabase as any)
        .from("audit_logs")
        .select("appointment_id, event_type, event_metadata, created_at, user_id")
        .eq("organization_id", organizationId)
        .in("appointment_id", apptIds)
        .ilike("event_type", `${ACTION_EVENT_PREFIX}%`)
        .order("created_at", { ascending: true }),
    ]);

    // Second pass: load payer profiles referenced by claims.
    const payerIds = [
      ...new Set(
        ((claims ?? []) as DbRow[])
          .map((c) => text(c.payer_profile_id))
          .filter(Boolean),
      ),
    ];
    let payerRows: DbRow[] = [];
    if (payerIds.length > 0) {
      const { data: prows } = await (supabase as any)
        .from("payer_profiles")
        .select("id, payer_name")
        .in("id", payerIds);
      payerRows = (prows ?? []) as DbRow[];
    } else {
      payerRows = (payerProfiles ?? []) as DbRow[];
    }

    const clientById = new Map<string, DbRow>(
      ((clients ?? []) as DbRow[]).map((c) => [text(c.id), c]),
    );
    const providerById = new Map<string, DbRow>(
      ((providers ?? []) as DbRow[]).map((p) => [text(p.id), p]),
    );
    const payerById = new Map<string, DbRow>(payerRows.map((p) => [text(p.id), p]));

    const encByAppt = new Map<string, DbRow>();
    for (const e of ((encounters ?? []) as DbRow[])) {
      if (e.archived_at) continue;
      const key = text(e.appointment_id);
      if (!key) continue;
      // Prefer the most recently updated encounter per appointment.
      const prior = encByAppt.get(key);
      if (!prior) encByAppt.set(key, e);
    }

    const encNotesByEnc = new Map<string, DbRow>();
    for (const n of ((encounterNotes ?? []) as DbRow[])) {
      const key = text(n.encounter_id);
      if (!key) continue;
      const prior = encNotesByEnc.get(key);
      if (
        !prior ||
        new Date(text(n.updated_at)).getTime() >
          new Date(text(prior.updated_at)).getTime()
      ) {
        encNotesByEnc.set(key, n);
      }
    }
    const clinNotesByEnc = new Map<string, DbRow>();
    for (const n of ((clinicalNotes ?? []) as DbRow[])) {
      const key = text(n.encounter_id);
      if (!key) continue;
      const prior = clinNotesByEnc.get(key);
      if (
        !prior ||
        new Date(text(n.updated_at)).getTime() >
          new Date(text(prior.updated_at)).getTime()
      ) {
        clinNotesByEnc.set(key, n);
      }
    }

    const claimByAppt = new Map<string, DbRow>();
    for (const c of ((claims ?? []) as DbRow[])) {
      const key = text(c.appointment_id);
      if (!key) continue;
      const prior = claimByAppt.get(key);
      if (!prior) claimByAppt.set(key, c);
    }

    const today = new Date().toISOString().slice(0, 10);
    const activeTpByClient = new Set<string>();
    for (const tp of ((treatmentPlans ?? []) as DbRow[])) {
      const status = text(tp.plan_status).toLowerCase();
      const endDate = text(tp.end_date);
      if (status && status !== "active") continue;
      if (endDate && endDate < today) continue;
      const key = text(tp.client_id);
      if (key) activeTpByClient.add(key);
    }

    // Aggregate audit events per appointment.
    type AuditAgg = {
      reminder_sent_at: string | null;
      reminder_count: number;
      state: "open" | "hold" | "not_billable" | "supervisor_review";
      routed_to_clinician_id: string | null;
    };
    const auditByAppt = new Map<string, AuditAgg>();
    for (const a of ((audit ?? []) as DbRow[])) {
      const key = text(a.appointment_id);
      if (!key) continue;
      const cur = auditByAppt.get(key) ?? {
        reminder_sent_at: null,
        reminder_count: 0,
        state: "open" as const,
        routed_to_clinician_id: null,
      };
      const ev = text(a.event_type);
      const md = (a.event_metadata as Record<string, unknown> | null) ?? {};
      const created = text(a.created_at);
      switch (ev) {
        case `${ACTION_EVENT_PREFIX}send_reminder`:
          cur.reminder_count += 1;
          cur.reminder_sent_at = created;
          break;
        case `${ACTION_EVENT_PREFIX}route_to_clinician`:
          cur.routed_to_clinician_id =
            text((md as { target_provider_id?: unknown }).target_provider_id) || null;
          break;
        case `${ACTION_EVENT_PREFIX}hold`:
          cur.state = "hold";
          break;
        case `${ACTION_EVENT_PREFIX}unhold`:
          if (cur.state === "hold") cur.state = "open";
          break;
        case `${ACTION_EVENT_PREFIX}mark_not_billable`:
          cur.state = "not_billable";
          break;
        case `${ACTION_EVENT_PREFIX}supervisor_review`:
          cur.state = "supervisor_review";
          break;
      }
      auditByAppt.set(key, cur);
    }

    // Build rows + classify into tabs. We build two collections:
    //   - `allItems`: every classified row (regardless of filter rail)
    //     — used to compute the summary strip so it reflects the queue
    //     as a whole, not the current filter slice.
    //   - `items`: rows that pass the universal filter rail + active tab
    //     — this is what we return for rendering.
    const allItems: DocPendingRow[] = [];
    const items: DocPendingRow[] = [];
    for (const ap of appts) {
      const apptId = text(ap.id);
      const enc = encByAppt.get(apptId);
      const encId = enc ? text(enc.id) : null;
      const note = encId ? encNotesByEnc.get(encId) : undefined;
      const clinNote = encId ? clinNotesByEnc.get(encId) : undefined;

      const noteStatus = text(note?.note_status) || text(clinNote?.note_status) || null;
      const signed =
        Boolean(note?.signed_at) ||
        Boolean(clinNote?.signed_at) ||
        noteStatus === "signed";

      const claim = claimByAppt.get(apptId);
      const diagnosisCodes = (claim?.diagnosis_codes as string[] | null) ?? [];

      const startIso = text(ap.scheduled_start_at);
      const endIso = text(ap.scheduled_end_at);
      const startMs = startIso ? new Date(startIso).getTime() : NaN;
      const endMs = endIso ? new Date(endIso).getTime() : NaN;
      const durationMin =
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, Math.round((endMs - startMs) / 60_000))
          : null;
      const dos = startIso ? startIso.slice(0, 10) : null;
      const days = daysSince(startIso || null);

      // Skip future appointments — nothing to document yet.
      if (Number.isFinite(startMs) && startMs > Date.now()) continue;

      // Tab classification.
      const tabs: DocPendingTab[] = [];
      if (enc && !signed) tabs.push("unsigned_notes");
      if (
        noteStatus === "in_progress" ||
        noteStatus === "not_started" ||
        noteStatus === "draft"
      ) {
        tabs.push("draft_notes");
      }
      if (enc && (!enc.started_at || !enc.ended_at)) tabs.push("missing_time");
      if (!signed && diagnosisCodes.length === 0) tabs.push("missing_diagnosis");
      const clientId = text(ap.client_id);
      if (clientId && !activeTpByClient.has(clientId)) {
        tabs.push("missing_treatment_plan");
      }
      if (!signed && (days ?? 0) > 7) tabs.push("late_documentation");

      // If nothing is missing, skip this appointment entirely.
      if (tabs.length === 0) continue;

      const missingElements: string[] = [];
      if (!enc) missingElements.push("Encounter not opened");
      if (enc && (!enc.started_at || !enc.ended_at)) missingElements.push("Session time");
      if (!noteStatus) missingElements.push("Progress note");
      else if (!signed) missingElements.push(`Signature (${noteStatus})`);
      if (diagnosisCodes.length === 0) missingElements.push("Diagnosis");
      if (clientId && !activeTpByClient.has(clientId)) {
        missingElements.push("Active treatment plan");
      }

      const client = clientById.get(clientId);
      const clientName = client
        ? [client.first_name, client.last_name].map(text).filter(Boolean).join(" ") ||
          "Unknown client"
        : "Unknown client";

      const provId = text(ap.provider_id);
      const provider = provId ? providerById.get(provId) : undefined;
      const providerName = provider
        ? text(provider.display_name) ||
          [provider.first_name, provider.last_name].map(text).filter(Boolean).join(" ") ||
          "Unknown clinician"
        : "Unassigned";

      const aggregate = auditByAppt.get(apptId) ?? {
        reminder_sent_at: null,
        reminder_count: 0,
        state: "open" as const,
        routed_to_clinician_id: null,
      };

      const payer = claim ? payerById.get(text(claim.payer_profile_id)) : undefined;

      const row: DocPendingRow = {
        id: apptId,
        encounter_id: encId,
        client_id: clientId || null,
        client_name: clientName,
        clinician_id: provId || null,
        clinician_name: providerName,
        date_of_service: dos,
        appointment_type: text(ap.appointment_type) || null,
        scheduled_duration_minutes: durationMin,
        note_status: noteStatus,
        days_since_appointment: days,
        missing_elements: missingElements,
        billing_risk: billingRisk(days),
        reminder_sent_at: aggregate.reminder_sent_at,
        reminder_count: aggregate.reminder_count,
        total_charge: claim ? money(claim.total_charge) : 0,
        tabs,
        state: aggregate.state,
        routed_to_clinician_id: aggregate.routed_to_clinician_id,
        payer_name: payer ? text(payer.payer_name) || null : null,
        aging_bucket: agingBucket(days),
      };
      allItems.push(row);

      // Apply universal filter rail server-side.
      if (filterTab && !row.tabs.includes(filterTab)) continue;
      if (row.state !== filterStatus) continue;
      if (filterClinician && row.clinician_id !== filterClinician) continue;
      if (filterPayer && row.payer_name !== filterPayer) continue;
      if (filterClient && row.client_id !== filterClient) continue;
      if (filterPriority && row.billing_risk !== filterPriority) continue;
      if (filterAgingBucket && row.aging_bucket !== filterAgingBucket) continue;
      if (filterDosFrom && (row.date_of_service ?? "") < filterDosFrom) continue;
      if (filterDosTo && (row.date_of_service ?? "") > filterDosTo) continue;
      if (Number.isFinite(filterMinAmount) && row.total_charge < filterMinAmount) continue;
      if (Number.isFinite(filterMaxAmount) && row.total_charge > filterMaxAmount) continue;

      items.push(row);
    }

    // Summary across the entire queue (open state, unfiltered) so the
    // header strip reflects the queue as a whole — not the user's
    // current slice.
    const openItems = allItems.filter((i) => i.state === "open");
    const summary: DocPendingSummary = {
      total_count: openItems.length,
      total_dollars: Math.round(
        openItems.reduce((sum, i) => sum + (i.total_charge || 0), 0) * 100,
      ) / 100,
      oldest_age_days: openItems.reduce<number | null>((max, i) => {
        if (i.days_since_appointment == null) return max;
        if (max == null) return i.days_since_appointment;
        return Math.max(max, i.days_since_appointment);
      }, null),
      urgent_count: openItems.filter(
        (i) => i.billing_risk === "critical" || i.billing_risk === "high",
      ).length,
      by_tab: {
        unsigned_notes: 0,
        draft_notes: 0,
        missing_time: 0,
        missing_diagnosis: 0,
        missing_treatment_plan: 0,
        late_documentation: 0,
      },
    };
    for (const i of openItems) {
      for (const t of i.tabs) summary.by_tab[t] += 1;
    }

    return NextResponse.json({ success: true, organizationId, items, summary });
  } catch (error) {
    console.error("Documentation Pending API error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load documentation-pending worklist",
      },
      { status: 500 },
    );
  }
}

function emptySummary(): DocPendingSummary {
  return {
    total_count: 0,
    total_dollars: 0,
    oldest_age_days: null,
    urgent_count: 0,
    by_tab: {
      unsigned_notes: 0,
      draft_notes: 0,
      missing_time: 0,
      missing_diagnosis: 0,
      missing_treatment_plan: 0,
      late_documentation: 0,
    },
  };
}
