/**
 * /api/billing/payment-adjustments
 *
 * GET  ?organizationId=…&eraImportBatchId=…&eraClaimPaymentId=…&professionalClaimId=…
 *      → list payment_adjustments rows, filterable by any of the FK scopes.
 * POST { organizationId, scope, adjustmentType, amount, ...optional }
 *      → create a new adjustment (claim-level, provider-level, or service_line).
 *
 * Task #108 — supports the claim/provider-level adjustments section of the
 * assisted poster workspace.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  PaymentPostingForbiddenError,
  PaymentPostingUnauthenticatedError,
  requireAuthenticatedPaymentPoster,
} from "@/lib/payments/postingEngine";

const ALLOWED_SCOPES = ["claim_level", "provider_level", "service_line"] as const;
const ALLOWED_TYPES = [
  "interest",
  "sequestration",
  "recoupment",
  "forwarding_balance",
  "incentive",
  "capitation",
  "patient_responsibility_transfer",
  "contractual_obligation",
  "denial",
  "reversal",
  "refund",
  "unapplied_credit",
  "other",
] as const;

type AdjustmentRow = {
  id: string;
  scope: string;
  adjustment_type: string;
  group_code: string | null;
  reason_code: string | null;
  reference_id: string | null;
  amount: number | string;
  description: string | null;
  source: string;
  posted_at: string | null;
  era_import_batch_id: string | null;
  era_claim_payment_id: string | null;
  professional_claim_id: string | null;
  client_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function shape(row: AdjustmentRow) {
  return {
    id: row.id,
    scope: row.scope,
    adjustmentType: row.adjustment_type,
    groupCode: row.group_code,
    reasonCode: row.reason_code,
    referenceId: row.reference_id,
    amount: n(row.amount),
    description: row.description,
    source: row.source,
    postedAt: row.posted_at,
    eraImportBatchId: row.era_import_batch_id,
    eraClaimPaymentId: row.era_claim_payment_id,
    professionalClaimId: row.professional_claim_id,
    clientId: row.client_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    await requireAuthenticatedPaymentPoster(organizationId);

    let query = supabase
      .from("payment_adjustments")
      .select(
        "id, scope, adjustment_type, group_code, reason_code, reference_id, amount, description, source, posted_at, era_import_batch_id, era_claim_payment_id, professional_claim_id, client_id, metadata, created_at, updated_at",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    const batchId = searchParams.get("eraImportBatchId");
    const paymentId = searchParams.get("eraClaimPaymentId");
    const claimId = searchParams.get("professionalClaimId");
    if (batchId) query = query.eq("era_import_batch_id", batchId);
    if (paymentId) query = query.eq("era_claim_payment_id", paymentId);
    if (claimId) query = query.eq("professional_claim_id", claimId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      items: ((data ?? []) as AdjustmentRow[]).map(shape),
    });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof PaymentPostingForbiddenError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "List adjustments failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    if (!organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }
    const actor = await requireAuthenticatedPaymentPoster(organizationId);

    const scope = typeof body.scope === "string" ? body.scope : "";
    const adjustmentType = typeof body.adjustmentType === "string" ? body.adjustmentType : "";
    const amount = n(body.amount);
    if (!ALLOWED_SCOPES.includes(scope as (typeof ALLOWED_SCOPES)[number])) {
      return NextResponse.json({ success: false, error: `Invalid scope "${scope}"` }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(adjustmentType as (typeof ALLOWED_TYPES)[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid adjustmentType "${adjustmentType}"` },
        { status: 400 },
      );
    }
    if (amount === 0) {
      return NextResponse.json({ success: false, error: "amount must be non-zero" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    // Cross-tenant FK guard: any caller-supplied foreign key must resolve to
    // a row in the same organization, otherwise we'd let org A attach an
    // adjustment to org B's batch/claim/client by id-guessing.
    const fkChecks: Array<{ key: string; table: string; id: string }> = [];
    if (typeof body.eraImportBatchId === "string" && body.eraImportBatchId)
      fkChecks.push({ key: "eraImportBatchId", table: "era_import_batches", id: body.eraImportBatchId });
    if (typeof body.eraClaimPaymentId === "string" && body.eraClaimPaymentId)
      fkChecks.push({ key: "eraClaimPaymentId", table: "era_claim_payments", id: body.eraClaimPaymentId });
    if (typeof body.professionalClaimId === "string" && body.professionalClaimId)
      fkChecks.push({ key: "professionalClaimId", table: "professional_claims", id: body.professionalClaimId });
    if (typeof body.clientId === "string" && body.clientId)
      fkChecks.push({ key: "clientId", table: "clients", id: body.clientId });
    for (const fk of fkChecks) {
      const { data: own, error: ownErr } = await supabase
        .from(fk.table)
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", fk.id)
        .maybeSingle();
      if (ownErr) {
        return NextResponse.json({ success: false, error: ownErr.message }, { status: 500 });
      }
      if (!own?.id) {
        return NextResponse.json(
          { success: false, error: `${fk.key} not found in this organization.` },
          { status: 404 },
        );
      }
    }

    const now = new Date().toISOString();
    const insertRow = {
      organization_id: organizationId,
      scope,
      adjustment_type: adjustmentType,
      amount,
      group_code: typeof body.groupCode === "string" ? body.groupCode : null,
      reason_code: typeof body.reasonCode === "string" ? body.reasonCode : null,
      reference_id: typeof body.referenceId === "string" ? body.referenceId : null,
      description: typeof body.description === "string" ? body.description : null,
      source: typeof body.source === "string" ? body.source : "manual",
      era_import_batch_id:
        typeof body.eraImportBatchId === "string" ? body.eraImportBatchId : null,
      era_claim_payment_id:
        typeof body.eraClaimPaymentId === "string" ? body.eraClaimPaymentId : null,
      professional_claim_id:
        typeof body.professionalClaimId === "string" ? body.professionalClaimId : null,
      client_id: typeof body.clientId === "string" ? body.clientId : null,
      posted_at: now,
      posted_by_user_id: actor.userId,
      metadata:
        typeof body.metadata === "object" && body.metadata !== null
          ? (body.metadata as Record<string, unknown>)
          : {},
    };

    const { data, error } = await supabase
      .from("payment_adjustments")
      .insert(insertRow)
      .select(
        "id, scope, adjustment_type, group_code, reason_code, reference_id, amount, description, source, posted_at, era_import_batch_id, era_claim_payment_id, professional_claim_id, client_id, metadata, created_at, updated_at",
      )
      .single();
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message ?? "Failed to insert adjustment" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, adjustment: shape(data as AdjustmentRow) });
  } catch (error) {
    if (error instanceof PaymentPostingUnauthenticatedError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 401 });
    }
    if (error instanceof PaymentPostingForbiddenError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Create adjustment failed" },
      { status: 500 },
    );
  }
}
