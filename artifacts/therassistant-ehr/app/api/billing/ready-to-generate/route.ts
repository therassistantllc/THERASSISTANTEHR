/**
 * GET /api/billing/ready-to-generate
 *
 * Powers the "Ready to Generate" billing workqueue
 * (/billing/ready-to-generate). Returns every professional claim that has
 * cleared validation and is waiting to be assembled into an 837P batch.
 *
 * Criteria:
 *   - claim_status = 'ready_for_batch'
 *   - archived_at IS NULL
 *   - held_at IS NULL OR `?includeHeld=1` set (so the "On Hold" filter has
 *     something to show)
 *   - ordered by created_at ASC (oldest first)
 *
 * Returns enough fields to render the spec'd columns:
 *   Client, DOS, Clinician, Payer, CPT/HCPCS, Diagnosis, Modifiers,
 *   Charge amount, Place of service, Rendering provider, Billing provider,
 *   Ready status.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();

export interface ReadyToGenerateItem {
  id: string;
  claim_number: string | null;
  claim_status: string;
  client_id: string | null;
  client_name: string;
  service_date: string | null;
  clinician_name: string | null;
  payer_profile_id: string | null;
  payer_name: string | null;
  payer_type: string | null;
  payer_id_value: string | null;
  cpt_codes: string[];
  diagnosis_codes: string[];
  modifiers: string[];
  charge_amount: number;
  place_of_service: string | null;
  rendering_provider_npi: string | null;
  billing_provider_name: string | null;
  billing_provider_npi: string | null;
  ready_status: "ready" | "on_hold" | "needs_batch_assignment";
  held_at: string | null;
  hold_reason: string | null;
  age_days: number | null;
  encounter_id: string | null;
  batch_id: string | null;
  practice_id: string | null;
  practice_name: string | null;
  assigned_biller_user_id: string | null;
  assigned_biller_name: string | null;
  carc_codes: string[];
  rarc_codes: string[];
  follow_up_due_at: string | null;
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
    const includeHeld = ["1", "true", "yes"].includes(
      String(searchParams.get("includeHeld") ?? "").toLowerCase(),
    );
    const limitRaw = Number(searchParams.get("limit") ?? "100");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 250) : 100;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;
    const { data, error } = await (supabase as any).rpc("billing_ready_to_generate_page", {
      p_organization_id: organizationId,
      p_include_held: includeHeld,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;

    const rows = (data ?? []) as DbRow[];
    const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    const items: ReadyToGenerateItem[] = rows.map((row) => ({
      id: text(row.id),
      claim_number: text(row.claim_number) || null,
      claim_status: text(row.claim_status),
      client_id: text(row.client_id) || null,
      client_name: text(row.client_name) || "Unknown client",
      service_date: text(row.service_date) || null,
      clinician_name: text(row.clinician_name) || null,
      payer_profile_id: text(row.payer_profile_id) || null,
      payer_name: text(row.payer_name) || null,
      payer_type: text(row.payer_type) || null,
      payer_id_value: text(row.payer_id_value) || null,
      cpt_codes: Array.isArray(row.cpt_codes) ? (row.cpt_codes as unknown[]).map((v) => text(v)).filter(Boolean) : [],
      diagnosis_codes: Array.isArray(row.diagnosis_codes) ? (row.diagnosis_codes as unknown[]).map((v) => text(v)).filter(Boolean) : [],
      modifiers: Array.isArray(row.modifiers) ? (row.modifiers as unknown[]).map((v) => text(v)).filter(Boolean) : [],
      charge_amount: Number(row.charge_amount ?? 0),
      place_of_service: text(row.place_of_service) || null,
      rendering_provider_npi: text(row.rendering_provider_npi) || null,
      billing_provider_name: text(row.billing_provider_name) || null,
      billing_provider_npi: text(row.billing_provider_npi) || null,
      ready_status:
        text(row.ready_status) === "on_hold"
          ? "on_hold"
          : text(row.ready_status) === "needs_batch_assignment"
            ? "needs_batch_assignment"
            : "ready",
      held_at: text(row.held_at) || null,
      hold_reason: text(row.hold_reason) || null,
      age_days: Number.isFinite(Number(row.age_days)) ? Number(row.age_days) : null,
      encounter_id: text(row.encounter_id) || null,
      batch_id: text(row.batch_id) || null,
      practice_id: text(row.practice_id) || null,
      practice_name: text(row.practice_name) || null,
      assigned_biller_user_id: text(row.assigned_biller_user_id) || null,
      assigned_biller_name: text(row.assigned_biller_name) || null,
      carc_codes: [],
      rarc_codes: [],
      follow_up_due_at: text(row.follow_up_due_at) || null,
    }));

    return NextResponse.json({
      success: true,
      organizationId,
      pagination: {
        includeHeld,
        limit,
        offset,
        returned: items.length,
        totalCount,
        hasMore: offset + items.length < totalCount,
      },
      items,
    });
  } catch (error) {
    console.error("Ready-to-Generate API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load Ready-to-Generate worklist",
      },
      { status: 500 },
    );
  }
}
