import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

export interface AssignClaimToAutoBatchInput {
  organizationId: string;
  claimId: string;
}

export interface AssignClaimToAutoBatchResult {
  ok: boolean;
  batchId: string | null;
  batchNumber: string | null;
  payerProfileId: string | null;
  billingProviderTaxId: string | null;
  error?: string;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function batchNumber(payerProfileId: string, taxId: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const payerTag = payerProfileId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const tinTag = taxId.replace(/\D/g, "").slice(-4) || "0000";
  return `AUTO-${stamp}-${payerTag}-${tinTag}`;
}

async function recomputeBatchTotals(params: { organizationId: string; batchId: string }) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data: links, error: linkError } = await supabase
    .from("claim_837p_batch_claims")
    .select("professional_claim_id")
    .eq("organization_id", params.organizationId)
    .eq("batch_id", params.batchId)
    .is("archived_at", null);
  if (linkError) throw new Error(linkError.message ?? "Failed to load batch claim links");

  const claimIds = ((links ?? []) as DbRow[]).map((l) => text(l.professional_claim_id)).filter(Boolean);

  let totalChargeAmount = 0;
  if (claimIds.length > 0) {
    const { data: claims, error: claimError } = await supabase
      .from("professional_claims")
      .select("id, total_charge")
      .eq("organization_id", params.organizationId)
      .in("id", claimIds)
      .is("archived_at", null);
    if (claimError) throw new Error(claimError.message ?? "Failed to load claims for batch totals");
    totalChargeAmount = ((claims ?? []) as DbRow[]).reduce((sum, c) => sum + number(c.total_charge), 0);
  }

  const { error: updateError } = await supabase
    .from("claim_837p_batches")
    .update({
      claim_count: claimIds.length,
      total_charge_amount: Math.round(totalChargeAmount * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", params.organizationId)
    .eq("id", params.batchId);

  if (updateError) throw new Error(updateError.message ?? "Failed to update batch totals");
}

export async function assignClaimToAutoBatch(
  input: AssignClaimToAutoBatchInput,
): Promise<AssignClaimToAutoBatchResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return { ok: false, batchId: null, batchNumber: null, payerProfileId: null, billingProviderTaxId: null, error: "Database connection not available" };
  }

  const { data: claim, error: claimError } = await supabase
    .from("professional_claims")
    .select("id, claim_status, payer_profile_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.claimId)
    .is("archived_at", null)
    .maybeSingle();
  if (claimError || !claim) {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId: null,
      billingProviderTaxId: null,
      error: "Claim not found for auto batching",
    };
  }

  const claimStatus = text(claim.claim_status);
  if (claimStatus !== "ready_for_batch" && claimStatus !== "batched") {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId: text(claim.payer_profile_id) || null,
      billingProviderTaxId: null,
      error: `Claim status ${claimStatus} is not eligible for auto batching`,
    };
  }

  const payerProfileId = text(claim.payer_profile_id);
  if (!payerProfileId) {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId: null,
      billingProviderTaxId: null,
      error: "Claim is missing payer profile id",
    };
  }

  const { data: snapshot, error: snapshotError } = await supabase
    .from("claim_parties_snapshot")
    .select("claim_id, billing_provider_tax_id")
    .eq("claim_id", input.claimId)
    .maybeSingle();
  if (snapshotError || !snapshot) {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId,
      billingProviderTaxId: null,
      error: "Claim party snapshot is missing for auto batching",
    };
  }

  const billingProviderTaxId = text(snapshot.billing_provider_tax_id);
  if (!billingProviderTaxId) {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId,
      billingProviderTaxId: null,
      error: "Claim is missing billing provider tax id",
    };
  }

  const { data: existingLink } = await supabase
    .from("claim_837p_batch_claims")
    .select("batch_id")
    .eq("organization_id", input.organizationId)
    .eq("professional_claim_id", input.claimId)
    .is("archived_at", null)
    .maybeSingle();

  if (existingLink?.batch_id) {
    const { data: existingBatch } = await supabase
      .from("claim_837p_batches")
      .select("id, batch_number")
      .eq("organization_id", input.organizationId)
      .eq("id", existingLink.batch_id)
      .maybeSingle();

    return {
      ok: true,
      batchId: text(existingBatch?.id) || text(existingLink.batch_id),
      batchNumber: text(existingBatch?.batch_number) || null,
      payerProfileId,
      billingProviderTaxId,
    };
  }

  let batchId: string | null = null;
  let selectedBatchNumber: string | null = null;

  const { data: openBatch } = await supabase
    .from("claim_837p_batches")
    .select("id, batch_number")
    .eq("organization_id", input.organizationId)
    .eq("batch_source", "charge_auto")
    .eq("payer_profile_id", payerProfileId)
    .eq("billing_provider_tax_id", billingProviderTaxId)
    .in("batch_status", ["draft", "ready_to_generate"])
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (openBatch?.id) {
    batchId = text(openBatch.id);
    selectedBatchNumber = text(openBatch.batch_number) || null;
  } else {
    const createdNumber = batchNumber(payerProfileId, billingProviderTaxId);
    const { data: inserted, error: insertError } = await supabase
      .from("claim_837p_batches")
      .insert({
        organization_id: input.organizationId,
        batch_number: createdNumber,
        batch_status: "draft",
        batch_source: "charge_auto",
        payer_profile_id: payerProfileId,
        billing_provider_tax_id: billingProviderTaxId,
      })
      .select("id, batch_number")
      .single();

    if (insertError || !inserted) {
      // Race-safe fallback: another request likely inserted the same open group.
      const { data: winner, error: winnerError } = await supabase
        .from("claim_837p_batches")
        .select("id, batch_number")
        .eq("organization_id", input.organizationId)
        .eq("batch_source", "charge_auto")
        .eq("payer_profile_id", payerProfileId)
        .eq("billing_provider_tax_id", billingProviderTaxId)
        .in("batch_status", ["draft", "ready_to_generate"])
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (winnerError || !winner?.id) {
        return {
          ok: false,
          batchId: null,
          batchNumber: null,
          payerProfileId,
          billingProviderTaxId,
          error: insertError?.message ?? winnerError?.message ?? "Failed to create auto batch",
        };
      }
      batchId = text(winner.id);
      selectedBatchNumber = text(winner.batch_number) || null;
    } else {
      batchId = text(inserted.id);
      selectedBatchNumber = text(inserted.batch_number) || null;
    }
  }

  if (!batchId) {
    return {
      ok: false,
      batchId: null,
      batchNumber: null,
      payerProfileId,
      billingProviderTaxId,
      error: "Failed to resolve target batch",
    };
  }

  const { error: linkError } = await supabase
    .from("claim_837p_batch_claims")
    .insert({
      organization_id: input.organizationId,
      batch_id: batchId,
      professional_claim_id: input.claimId,
    });

  if (linkError) {
    const message = text(linkError.message);
    if (!message.includes("duplicate") && !message.includes("unique")) {
      return {
        ok: false,
        batchId,
        batchNumber: selectedBatchNumber,
        payerProfileId,
        billingProviderTaxId,
        error: linkError.message ?? "Failed to link claim to auto batch",
      };
    }
  }

  try {
    await recomputeBatchTotals({ organizationId: input.organizationId, batchId });
  } catch (e) {
    return {
      ok: false,
      batchId,
      batchNumber: selectedBatchNumber,
      payerProfileId,
      billingProviderTaxId,
      error: e instanceof Error ? e.message : "Failed to update batch totals",
    };
  }

  await supabase
    .from("professional_claims")
    .update({ claim_status: "batched", updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("id", input.claimId)
    .in("claim_status", ["ready_for_batch", "batched"]);

  return {
    ok: true,
    batchId,
    batchNumber: selectedBatchNumber,
    payerProfileId,
    billingProviderTaxId,
  };
}
