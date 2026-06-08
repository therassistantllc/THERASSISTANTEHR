import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { rebuild276BatchFile } from "@/lib/claims/rebuild276BatchFile";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function makeBatchNumber(suffix?: number): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return suffix == null ? `276-${stamp}` : `276-${stamp}-${suffix}`;
}

function getMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return String((err as { message?: unknown }).message);
  }
  return "Failed to create 276 batches";
}

interface CreateBody {
  organizationId?: string;
  claimIds?: string[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const sb = supabase as any;
    const { data: rows, error } = await sb
      .from("claim_276_batches")
      .select("id, batch_number, batch_status, claim_count, payer_id, billing_provider_tax_id, generated_file_name, generated_at, downloaded_at, submitted_at, created_at")
      .eq("organization_id", guard.organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw error;

    return NextResponse.json({ success: true, batches: rows ?? [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: getMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;

    const claimIds = Array.from(new Set((body.claimIds ?? []).map((v) => text(v)).filter(Boolean)));
    if (claimIds.length === 0) {
      return NextResponse.json({ success: false, error: "claimIds is required" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const sb = supabase as any;

    const [{ data: claimRows, error: claimErr }, { data: partiesRows, error: partiesErr }] = await Promise.all([
      sb
        .from("professional_claims")
        .select("id, claim_number, claim_status")
        .eq("organization_id", guard.organizationId)
        .in("id", claimIds)
        .is("archived_at", null),
      sb
        .from("claim_parties_snapshot")
        .select("claim_id, payer_id, billing_provider_npi, billing_provider_tax_id")
        .in("claim_id", claimIds),
    ]);

    if (claimErr) throw claimErr;
    if (partiesErr) throw partiesErr;

    const claimById = new Map<string, Row>(((claimRows ?? []) as Row[]).map((r) => [text(r.id), r]));
    const partiesByClaim = new Map<string, Row>(((partiesRows ?? []) as Row[]).map((r) => [text(r.claim_id), r]));

    const excludedClaims: Array<{ claimId: string; claimNumber: string; reasons: string[] }> = [];
    const groups = new Map<string, string[]>();

    for (const claimId of claimIds) {
      const claim = claimById.get(claimId);
      const parties = partiesByClaim.get(claimId);
      const reasons: string[] = [];

      if (!claim) reasons.push("Claim not found");

      const status = text(claim?.claim_status).toLowerCase();
      if (status && !["batched", "submitted", "accepted_oa", "rejected_oa", "accepted_payer", "adjudicated", "partial", "denied"].includes(status)) {
        reasons.push(`Claim status ${status} is not eligible for 276 batching`);
      }

      const payerId = text(parties?.payer_id);
      const billingNpi = text(parties?.billing_provider_npi);
      const billingTin = text(parties?.billing_provider_tax_id).replace(/\D/g, "");
      if (!payerId) reasons.push("Missing payer ID in claim parties snapshot");
      if (!billingNpi) reasons.push("Missing billing provider NPI");
      if (!billingTin) reasons.push("Missing billing provider tax ID");

      const claimNumber = text(claim?.claim_number) || claimId.slice(0, 8);
      if (reasons.length > 0) {
        excludedClaims.push({ claimId, claimNumber, reasons });
        continue;
      }

      const key = `${payerId}::${billingNpi}::${billingTin}`;
      const group = groups.get(key) ?? [];
      group.push(claimId);
      groups.set(key, group);
    }

    if (groups.size === 0) {
      return NextResponse.json(
        { success: false, error: "No eligible claims selected", excludedClaims },
        { status: 422 },
      );
    }

    const createdBatches: Array<{ batchId: string; batchNumber: string; claimCount: number; generationError: string | null }> = [];

    const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < orderedGroups.length; i++) {
      const [key, ids] = orderedGroups[i];
      const [payerId, billingProviderNpi, billingProviderTaxId] = key.split("::");
      const batchNumber = orderedGroups.length === 1 ? makeBatchNumber() : makeBatchNumber(i + 1);

      const { data: inserted, error: batchErr } = await sb
        .from("claim_276_batches")
        .insert({
          organization_id: guard.organizationId,
          batch_number: batchNumber,
          batch_status: "ready_to_generate",
          batch_source: "claims_workspace",
          payer_id: payerId,
          billing_provider_npi: billingProviderNpi,
          billing_provider_tax_id: billingProviderTaxId,
          claim_count: ids.length,
        })
        .select("id, batch_number")
        .single();
      if (batchErr) throw batchErr;

      const batchId = text((inserted as Row).id);
      const links = ids.map((claimId) => {
        const claim = claimById.get(claimId);
        return {
          organization_id: guard.organizationId,
          batch_id: batchId,
          professional_claim_id: claimId,
          patient_account_number: text(claim?.claim_number) || claimId.slice(0, 20),
          trace_number: `${batchNumber}-${claimId}`.slice(0, 50),
        };
      });

      const { error: linkErr } = await sb.from("claim_276_batch_claims").insert(links);
      if (linkErr) throw linkErr;

      const rebuild = await rebuild276BatchFile({ batchId, organizationId: guard.organizationId });
      createdBatches.push({
        batchId,
        batchNumber: text((inserted as Row).batch_number) || batchNumber,
        claimCount: ids.length,
        generationError: rebuild.ok ? null : rebuild.error ?? "Failed to generate 276 content",
      });

      // Audit each included claim for traceability.
      await sb.from("claim_status_events").insert(
        ids.map((claimId) => ({
          claim_id: claimId,
          source: "clearinghouse",
          status: "status_inquiry_batched",
          status_message: `Claim added to 276 batch ${batchNumber}`,
          raw_payload: {
            action: "batch_276_created",
            batch_id: batchId,
            batch_number: batchNumber,
            payer_id: payerId,
            billing_provider_tax_id: billingProviderTaxId,
          },
        })),
      );
    }

    return NextResponse.json({
      success: true,
      batchesCreated: createdBatches.length,
      batches: createdBatches,
      excludedClaims,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: getMessage(error) }, { status: 500 });
  }
}
