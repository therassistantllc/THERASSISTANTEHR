/**
 * GET /api/billing/vcc
 *
 * Lists vcc_payments rows for the VCC workqueue, partitioned by the
 * tab (`new`, `processed`, `fee_review`, `matched_era`, `unmatched`)
 * and honoring the universal filter rail.
 *
 * Tabs map to the underlying table as:
 *   new          → status='pending'
 *   processed    → status='processed'
 *   fee_review   → fee_amount IS NULL
 *   matched_era  → payment_posting_id IS NOT NULL
 *   unmatched    → payment_posting_id IS NULL AND status != 'voided'
 *
 * Columns returned (spec): payer, amount, card mask, expiration,
 * claim count, era match, fee, status.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, any>;

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const TABS = new Set(["new", "processed", "fee_review", "matched_era", "unmatched"]);
const STATUSES = new Set(["pending", "processed", "failed", "expired", "voided"]);

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

    const tabRaw = text(searchParams.get("tab")) || "new";
    const tab = TABS.has(tabRaw) ? tabRaw : "new";

    const filter = {
      practice: text(searchParams.get("practice")),
      clinician: text(searchParams.get("clinician")),
      payer: text(searchParams.get("payer")),
      client: text(searchParams.get("client")),
      dosFrom: text(searchParams.get("dosFrom")),
      dosTo: text(searchParams.get("dosTo")),
      status: text(searchParams.get("status")),
      assignedBiller: text(searchParams.get("assignedBiller")),
      minAmount: text(searchParams.get("minAmount")),
      maxAmount: text(searchParams.get("maxAmount")),
      agingBucket: text(searchParams.get("agingBucket")),
      carcRarc: text(searchParams.get("carcRarc")),
      priority: text(searchParams.get("priority")),
      followUpDue: text(searchParams.get("followUpDue")),
    };

    let q: any = (supabase as any)
      .from("vcc_payments")
      .select(
        [
          "id",
          "organization_id",
          "mailroom_item_id",
          "payment_posting_id",
          "payer_name",
          "payer_id",
          "card_last4",
          "card_brand",
          "expiration_month",
          "expiration_year",
          "authorization_code",
          "reference_number",
          "payment_amount",
          "fee_amount",
          "service_date_start",
          "service_date_end",
          "client_id",
          "claim_id",
          "status",
          "processed_at",
          "processed_by_user_id",
          "notes",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("organization_id", organizationId);

    // ── Tab filter pushdown ────────────────────────────────────────────────
    if (tab === "new") q = q.eq("status", "pending");
    else if (tab === "processed") q = q.eq("status", "processed");
    else if (tab === "fee_review") q = q.is("fee_amount", null);
    else if (tab === "matched_era") q = q.not("payment_posting_id", "is", null);
    else if (tab === "unmatched") q = q.is("payment_posting_id", null).neq("status", "voided");

    // ── Universal filter pushdown ──────────────────────────────────────────
    if (filter.status && STATUSES.has(filter.status)) q = q.eq("status", filter.status);
    if (filter.payer) q = q.eq("payer_name", filter.payer);
    if (filter.dosFrom) q = q.gte("service_date_start", filter.dosFrom);
    if (filter.dosTo) q = q.lte("service_date_start", filter.dosTo);
    const minAmount = Number(filter.minAmount);
    if (filter.minAmount && Number.isFinite(minAmount)) q = q.gte("payment_amount", minAmount);
    const maxAmount = Number(filter.maxAmount);
    if (filter.maxAmount && Number.isFinite(maxAmount)) q = q.lte("payment_amount", maxAmount);

    // assignedBiller maps to processed_by_user_id — the staff member
    // who handled the VCC. __unassigned__ → still pending pickup.
    if (filter.assignedBiller) {
      if (filter.assignedBiller === "__unassigned__") {
        q = q.is("processed_by_user_id", null);
      } else {
        q = q.eq("processed_by_user_id", filter.assignedBiller);
      }
    }

    // Aging bucket on created_at (the date the VCC notice arrived).
    if (filter.agingBucket) {
      const now = new Date();
      const cutoff = (days: number) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        return d.toISOString();
      };
      switch (filter.agingBucket) {
        case "0-7":
          q = q.gte("created_at", cutoff(7));
          break;
        case "8-30":
          q = q.gte("created_at", cutoff(30)).lt("created_at", cutoff(7));
          break;
        case "31-60":
          q = q.gte("created_at", cutoff(60)).lt("created_at", cutoff(30));
          break;
        case "60+":
          q = q.lt("created_at", cutoff(60));
          break;
      }
    }

    const { data: vccs, error: vccErr } = await q
      .order("created_at", { ascending: false })
      .limit(500);

    if (vccErr) throw vccErr;

    const vccRows: DbRow[] = (vccs as DbRow[]) ?? [];

    const clientIds = [...new Set(vccRows.map((v) => text(v.client_id)).filter(Boolean))];
    const claimIds = [...new Set(vccRows.map((v) => text(v.claim_id)).filter(Boolean))];
    const postingIds = [
      ...new Set(vccRows.map((v) => text(v.payment_posting_id)).filter(Boolean)),
    ];
    const mailroomIds = [
      ...new Set(vccRows.map((v) => text(v.mailroom_item_id)).filter(Boolean)),
    ];
    const processedByIds = [
      ...new Set(vccRows.map((v) => text(v.processed_by_user_id)).filter(Boolean)),
    ];

    const [
      { data: clients },
      { data: claims },
      { data: postings },
      { data: mailroom },
      { data: processedByUsers },
    ] = await Promise.all([
      clientIds.length
        ? (supabase as any)
            .from("clients")
            .select("id, first_name, last_name")
            .in("id", clientIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      claimIds.length
        ? (supabase as any)
            .from("professional_claims")
            .select(
              "id, claim_number, total_charge, claim_status, patient_id, payer_profile_id, appointment_id, encounter_id",
            )
            .in("id", claimIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      postingIds.length
        ? (supabase as any)
            .from("payment_postings")
            .select("id, posting_reference, posting_status, total_posted_amount, posted_at")
            .in("id", postingIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      mailroomIds.length
        ? (supabase as any)
            .from("mailroom_items")
            .select("id, file_name, document_type")
            .in("id", mailroomIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      processedByIds.length
        ? (supabase as any)
            .from("staff_profiles")
            .select("id, first_name, last_name, email")
            .in("id", processedByIds)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);

    const clientById = new Map<string, DbRow>(
      ((clients as DbRow[]) ?? []).map((c) => [text(c.id), c]),
    );
    const claimById = new Map<string, DbRow>(
      ((claims as DbRow[]) ?? []).map((c) => [text(c.id), c]),
    );

    // Pull appointment + encounter rows for the linked claims so we can
    // attribute each VCC to a practice location and clinician.
    const appointmentIds = [
      ...new Set(
        ((claims as DbRow[]) ?? [])
          .map((c) => text(c.appointment_id))
          .filter(Boolean),
      ),
    ];
    const encounterIds = [
      ...new Set(
        ((claims as DbRow[]) ?? [])
          .map((c) => text(c.encounter_id))
          .filter(Boolean),
      ),
    ];
    const [{ data: appts }, { data: encs }] = await Promise.all([
      appointmentIds.length
        ? (supabase as any)
            .from("appointments")
            .select("id, provider_id, provider_location_id")
            .in("id", appointmentIds)
        : Promise.resolve({ data: [] as DbRow[] }),
      encounterIds.length
        ? (supabase as any)
            .from("encounters")
            .select("id, provider_id, appointment_id")
            .in("id", encounterIds)
        : Promise.resolve({ data: [] as DbRow[] }),
    ]);
    const apptById = new Map<string, DbRow>(
      ((appts as DbRow[]) ?? []).map((a) => [text(a.id), a]),
    );
    const encById = new Map<string, DbRow>(
      ((encs as DbRow[]) ?? []).map((e) => [text(e.id), e]),
    );
    const postingById = new Map<string, DbRow>(
      ((postings as DbRow[]) ?? []).map((p) => [text(p.id), p]),
    );
    const mailroomById = new Map<string, DbRow>(
      ((mailroom as DbRow[]) ?? []).map((m) => [text(m.id), m]),
    );
    const userById = new Map<string, DbRow>(
      ((processedByUsers as DbRow[]) ?? []).map((u) => [text(u.id), u]),
    );

    const staffName = (u: DbRow | undefined): string | null => {
      if (!u) return null;
      const composed = [u.first_name, u.last_name].map(text).filter(Boolean).join(" ");
      return composed || text(u.email) || null;
    };

    const now = Date.now();
    let rows = vccRows.map((v) => {
      const id = text(v.id);
      const client = clientById.get(text(v.client_id));
      const claim = claimById.get(text(v.claim_id));
      const posting = postingById.get(text(v.payment_posting_id));
      const mail = mailroomById.get(text(v.mailroom_item_id));
      const processedBy = userById.get(text(v.processed_by_user_id));

      const expMonth = v.expiration_month != null ? Number(v.expiration_month) : null;
      const expYear = v.expiration_year != null ? Number(v.expiration_year) : null;
      const expLabel =
        expMonth && expYear
          ? `${String(expMonth).padStart(2, "0")}/${String(expYear).slice(-2)}`
          : null;

      const expired =
        !!(expMonth && expYear) &&
        (() => {
          const d = new Date();
          const y = d.getFullYear();
          const m = d.getMonth() + 1;
          return expYear < y || (expYear === y && expMonth < m);
        })();

      const createdAt = text(v.created_at) || null;
      const ageDays = createdAt
        ? Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 86_400_000))
        : 0;

      const cardMask = v.card_last4
        ? `${text(v.card_brand) || "Card"} •••• ${text(v.card_last4)}`
        : "—";

      const clientName = client
        ? [client.first_name, client.last_name].map(text).filter(Boolean).join(" ") ||
          "Unknown client"
        : null;

      // Resolve clinician + practice location through the linked claim →
      // appointment / encounter. Prefer appointment when available; fall
      // back to encounter → its appointment.
      const appt = claim ? apptById.get(text(claim.appointment_id)) : undefined;
      const enc = claim ? encById.get(text(claim.encounter_id)) : undefined;
      const apptForEnc = enc ? apptById.get(text(enc.appointment_id)) : undefined;
      const providerId =
        text(appt?.provider_id) || text(enc?.provider_id) || null;
      const practiceLocationId =
        text(appt?.provider_location_id) ||
        text(apptForEnc?.provider_location_id) ||
        null;

      return {
        providerId,
        practiceLocationId,
        id,
        payerName: text(v.payer_name) || "—",
        payerId: text(v.payer_id) || null,
        paymentAmount: money(v.payment_amount),
        feeAmount: v.fee_amount == null ? null : money(v.fee_amount),
        cardLast4: text(v.card_last4) || null,
        cardBrand: text(v.card_brand) || null,
        cardMask,
        expirationLabel: expLabel,
        expired,
        claimCount: v.claim_id ? 1 : 0,
        claimId: text(v.claim_id) || null,
        claimNumber: text(claim?.claim_number) || null,
        claimStatus: text(claim?.claim_status) || null,
        claimTotal: claim?.total_charge != null ? money(claim.total_charge) : null,
        paymentPostingId: text(v.payment_posting_id) || null,
        postingReference: text(posting?.posting_reference) || null,
        postingStatus: text(posting?.posting_status) || null,
        postingAmount:
          posting?.total_posted_amount != null ? money(posting.total_posted_amount) : null,
        postedAt: text(posting?.posted_at) || null,
        mailroomItemId: text(v.mailroom_item_id) || null,
        mailroomFileName: text(mail?.file_name) || null,
        clientId: text(v.client_id) || null,
        clientName,
        serviceDateStart: text(v.service_date_start) || null,
        serviceDateEnd: text(v.service_date_end) || null,
        referenceNumber: text(v.reference_number) || null,
        authorizationCode: text(v.authorization_code) || null,
        status: text(v.status) || "pending",
        processedAt: text(v.processed_at) || null,
        processedByName: staffName(processedBy),
        notes: text(v.notes) || null,
        createdAt,
        ageDays,
      };
    });

    // ── Remaining filters that need composed fields ────────────────────────
    if (filter.client) {
      const needle = filter.client.toLowerCase();
      rows = rows.filter((r) => (r.clientName ?? "").toLowerCase().includes(needle));
    }
    if (filter.practice) {
      rows = rows.filter((r) => r.practiceLocationId === filter.practice);
    }
    if (filter.clinician) {
      rows = rows.filter((r) => r.providerId === filter.clinician);
    }
    if (filter.carcRarc) {
      const needle = filter.carcRarc.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.notes ?? "").toLowerCase().includes(needle) ||
          (r.referenceNumber ?? "").toLowerCase().includes(needle),
      );
    }
    // Priority maps to VCC handling urgency:
    //   urgent → card expired OR notice older than 14 days unprocessed
    //   normal → everything else
    const isUrgent = (r: { expired: boolean; ageDays: number; status: string }) =>
      r.expired || (r.status !== "processed" && r.ageDays > 14);
    if (filter.priority === "urgent") {
      rows = rows.filter(isUrgent);
    } else if (filter.priority === "normal") {
      rows = rows.filter((r) => !isUrgent(r));
    }
    // followUpDue is anchored to the VCC notice's age (created_at) since
    // vcc_payments has no dedicated follow-up-date column.
    //   today   → arrived today, still pending
    //   week    → arrived in the last 7 days, still pending
    //   overdue → arrived > 14 days ago, still pending (or card expired)
    if (filter.followUpDue) {
      rows = rows.filter((r) => {
        const stillOpen = r.status === "pending";
        if (filter.followUpDue === "today") return stillOpen && r.ageDays === 0;
        if (filter.followUpDue === "week") return stillOpen && r.ageDays <= 7;
        if (filter.followUpDue === "overdue")
          return (stillOpen && r.ageDays > 14) || r.expired;
        return true;
      });
    }

    // ── Tab counts (computed off a small parallel probe so the tab strip
    //    has live counts even when a sub-filter is applied). ──────────────
    const baseQuery = () =>
      (supabase as any)
        .from("vcc_payments")
        .select("id, status, fee_amount, payment_posting_id", { count: "exact", head: false })
        .eq("organization_id", organizationId)
        .limit(5000);

    const [
      { data: countsRaw },
    ] = await Promise.all([baseQuery()]);

    const all: DbRow[] = (countsRaw as DbRow[]) ?? [];
    const tabCounts: Record<string, number> = {
      new: 0,
      processed: 0,
      fee_review: 0,
      matched_era: 0,
      unmatched: 0,
    };
    for (const r of all) {
      if (text(r.status) === "pending") tabCounts.new += 1;
      if (text(r.status) === "processed") tabCounts.processed += 1;
      if (r.fee_amount == null) tabCounts.fee_review += 1;
      if (r.payment_posting_id) tabCounts.matched_era += 1;
      if (!r.payment_posting_id && text(r.status) !== "voided") tabCounts.unmatched += 1;
    }

    // ── Filter-rail option lists. ─────────────────────────────────────────
    const { data: billers } = await (supabase as any)
      .from("staff_profiles")
      .select("id, first_name, last_name, email")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .limit(200);

    const assignees = ((billers as DbRow[]) ?? []).map((s) => {
      const name = staffName(s) || "Unknown";
      return { id: text(s.id), displayName: name };
    });

    const [{ data: practiceLocations }, { data: providerRows }] = await Promise.all([
      (supabase as any)
        .from("provider_locations")
        .select("id, location_name")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("location_name", { ascending: true }),
      (supabase as any)
        .from("providers")
        .select("id, first_name, last_name, display_name")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("last_name", { ascending: true }),
    ]);

    const practices = ((practiceLocations as DbRow[]) ?? []).map((p) => ({
      id: text(p.id),
      name: text(p.location_name) || "Unnamed location",
    }));

    // Clinician dropdown must be sourced from `providers` because
    // appointments.provider_id / encounters.provider_id reference that
    // table (NOT staff_profiles).
    const clinicians = ((providerRows as DbRow[]) ?? []).map((p) => {
      const name =
        text(p.display_name) ||
        [p.first_name, p.last_name].map(text).filter(Boolean).join(" ") ||
        "Unnamed provider";
      return { id: text(p.id), displayName: name };
    });

    const payerNames = Array.from(
      new Set(vccRows.map((v) => text(v.payer_name)).filter(Boolean)),
    ).sort();

    return NextResponse.json({
      success: true,
      organizationId,
      tab,
      rows,
      assignees,
      practices,
      clinicians,
      payers: payerNames,
      tabCounts,
    });
  } catch (error) {
    console.error("VCC API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "VCC API failed",
      },
      { status: 500 },
    );
  }
}
