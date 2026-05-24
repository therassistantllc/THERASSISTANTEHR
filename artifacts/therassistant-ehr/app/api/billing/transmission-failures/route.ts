/**
 * GET /api/billing/transmission-failures
 *
 * Powers the Transmission Failures workqueue. Returns one row per failed
 * 837P batch (batch_status in {"rejected","failed"} OR a non-2xx
 * last_submission_http_status that hasn't been retried successfully).
 * Each row carries the failure classification (tab), the claim count,
 * the rolled-up dollar total of all claims in the batch, and the
 * persisted submission outcome.
 *
 * The universal filter rail is honored at the row level so the table
 * matches the spec verbatim — practice/clinician are derived from the
 * batch's first claim's parties snapshot; client/payer narrow to
 * batches that contain at least one matching claim; CARC/RARC matches
 * against the error message; aging/priority are computed from
 * last_submission_attempted_at.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  classifyTransmissionFailure,
  TRANSMISSION_FAILURE_TAB_IDS,
  type TransmissionFailureTabId,
} from "@/lib/billing/transmissionFailures";

type DbRow = Record<string, unknown>;

const MAX_BATCHES = 200;

interface ClaimSummary {
  id: string;
  claimNumber: string | null;
  clientId: string | null;
  clientName: string;
  payerId: string | null;
  payerName: string | null;
  totalCharge: number;
  status: string;
  earliestDos: string | null;
}

interface EscalationSummary {
  id: string;
  status: string;
  priority: string;
  note: string | null;
  assigneeUserId: string | null;
  assigneeDisplayName: string | null;
  openedAt: string;
  openedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

interface BatchRow {
  id: string;
  batchNumber: string;
  batchStatus: string;
  tab: TransmissionFailureTabId;
  claimCount: number;
  totalCharges: number;
  errorMessage: string;
  attemptCount: number;
  attemptedAt: string | null;
  agingDays: number | null;
  lastEndpoint: string | null;
  lastHttpStatus: number | null;
  availityTransactionId: string | null;
  idempotencyKey: string | null;
  generatedFileName: string | null;
  createdAt: string;
  updatedAt: string;
  claims: ClaimSummary[];
  practiceName: string | null;
  clinicianName: string | null;
  attempts: AttemptHistoryEntry[];
  assignedToUserId: string | null;
  assignedToDisplayName: string | null;
  openEscalation: EscalationSummary | null;
}

interface AttemptHistoryEntry {
  id: string;
  attemptNumber: number;
  attemptedAt: string | null;
  endpoint: string | null;
  httpStatus: number | null;
  idempotencyKey: string | null;
  externalTransactionId: string | null;
  outcome: "success" | "failure" | string;
  errorMessage: string | null;
  responseExcerpt: string | null;
  actorDisplayName: string | null;
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function ciContains(haystack: string | null, needle: string | null): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function bucketMatch(age: number | null, bucket: string | null): boolean {
  if (!bucket) return true;
  const a = age ?? 0;
  switch (bucket) {
    case "0-7": return a <= 7;
    case "8-30": return a >= 8 && a <= 30;
    case "31-60": return a >= 31 && a <= 60;
    case "60+": return a > 60;
    default: return true;
  }
}

/**
 * A batch is a "transmission failure" if:
 *   - batch_status is "rejected" or "failed", OR
 *   - it has attempted submission (attempt_count > 0) AND it is not
 *     currently in a healthy post-submission status ("submitted",
 *     "accepted", "acknowledged").
 *
 * We pull a wider window and filter in JS rather than relying on a
 * fragile .or() string against an enum column whose exact values vary
 * across the app's history.
 */
