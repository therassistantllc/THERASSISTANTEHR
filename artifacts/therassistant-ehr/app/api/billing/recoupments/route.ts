/**
 * GET /api/billing/recoupments
 *
 * "Recoupments / Takebacks" workqueue. Each row is a payment_recoupments
 * record. Tab/state is derived from:
 *
 *   - the recoupment row itself (offset_era_claim_payment_id, archived)
 *   - a `recoupment_*` audit overlay (dispute / accept / pending review /
 *     refund_due / offset) keyed off audit_logs.object_id = recoupment.id
 *   - any payment_refunds row that points at the same source payment
 *
 * Tabs:
 *   - new_recoupments       Just received, no biller action yet.
 *   - pending_review        Routed for review.
 *   - disputed              Biller has opened a dispute.
 *   - accepted              Adjustment accepted as-is.
 *   - offset                Netted against a subsequent ERA payment.
 *   - refund_due            Practice must cut a refund check to the payer.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86_400_000);
}

function agingBucket(days: number | null): "0_30" | "31_60" | "61_90" | "90_plus" {
  const d = days ?? 0;
  if (d <= 30) return "0_30";
  if (d <= 60) return "31_60";
  if (d <= 90) return "61_90";
  return "90_plus";
}

export type RecoupmentTab =
  | "new_recoupments"
  | "pending_review"
  | "disputed"
  | "accepted"
  | "offset"
  | "refund_due";

export type RecoupmentState =
  | "new"
  | "pending_review"
  | "disputed"
  | "accepted"
  | "offset"
  | "refund_due";

export interface RecoupmentRow {
  id: string;
  recoupment_id: string;
  client_id: string | null;
  client_name: string;
  claim_id: string | null;
  claim_number: string;
  payer_profile_id: string | null;
  payer_name: string;
  original_payment_date: string | null;
  original_paid_amount: number;
  recoupment_amount: number;
  reason_code: string | null;
  reason: string;
  notice_date: string | null;
  deadline_date: string | null;
  status: string;
  state: RecoupmentState;
  tabs: RecoupmentTab[];
  // Detail-panel hydration
  source_era_claim_payment_id: string | null;
  source_client_payment_id: string | null;
  offset_era_claim_payment_id: string | null;
  era_import_batch_id: string | null;
  // Filter/summary helpers
  days_since_notice: number | null;
  days_to_deadline: number | null;
  aging_bucket: string;
  priority: "low" | "medium" | "high" | "critical";
  carc_codes: string[];
  rarc_codes: string[];
  refund_id: string | null;
  refund_status: string | null;
  clinician_id: string | null;
  practice_id: string | null;
  practice_name: string | null;
  service_date: string | null;
}

export interface RecoupmentSummary {
  total_count: number;
  total_dollars: number;
  oldest_age_days: number | null;
  urgent_count: number;
  by_tab: Record<RecoupmentTab, number>;
}

const ACTION_EVENT_PREFIX = "recoupment_";

function emptySummary(): RecoupmentSummary {
  return {
    total_count: 0,
    total_dollars: 0,
    oldest_age_days: null,
    urgent_count: 0,
    by_tab: {
      new_recoupments: 0,
      pending_review: 0,
      disputed: 0,
      accepted: 0,
      offset: 0,
      refund_due: 0,
    },
  };
}

function stateLabel(s: RecoupmentState): string {
  switch (s) {
    case "new": return "New";
    case "pending_review": return "Pending review";
    case "disputed": return "Disputed";
    case "accepted": return "Accepted";
    case "offset": return "Offset applied";
    case "refund_due": return "Refund due";
  }
}

function priorityFor(daysSinceNotice: number | null, daysToDeadline: number | null, amount: number): "low" | "medium" | "high" | "critical" {
  if (daysToDeadline != null && daysToDeadline < 0) return "critical";
  if (daysToDeadline != null && daysToDeadline <= 7) return "high";
  if (amount >= 5000) return "high";
  if ((daysSinceNotice ?? 0) >= 30) return "medium";
  if (amount >= 1000) return "medium";
  return "low";
}

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

    const filterTab = (searchParams.get("tab") ?? "").trim() as RecoupmentTab | "";
    const filterPayer = (searchParams.get("payer") ?? "").trim();
    const filterClient = (searchParams.get("client") ?? "").trim();
    const filterClinician = (searchParams.get("clinician") ?? "").trim();
    const filterPractice = (searchParams.get("practice") ?? "").trim();
    const filterAssigned = (searchParams.get("assigned") ?? "").trim();
    const filterDosFrom = (searchParams.get("dosFrom") ?? "").trim();
    const filterDosTo = (searchParams.get("dosTo") ?? "").trim();
    const filterStatus = (searchParams.get("status") ?? "").trim();
    const filterPriority = (searchParams.get("priority") ?? "").trim();
    const filterAgingBucket = (searchParams.get("agingBucket") ?? "").trim();
    const filterCarc = (searchParams.get("carc") ?? "").trim();
    const filterRarc = (searchParams.get("rarc") ?? "").trim();
    const filterFollowUp = (searchParams.get("followUpDue") ?? "").trim();
    const filterMinAmount = Number(searchParams.get("minAmount") ?? "");
    const filterMaxAmount = Number(searchParams.get("maxAmount") ?? "");

    // ── 1. Pull recoupments (lookback 18 months) ──────────────────────
    const lookbackFrom = new Date();
    lookbackFrom.setMonth(lookbackFrom.getMonth() - 18);

    const { data: recoupRows, error: recoupErr } = await (supabase as any)
      .from("payment_recoupments")
      .select(
        "id, organization_id, source_era_claim_payment_id, source_client_payment_id, offset_era_claim_payment_id, professional_claim_id, client_id, payer_profile_id, amount, reason_code, reason, workqueue_item_id, recouped_at, recouped_by_actor_id, created_at, archived_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .gte("recouped_at", lookbackFrom.toISOString())
      .order("recouped_at", { ascending: false })
      .limit(2000);
    if (recoupErr) throw recoupErr;

    const recoupments = (recoupRows ?? []) as DbRow[];
    if (recoupments.length === 0) {
      return NextResponse.json({
        success: true,
        organizationId,
        items: [],
        summary: emptySummary(),
      });
    }

    const recoupIds = recoupments.map((r) => text(r.id)).filter(Boolean);
    const eraPaymentIds = [
      ...new Set(
        recoupments.map((r) => text(r.source_era_claim_payment_id)).filter(Boolean),
      ),
    ];
    const clientPaymentIds = [
      ...new Set(
        recoupments.map((r) => text(r.source_client_payment_id)).filter(Boolean),
      ),
    ];
    const claimIds = [
      ...new Set(
        recoupments.map((r) => text(r.professional_claim_id)).filter(Boolean),
      ),
    ];
    const clientIds = [
      ...new Set(recoupments.map((r) => text(r.client_id)).filter(Boolean)),
    ];
    const payerIds = [
      ...new Set(
        recoupments.map((r) => text(r.payer_profile_id)).filter(Boolean),
      ),
    ];

    // ── 2. Hydrate joined data in parallel ────────────────────────────
    const [
      { data: eraPayments },
      { data: clientPayments },
      { data: claims },
      { data: appts },
      { data: clients },
      { data: payerProfiles },
      { data: audit },
      { data: refunds },
      { data: snapshots },
    ] = await Promise.all([
      eraPaymentIds.length
        ? (supabase as any)
            .from("era_claim_payments")
            .select(
              "id, era_import_batch_id, professional_claim_id, clp01_claim_control_number, clp04_payment_amount, clp05_patient_responsibility, allowed_amount, check_eft_number, check_issue_date, carc_codes, rarc_codes, posting_status, created_at",
            )
            .eq("organization_id", organizationId)
            .in("id", eraPaymentIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      clientPaymentIds.length
        ? (supabase as any)
            .from("client_payments")
            .select("id, amount, posted_at, created_at, posting_status")
            .eq("organization_id", organizationId)
            .in("id", clientPaymentIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      claimIds.length
        ? (supabase as any)
            .from("professional_claims")
            .select(
              "id, claim_number, patient_id, appointment_id, payer_profile_id, claim_status, total_charge",
            )
            .eq("organization_id", organizationId)
            .in("id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      Promise.resolve({ data: [] as DbRow[] }), // appts placeholder
      clientIds.length
        ? (supabase as any)
            .from("clients")
            .select("id, first_name, last_name")
            .in("id", clientIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      payerIds.length
        ? (supabase as any)
            .from("payer_profiles")
            .select("id, payer_name, payer_type")
            .eq("organization_id", organizationId)
            .in("id", payerIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      (supabase as any)
        .from("audit_logs")
        .select(
          "object_id, event_type, event_summary, event_metadata, created_at, user_id",
        )
        .eq("organization_id", organizationId)
        .in("object_id", recoupIds)
        .ilike("event_type", `${ACTION_EVENT_PREFIX}%`)
        .order("created_at", { ascending: true }),
      eraPaymentIds.length || clientPaymentIds.length
        ? (supabase as any)
            .from("payment_refunds")
            .select(
              "id, source_era_claim_payment_id, source_client_payment_id, refund_status, amount, requested_at, archived_at",
            )
            .eq("organization_id", organizationId)
            .is("archived_at", null)
            .or(
              [
                eraPaymentIds.length
                  ? `source_era_claim_payment_id.in.(${eraPaymentIds.join(",")})`
                  : null,
                clientPaymentIds.length
                  ? `source_client_payment_id.in.(${clientPaymentIds.join(",")})`
                  : null,
              ]
                .filter(Boolean)
                .join(","),
            )
        : Promise.resolve({ data: [] as DbRow[] }),
      claimIds.length
        ? (supabase as any)
            .from("claim_parties_snapshot")
            .select("claim_id, billing_provider_name, billing_provider_npi")
            .in("claim_id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);

    // Pull appointments for the claims we collected (for DOS).
    const apptIds = [
      ...new Set(
        ((claims ?? []) as DbRow[])
          .map((c) => text(c.appointment_id))
          .filter(Boolean),
      ),
    ];
    const { data: apptRows } = apptIds.length
      ? await (supabase as any)
          .from("appointments")
          .select("id, scheduled_start_at, provider_id")
          .in("id", apptIds)
      : { data: [] as DbRow[] };

    // ── 3. Lookup maps ───────────────────────────────────────────────
    const eraById = new Map<string, DbRow>(
      ((eraPayments ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const clientPaymentById = new Map<string, DbRow>(
      ((clientPayments ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const claimById = new Map<string, DbRow>(
      ((claims ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const clientById = new Map<string, DbRow>(
      ((clients ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const payerById = new Map<string, DbRow>(
      ((payerProfiles ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const apptById = new Map<string, DbRow>(
      ((apptRows ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const snapshotByClaim = new Map<string, DbRow>(
      ((snapshots ?? []) as DbRow[]).map((s) => [text(s.claim_id), s]),
    );
    void appts; // suppress lint

    const refundsBySource = new Map<string, DbRow>();
    for (const r of ((refunds ?? []) as DbRow[])) {
      const k = text(r.source_era_claim_payment_id) || text(r.source_client_payment_id);
      if (k && !refundsBySource.has(k)) refundsBySource.set(k, r);
    }

    type AuditAgg = {
      state: RecoupmentState | null;
      last_action_at: string | null;
      deadline_override: string | null;
      assigned_to: string | null;
    };
    const auditByRec = new Map<string, AuditAgg>();
    for (const a of ((audit ?? []) as DbRow[])) {
      const k = text(a.object_id);
      if (!k) continue;
      const cur = auditByRec.get(k) ?? {
        state: null as RecoupmentState | null,
        last_action_at: null as string | null,
        deadline_override: null as string | null,
        assigned_to: null as string | null,
      };
      const ev = text(a.event_type);
      const md = (a.event_metadata as Record<string, unknown> | null) ?? {};
      cur.last_action_at = text(a.created_at);
      switch (ev) {
        case `${ACTION_EVENT_PREFIX}dispute`:
          cur.state = "disputed";
          if (typeof md.deadline === "string") cur.deadline_override = md.deadline;
          break;
        case `${ACTION_EVENT_PREFIX}accept`:
          cur.state = "accepted";
          break;
        case `${ACTION_EVENT_PREFIX}pending_review`:
          cur.state = "pending_review";
          if (typeof md.assigned_to === "string") cur.assigned_to = md.assigned_to;
          break;
        case `${ACTION_EVENT_PREFIX}apply_offset`:
          cur.state = "offset";
          break;
        case `${ACTION_EVENT_PREFIX}mark_refund_due`:
          cur.state = "refund_due";
          break;
        case `${ACTION_EVENT_PREFIX}create_refund`:
          cur.state = "refund_due";
          break;
        case `${ACTION_EVENT_PREFIX}reopen`:
          cur.state = null;
          break;
        case `${ACTION_EVENT_PREFIX}add_note`:
          // note-only — does not change state
          break;
      }
      auditByRec.set(k, cur);
    }

    // ── 4. Build rows ────────────────────────────────────────────────
    const allItems: RecoupmentRow[] = [];
    const items: RecoupmentRow[] = [];

    for (const rec of recoupments) {
      const recId = text(rec.id);
      const eraId = text(rec.source_era_claim_payment_id) || null;
      const cpId = text(rec.source_client_payment_id) || null;
      const offsetId = text(rec.offset_era_claim_payment_id) || null;
      const claimId = text(rec.professional_claim_id) || null;
      const clientId = text(rec.client_id) || null;
      const payerId = text(rec.payer_profile_id) || null;

      const era = eraId ? eraById.get(eraId) : undefined;
      const cp = cpId ? clientPaymentById.get(cpId) : undefined;
      const claim = claimId ? claimById.get(claimId) : undefined;
      const payer = payerId ? payerById.get(payerId) : undefined;
      const client = clientId ? clientById.get(clientId) : undefined;
      const apptId = claim ? text(claim.appointment_id) : "";
      const appt = apptId ? apptById.get(apptId) : undefined;
      const clinicianId = appt ? (text(appt.provider_id) || null) : null;
      const serviceDate = appt
        ? (text(appt.scheduled_start_at)?.slice(0, 10) || null)
        : null;
      const snapshot = claimId ? snapshotByClaim.get(claimId) : undefined;
      const practiceId = snapshot
        ? (text(snapshot.billing_provider_npi) || null)
        : null;
      const practiceName = snapshot
        ? (text(snapshot.billing_provider_name) || null)
        : null;

      const sourceKey = eraId || cpId || "";
      const refund = sourceKey ? refundsBySource.get(sourceKey) : undefined;

      const audit = auditByRec.get(recId);

      // Derive state.
      let state: RecoupmentState = "new";
      if (audit?.state) {
        state = audit.state;
      } else if (offsetId) {
        state = "offset";
      } else if (refund && text(refund.refund_status) !== "cancelled") {
        state = "refund_due";
      }

      const tabs: RecoupmentTab[] = [];
      switch (state) {
        case "new": tabs.push("new_recoupments"); break;
        case "pending_review": tabs.push("pending_review"); break;
        case "disputed": tabs.push("disputed"); break;
        case "accepted": tabs.push("accepted"); break;
        case "offset": tabs.push("offset"); break;
        case "refund_due": tabs.push("refund_due"); break;
      }

      // Original payment date and amount.
      const originalPaymentDate = era
        ? (text(era.check_issue_date) || text(era.created_at)?.slice(0, 10) || null)
        : cp
        ? (text(cp.posted_at)?.slice(0, 10) || text(cp.created_at)?.slice(0, 10) || null)
        : null;
      const originalPaidAmount = era
        ? money(era.clp04_payment_amount)
        : cp
        ? money(cp.amount)
        : 0;

      // Claim number — prefer joined professional_claim, fall back to ERA CLP01.
      const claimNumber =
        (claim ? text(claim.claim_number) : "") ||
        (era ? text(era.clp01_claim_control_number) : "") ||
        (claimId ? claimId.slice(0, 8) : "—");

      const payerName =
        (payer ? text(payer.payer_name) : "") ||
        (claim
          ? text(payerById.get(text(claim.payer_profile_id))?.payer_name) || ""
          : "") ||
        "Unknown payer";

      const clientName = client
        ? [client.first_name, client.last_name]
            .map(text)
            .filter(Boolean)
            .join(" ") || "Unknown client"
        : "Unknown client";

      const noticeDate =
        text(rec.recouped_at)?.slice(0, 10) ||
        text(rec.created_at)?.slice(0, 10) ||
        null;

      // Deadline: 30 days from notice (industry default), or overridden by
      // a dispute action (e.g. payer-specified dispute window).
      let deadlineDate = audit?.deadline_override ?? null;
      if (!deadlineDate && noticeDate) {
        const d = new Date(noticeDate);
        if (!Number.isNaN(d.getTime())) {
          d.setDate(d.getDate() + 30);
          deadlineDate = d.toISOString().slice(0, 10);
        }
      }

      const daysSinceNotice = daysSince(noticeDate);
      const daysToDeadline = daysUntil(deadlineDate);
      const amount = money(rec.amount);

      const carc: string[] = era && Array.isArray(era.carc_codes)
        ? (era.carc_codes as unknown[]).map((x) => String(x))
        : [];
      const rarc: string[] = era && Array.isArray(era.rarc_codes)
        ? (era.rarc_codes as unknown[]).map((x) => String(x))
        : [];

      const row: RecoupmentRow = {
        id: recId,
        recoupment_id: recId,
        client_id: clientId,
        client_name: clientName,
        claim_id: claimId,
        claim_number: claimNumber,
        payer_profile_id: payerId,
        payer_name: payerName,
        original_payment_date: originalPaymentDate,
        original_paid_amount: originalPaidAmount,
        recoupment_amount: amount,
        reason_code: text(rec.reason_code) || null,
        reason: text(rec.reason) || "—",
        notice_date: noticeDate,
        deadline_date: deadlineDate,
        status: stateLabel(state),
        state,
        tabs,
        source_era_claim_payment_id: eraId,
        source_client_payment_id: cpId,
        offset_era_claim_payment_id: offsetId,
        era_import_batch_id: era ? text(era.era_import_batch_id) || null : null,
        days_since_notice: daysSinceNotice,
        days_to_deadline: daysToDeadline,
        aging_bucket: agingBucket(daysSinceNotice),
        priority: priorityFor(daysSinceNotice, daysToDeadline, amount),
        carc_codes: carc,
        rarc_codes: rarc,
        refund_id: refund ? text(refund.id) || null : null,
        refund_status: refund ? text(refund.refund_status) || null : null,
        clinician_id: clinicianId,
        practice_id: practiceId,
        practice_name: practiceName,
        service_date: serviceDate,
      };
      void apptById;

      allItems.push(row);

      // Filter rail
      if (filterTab && !row.tabs.includes(filterTab)) continue;
      if (filterStatus && row.state !== filterStatus) continue;
      if (filterPayer && row.payer_name !== filterPayer) continue;
      if (filterClient && row.client_id !== filterClient) continue;
      if (filterClinician && row.clinician_id !== filterClinician) continue;
      if (filterPractice && row.practice_id !== filterPractice) continue;
      if (filterPriority && row.priority !== filterPriority) continue;
      if (filterAgingBucket && row.aging_bucket !== filterAgingBucket) continue;
      if (filterDosFrom && (row.service_date ?? "") < filterDosFrom) continue;
      if (filterDosTo && (row.service_date ?? "") > filterDosTo) continue;
      if (Number.isFinite(filterMinAmount) && row.recoupment_amount < filterMinAmount) continue;
      if (Number.isFinite(filterMaxAmount) && row.recoupment_amount > filterMaxAmount) continue;
      if (filterCarc && !row.carc_codes.includes(filterCarc)) continue;
      if (filterRarc && !row.rarc_codes.includes(filterRarc)) continue;
      if (filterFollowUp) {
        // followUpDue=YYYY-MM-DD → only rows whose deadline is <= that date.
        if (!row.deadline_date || row.deadline_date > filterFollowUp) continue;
      }
      if (filterAssigned) {
        // Assigned biller is tracked via the pending_review audit metadata.
        const a = auditByRec.get(row.id);
        if (a?.assigned_to !== filterAssigned) continue;
      }

      items.push(row);
    }

    // ── 5. Summary across the whole queue ────────────────────────────
    const summary: RecoupmentSummary = emptySummary();
    summary.total_count = allItems.length;
    summary.total_dollars =
      Math.round(
        allItems.reduce((s, i) => s + (i.recoupment_amount || 0), 0) * 100,
      ) / 100;
    summary.oldest_age_days = allItems.reduce<number | null>((max, i) => {
      if (i.days_since_notice == null) return max;
      if (max == null) return i.days_since_notice;
      return Math.max(max, i.days_since_notice);
    }, null);
    summary.urgent_count = allItems.filter(
      (i) => i.priority === "critical" || i.priority === "high",
    ).length;
    for (const i of allItems) {
      for (const t of i.tabs) summary.by_tab[t] += 1;
    }

    return NextResponse.json({ success: true, organizationId, items, summary });
  } catch (error) {
    console.error("Recoupments API error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Recoupments worklist",
      },
      { status: 500 },
    );
  }
}