function isFailureRow(row: DbRow): boolean {
  const status = text(row.batch_status).toLowerCase();
  if (status === "rejected" || status === "failed" || status === "transmission_failed") {
    return true;
  }
  const attempts = Number(row.submission_attempt_count ?? 0);
  const httpStatus = Number(row.last_submission_http_status ?? 0);
  const okStatuses = new Set(["submitted", "accepted", "acknowledged"]);
  if (attempts > 0 && !okStatuses.has(status) && (httpStatus === 0 || httpStatus >= 400)) {
    return true;
  }
  return false;
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

    const f = {
      payer: searchParams.get("payer"),
      client: searchParams.get("client"),
      status: searchParams.get("status"),
      dosFrom: searchParams.get("dosFrom"),
      dosTo: searchParams.get("dosTo"),
      minAmount: searchParams.get("minAmount"),
      maxAmount: searchParams.get("maxAmount"),
      agingBucket: searchParams.get("agingBucket"),
      priority: searchParams.get("priority"),
      practice: searchParams.get("practice"),
      clinician: searchParams.get("clinician"),
      assignedBiller: searchParams.get("assignedBiller"),
      carcRarc: searchParams.get("carcRarc"),
      followUpDue: searchParams.get("followUpDue"),
    };

    let batchQuery: any = (supabase as any)
      .from("claim_837p_batches")
      .select(
        "id, batch_number, batch_status, claim_count, total_charge_amount, generated_file_name, submitted_at, created_at, updated_at, last_submission_attempted_at, last_submission_endpoint, last_submission_http_status, submission_attempt_count, submission_error, submission_idempotency_key, office_ally_transaction_id, availity_transaction_id, assigned_to_user_id, assigned_to_display_name",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null);
    // assignedBiller pushes down at the SQL layer now that batches carry
    // their own assignee. "__unassigned__" matches rows with a null
    // assignee; a uuid matches that specific staff member; any non-uuid
    // value is ignored on the server (client should always send the id).
    if (f.assignedBiller) {
      if (f.assignedBiller === "__unassigned__") {
        batchQuery = batchQuery.is("assigned_to_user_id", null);
      } else if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          f.assignedBiller,
        )
      ) {
        batchQuery = batchQuery.eq("assigned_to_user_id", f.assignedBiller);
      }
    }
    const { data: batches, error: batchError } = await batchQuery
      .order("last_submission_attempted_at", { ascending: false, nullsFirst: false })
      .limit(MAX_BATCHES);

    if (batchError) throw batchError;

    const failed = (batches ?? []).filter(isFailureRow) as DbRow[];
    if (failed.length === 0) {
      return NextResponse.json({ success: true, items: [] });
    }

    const batchIds = failed.map((b) => text(b.id)).filter(Boolean);

    // Fan out: pull batch→claim membership, then per-claim data, plus
    // any open escalations against these batches.
    const [{ data: batchClaims }, { data: openEscalations }] = await Promise.all([
      supabase
        .from("claim_837p_batch_claims")
        .select("batch_id, professional_claim_id")
        .eq("organization_id", organizationId)
        .in("batch_id", batchIds)
        .is("archived_at", null),
      (supabase as any)
        .from("claim_837p_batch_escalations")
        .select(
          "id, batch_id, status, priority, note, assigned_to_user_id, assigned_to_display_name, opened_at, opened_by_user_id, resolved_at, resolved_by_user_id, resolution_note",
        )
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .in("batch_id", batchIds)
        .order("opened_at", { ascending: false }),
    ]);

    // First row per batch wins (we ordered desc), so we keep the most
    // recent open escalation when there are duplicates from a retry.
    const escByBatch = new Map<string, DbRow>();
    for (const e of (openEscalations ?? []) as DbRow[]) {
      const bid = text(e.batch_id);
      if (bid && !escByBatch.has(bid)) escByBatch.set(bid, e);
    }

    // Per-batch transmission attempt history (Task #442). Ordered oldest →
    // newest so the UI can render a chronological timeline without sorting.
    const { data: attemptRows } = await (supabase as any)
      .from("claim_837p_batch_transmission_attempts")
      .select(
        "id, batch_id, attempt_number, attempted_at, endpoint, http_status, idempotency_key, external_transaction_id, outcome, error_message, response_excerpt, actor_display_name",
      )
      .eq("organization_id", organizationId)
      .in("batch_id", batchIds)
      .order("attempted_at", { ascending: true });

    const attemptsByBatchId = new Map<string, AttemptHistoryEntry[]>();
    for (const a of (attemptRows ?? []) as DbRow[]) {
      const batchId = text(a.batch_id);
      if (!batchId) continue;
      const entry: AttemptHistoryEntry = {
        id: text(a.id),
        attemptNumber: Number(a.attempt_number ?? 0),
        attemptedAt: text(a.attempted_at) || null,
        endpoint: text(a.endpoint) || null,
        httpStatus: a.http_status == null ? null : Number(a.http_status),
        idempotencyKey: text(a.idempotency_key) || null,
        externalTransactionId: text(a.external_transaction_id) || null,
        outcome: text(a.outcome) || "failure",
        errorMessage: text(a.error_message) || null,
        responseExcerpt: text(a.response_excerpt) || null,
        actorDisplayName: text(a.actor_display_name) || null,
      };
      const list = attemptsByBatchId.get(batchId) ?? [];
      list.push(entry);
      attemptsByBatchId.set(batchId, list);
    }

    const claimIds = [
      ...new Set(
        (batchClaims ?? [])
          .map((r: DbRow) => text(r.professional_claim_id))
          .filter(Boolean),
      ),
    ];

    const [{ data: claims }, { data: parties }, { data: serviceLines }] = await Promise.all([
      claimIds.length
        ? supabase
            .from("professional_claims")
            .select(
              "id, claim_number, claim_status, patient_id, payer_profile_id, total_charge",
            )
            .eq("organization_id", organizationId)
            .in("id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      claimIds.length
        ? (supabase as any)
            .from("claim_parties_snapshot")
            .select("claim_id, parties")
            .in("claim_id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      claimIds.length
        ? (supabase as any)
            .from("professional_claim_service_lines")
            .select("claim_id, service_date_from")
            .in("claim_id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);

    const earliestDosByClaim = new Map<string, string>();
    for (const sl of (serviceLines ?? []) as DbRow[]) {
      const claimId = text(sl.claim_id);
      const dos = text(sl.service_date_from);
      if (!claimId || !dos) continue;
      const prev = earliestDosByClaim.get(claimId);
      if (!prev || dos < prev) earliestDosByClaim.set(claimId, dos);
    }

    const clientIds = [
      ...new Set(
        ((claims ?? []) as DbRow[])
          .map((c) => text(c.patient_id))
          .filter(Boolean),
      ),
    ];
    const payerIds = [
      ...new Set(
        ((claims ?? []) as DbRow[])
          .map((c) => text(c.payer_profile_id))
          .filter(Boolean),
      ),
    ];

    const [{ data: clientsRows }, { data: payersRows }] = await Promise.all([
      clientIds.length
        ? supabase
            .from("clients")
            .select("id, first_name, last_name")
            .in("id", clientIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      payerIds.length
        ? supabase
            .from("payer_profiles")
            .select("id, payer_name")
            .in("id", payerIds)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);

    const clientById = new Map<string, { first: string; last: string }>(
      ((clientsRows ?? []) as DbRow[]).map((r) => [
        text(r.id),
        { first: text(r.first_name), last: text(r.last_name) },
      ]),
    );
    const payerById = new Map<string, string>(
      ((payersRows ?? []) as DbRow[]).map((r) => [
        text(r.id),
        text(r.payer_name) || "—",
      ]),
    );
    const claimById = new Map<string, DbRow>(
      ((claims ?? []) as DbRow[]).map((r) => [text(r.id), r]),
    );
    const partiesByClaim = new Map<string, Record<string, unknown>>();
    for (const p of (parties ?? []) as DbRow[]) {
      const claimId = text(p.claim_id);
      if (claimId) {
        partiesByClaim.set(
          claimId,
          (p.parties as Record<string, unknown>) ?? {},
        );
      }
    }

    const claimsByBatchId = new Map<string, ClaimSummary[]>();
    for (const link of (batchClaims ?? []) as DbRow[]) {
      const batchId = text(link.batch_id);
      const claim = claimById.get(text(link.professional_claim_id));
      if (!claim) continue;
      const clientId = text(claim.patient_id) || null;
      const client = clientId ? clientById.get(clientId) : null;
      const clientName = client
        ? `${client.last}, ${client.first}`.trim().replace(/^,\s*/, "")
        : "—";
      const payerId = text(claim.payer_profile_id) || null;
      const payerName = payerId ? payerById.get(payerId) ?? null : null;
      const claimIdStr = text(claim.id);
      const summary: ClaimSummary = {
        id: claimIdStr,
        claimNumber: text(claim.claim_number) || null,
        clientId,
        clientName,
        payerId,
        payerName,
        totalCharge: money(claim.total_charge),
        status: text(claim.claim_status),
        earliestDos: earliestDosByClaim.get(claimIdStr) ?? null,
      };
      const list = claimsByBatchId.get(batchId) ?? [];
      list.push(summary);
      claimsByBatchId.set(batchId, list);
    }

    const rows: BatchRow[] = [];
    for (const b of failed) {
      const batchId = text(b.id);
      const claimList = claimsByBatchId.get(batchId) ?? [];
      const totalCharges =
        money(b.total_charge_amount) ||
        claimList.reduce((s, c) => s + c.totalCharge, 0);
      const attemptedAt = text(b.last_submission_attempted_at) || null;
      const aging = ageDays(attemptedAt ?? text(b.updated_at) ?? null);

      // Derive practice/clinician from the first claim's parties snapshot —
      // batches almost always share a billing provider, and we only need
      // one signal for the filter rail.
      let practiceName: string | null = null;
      let clinicianName: string | null = null;
      for (const c of claimList) {
        const p = partiesByClaim.get(c.id);
        if (!p) continue;
        practiceName =
          text(p.service_facility_name) ||
          text(p.billing_provider_name) ||
          null;
        clinicianName =
          text(p.rendering_provider_name) ||
          [
            text(p.rendering_provider_first_name),
            text(p.rendering_provider_last_name),
          ]
            .filter(Boolean)
            .join(" ") ||
          null;
        if (practiceName || clinicianName) break;
      }

      const errorMessage =
        text(b.submission_error) ||
        (text(b.last_submission_http_status)
          ? `HTTP ${b.last_submission_http_status} from ${text(b.last_submission_endpoint) || "clearinghouse"}`
          : `Batch status: ${text(b.batch_status) || "unknown"}`);

      const tab = classifyTransmissionFailure({
        submissionError: text(b.submission_error) || null,
        lastSubmissionEndpoint: text(b.last_submission_endpoint) || null,
        lastSubmissionHttpStatus:
          b.last_submission_http_status == null
            ? null
            : Number(b.last_submission_http_status),
      });

      const esc = escByBatch.get(batchId) ?? null;
      const openEscalation: EscalationSummary | null = esc
        ? {
            id: text(esc.id),
            status: text(esc.status) || "open",
            priority: text(esc.priority) || "normal",
            note: text(esc.note) || null,
            assigneeUserId: text(esc.assigned_to_user_id) || null,
            assigneeDisplayName: text(esc.assigned_to_display_name) || null,
            openedAt: text(esc.opened_at),
            openedByUserId: text(esc.opened_by_user_id) || null,
            resolvedAt: text(esc.resolved_at) || null,
            resolvedByUserId: text(esc.resolved_by_user_id) || null,
            resolutionNote: text(esc.resolution_note) || null,
          }
        : null;

      const row: BatchRow = {
        id: batchId,
        batchNumber: text(b.batch_number),
        batchStatus: text(b.batch_status),
        tab,
        claimCount: Number(b.claim_count ?? claimList.length) || claimList.length,
        totalCharges,
        errorMessage,
        attemptCount: Number(b.submission_attempt_count ?? 0),
        attemptedAt,
        agingDays: aging,
        lastEndpoint: text(b.last_submission_endpoint) || null,
        lastHttpStatus:
          b.last_submission_http_status == null
            ? null
            : Number(b.last_submission_http_status),
        availityTransactionId:
          text(b.availity_transaction_id) ||
          text(b.office_ally_transaction_id) ||
          null,
        idempotencyKey: text(b.submission_idempotency_key) || null,
        generatedFileName: text(b.generated_file_name) || null,
        createdAt: text(b.created_at),
        updatedAt: text(b.updated_at),
        claims: claimList,
        practiceName,
        clinicianName,
        attempts: attemptsByBatchId.get(batchId) ?? [],
        assignedToUserId: text(b.assigned_to_user_id) || null,
        assignedToDisplayName: text(b.assigned_to_display_name) || null,
        openEscalation,
      };

      // Universal-rail filter pass. The filter rail is queue-wide, so a
      // batch matches if any of its claims match a per-claim filter.
      if (f.payer && !claimList.some((c) => c.payerId === f.payer)) continue;
      if (f.client && !claimList.some((c) => c.clientId === f.client)) continue;
      if (
        f.minAmount &&
        Number.isFinite(Number(f.minAmount)) &&
        totalCharges < Number(f.minAmount)
      ) continue;
      if (
        f.maxAmount &&
        Number.isFinite(Number(f.maxAmount)) &&
        totalCharges > Number(f.maxAmount)
      ) continue;
      if (!bucketMatch(aging, f.agingBucket)) continue;
      if (f.priority === "urgent" && (aging ?? 0) <= 3) continue;
      if (f.practice && !ciContains(practiceName, f.practice)) continue;
      if (f.clinician && !ciContains(clinicianName, f.clinician)) continue;
      if (f.status && row.batchStatus.toLowerCase() !== f.status.toLowerCase()) continue;
      if (
        f.carcRarc &&
        !ciContains(errorMessage, f.carcRarc) &&
        !ciContains(row.lastEndpoint, f.carcRarc)
      ) continue;
      // DOS: batch matches if any claim's earliest service date is in the
      // requested range. Claims without a service date are excluded from
      // a positive DOS match (you can't filter on data you don't have).
      if (f.dosFrom || f.dosTo) {
        const anyMatch = claimList.some((c) => {
          if (!c.earliestDos) return false;
          if (f.dosFrom && c.earliestDos < f.dosFrom) return false;
          if (f.dosTo && c.earliestDos > f.dosTo) return false;
          return true;
        });
        if (!anyMatch) continue;
      }
      // assignedBiller is pushed down at the SQL layer above (matches
      // claim_837p_batches.assigned_to_user_id or the "__unassigned__"
      // sentinel) so there is nothing left to do here.
      // followUpDue: batches don't carry a follow-up-due date, so we
      // treat the last attempt date as the implied follow-up anchor
      // (the natural "next-look" day). Compare ISO date prefixes.
      if (f.followUpDue) {
        const attemptDate = attemptedAt ? attemptedAt.slice(0, 10) : null;
        if (attemptDate !== f.followUpDue) continue;
      }

      rows.push(row);
    }

    // Filter-rail option list — populate the "Assigned biller" select
    // with the org's billers so the queue can route an escalation to a
    // teammate without typing a name.
    const { data: billers } = await (supabase as any)
      .from("staff_profiles")
      .select("id, first_name, last_name, email")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("last_name", { ascending: true })
      .limit(200);
    const assignees = ((billers as DbRow[]) ?? []).map((s) => {
      const composed = [s.first_name, s.last_name]
        .map(text)
        .filter(Boolean)
        .join(" ");
      return {
        id: text(s.id),
        displayName: composed || text(s.email) || "Unknown",
      };
    });

    return NextResponse.json({
      success: true,
      items: rows,
      assignees,
      meta: {
        scanned: (batches ?? []).length,
        failed: failed.length,
        tabs: TRANSMISSION_FAILURE_TAB_IDS,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error:
          e instanceof Error ? e.message : "Failed to load transmission failures",
      },
      { status: 500 },
    );
  }
}
