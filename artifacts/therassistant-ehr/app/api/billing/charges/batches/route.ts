import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { rebuild837PBatchFile } from "@/lib/claims/rebuild837PBatchFile";

type DbRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

function makeBatchNumber(suffix?: number) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return suffix == null ? `CC-${stamp}` : `CC-${stamp}-${suffix}`;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function stampClaimsBatched(params: { supabase: any; organizationId: string; claimIds: string[] }) {
  const ids = [...new Set(params.claimIds.map(text).filter(Boolean))];
  if (!ids.length) return;

  const { error } = await params.supabase
    .from("professional_claims")
    .update({ claim_status: "batched", updated_at: new Date().toISOString() })
    .eq("organization_id", params.organizationId)
    .in("id", ids)
    .in("claim_status", ["ready_for_batch", "batched"])
    .is("archived_at", null);

  if (error) throw error;
}

async function loadBatches(params: { supabase: any; organizationId: string; limit: number; offset: number }) {
  const { data: batchesRaw, error } = await params.supabase
    .from("claim_837p_batches")
    .select("id, batch_number, batch_status, claim_count, total_charge_amount, generated_file_name, submitted_at, created_at, updated_at, payer_profile_id, billing_provider_tax_id")
    .eq("organization_id", params.organizationId)
    .is("archived_at", null)
    .in("batch_status", ["draft", "ready_to_generate", "generation_failed", "generated", "downloaded", "submitted", "accepted", "partially_accepted", "failed", "rejected"])
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) throw error;

  const batches = ((batchesRaw ?? []) as DbRow[]).map((batch) => ({
    id: text(batch.id),
    batchNumber: text(batch.batch_number) || text(batch.id).slice(0, 8),
    status: text(batch.batch_status),
    claimCount: Number(batch.claim_count ?? 0) || 0,
    totalChargeAmount: money(batch.total_charge_amount),
    generatedFileName: text(batch.generated_file_name) || null,
    submittedAt: text(batch.submitted_at) || null,
    createdAt: text(batch.created_at) || null,
    updatedAt: text(batch.updated_at) || null,
    payerProfileId: text(batch.payer_profile_id) || null,
    payerName: "Payer",
    billingProviderTaxId: text(batch.billing_provider_tax_id) || null,
    claims: [] as unknown[],
  }));

  const submittedBatchIds = new Set(batches.filter((b) => ["submitted", "accepted", "partially_accepted"].includes(b.status)).map((b) => b.id));
  const pendingBatches = batches.filter((b) => !submittedBatchIds.has(b.id)).length;
  const readyToSubmit = batches.filter((b) => ["generated", "downloaded"].includes(b.status) && !!b.generatedFileName).length;

  return {
    practiceOptions: [] as Array<{ value: string; label: string }>,
    pagination: { limit: params.limit, offset: params.offset, returned: batches.length, totalCount: batches.length, hasMore: batches.length === params.limit },
    totals: { totalUnbilledCharges: 0, pendingBatches, readyToSubmit },
    chargeRows: [] as unknown[],
    batches,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

    const payload = await loadBatches({ supabase, organizationId: guard.organizationId, limit, offset });
    return NextResponse.json({ success: true, clinicianOnly: false, canManage: true, ...payload });
  } catch (error) {
    console.error("Failed to load charge batches", error);
    return NextResponse.json({ success: false, error: "Failed to load charge batches" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { organizationId?: string; claimIds?: unknown; scopeAllReady?: unknown };
    const guard = await requireBillingAccess({ requestedOrganizationId: body.organizationId ?? null });
    if (guard instanceof NextResponse) return guard;

    const organizationId = guard.organizationId;
    const selectedClaimIds = Array.isArray(body.claimIds) ? [...new Set(body.claimIds.map((id) => text(id)).filter(Boolean))] : [];
    const scopeAllReady = body.scopeAllReady === true || body.scopeAllReady === 1 || String(body.scopeAllReady ?? "").toLowerCase() === "true";
    const explicitSelection = selectedClaimIds.length > 0;

    if (!explicitSelection && !scopeAllReady) return NextResponse.json({ success: false, error: "claimIds are required unless scopeAllReady=true is provided" }, { status: 400 });
    if (selectedClaimIds.length > 5000) return NextResponse.json({ success: false, error: "At most 5000 claimIds can be submitted per request" }, { status: 400 });

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    let readyQuery = supabase
      .from("professional_claims")
      .select("id, total_charge, payer_profile_id, created_at")
      .eq("organization_id", organizationId)
      .eq("claim_status", "ready_for_batch")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (explicitSelection) readyQuery = readyQuery.in("id", selectedClaimIds);

    const readyClaims: DbRow[] = [];
    if (explicitSelection) {
      const { data, error } = await readyQuery;
      if (error) throw error;
      readyClaims.push(...((data ?? []) as DbRow[]));
    } else {
      let from = 0;
      const pageSize = 500;
      while (true) {
        const { data, error } = await readyQuery.range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as DbRow[];
        readyClaims.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }

    const readyIds = readyClaims.map((claim) => text(claim.id)).filter(Boolean);
    const { data: linkedRows, error: linkedError } = readyIds.length
      ? await supabase.from("claim_837p_batch_claims").select("professional_claim_id").eq("organization_id", organizationId).in("professional_claim_id", readyIds).is("archived_at", null)
      : { data: [] as DbRow[], error: null };
    if (linkedError) throw linkedError;

    const alreadyLinked = new Set(((linkedRows ?? []) as DbRow[]).map((row) => text(row.professional_claim_id)).filter(Boolean));
    const unbatched = readyClaims.filter((claim) => !alreadyLinked.has(text(claim.id)));
    const groups = new Map<string, DbRow[]>();
    for (const claim of unbatched) {
      const key = text(claim.payer_profile_id) || "__no_payer__";
      const rows = groups.get(key) ?? [];
      rows.push(claim);
      groups.set(key, rows);
    }

    const createdBatches: Array<{ batchId: string; batchNumber: string; claimCount: number; totalChargeAmount: number; claimIds: string[] }> = [];
    const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < orderedGroups.length; i++) {
      const [payerProfileKey, rows] = orderedGroups[i];
      for (const chunk of chunkRows(rows, 5000)) {
        const ids = chunk.map((claim) => text(claim.id)).filter(Boolean);
        const totalChargeAmount = chunk.reduce((sum, claim) => sum + money(claim.total_charge), 0);
        const batchNumber = orderedGroups.length === 1 ? makeBatchNumber() : makeBatchNumber(i + 1);
        const payerProfileId = payerProfileKey === "__no_payer__" ? null : payerProfileKey;
        const { data: rpcData, error: rpcError } = await (supabase as any).rpc("create_837p_batch_atomic", { p_organization_id: organizationId, p_claim_ids: ids, p_batch_number: batchNumber, p_payer_profile_id: payerProfileId });
        if (rpcError) throw new Error(rpcError.message ?? "Batch creation failed");
        const result = (rpcData ?? {}) as { batch_id?: string; batch_number?: string };
        if (!result.batch_id) throw new Error("Batch creation returned no batch id");
        await stampClaimsBatched({ supabase, organizationId, claimIds: ids });
        createdBatches.push({ batchId: result.batch_id, batchNumber: result.batch_number ?? batchNumber, claimCount: ids.length, totalChargeAmount: Math.round(totalChargeAmount * 100) / 100, claimIds: ids });
      }
    }

    if (!createdBatches.length) return NextResponse.json({ success: true, batchesCreated: 0, generationMode: "eager", jobsQueued: 0, selectionMode: explicitSelection ? "explicit" : "auto", scannedReadyClaims: readyClaims.length, claimsQueued: 0, existingBatchesRegenerated: 0, batches: [], message: "No unbatched ready claims were found." });

    const generationResults = await Promise.allSettled(createdBatches.map((batch) => rebuild837PBatchFile({ batchId: batch.batchId, organizationId })));
    const outputBatches = createdBatches.map((batch, index) => {
      const result = generationResults[index];
      const generated = result.status === "fulfilled" && result.value.ok;
      const generationError = result.status === "rejected" ? String(result.reason) : result.status === "fulfilled" && !result.value.ok ? result.value.error ?? "837P generation failed" : null;
      return { ...batch, source: "created", generated, generationError, generationDeferred: false };
    });

    const failedGenerationCount = outputBatches.filter((batch) => !batch.generated).length;
    const firstGenerationError = outputBatches.find((batch) => !batch.generated)?.generationError ?? null;
    const totalClaimsCovered = createdBatches.reduce((sum, batch) => sum + batch.claimCount, 0);

    return NextResponse.json({ success: failedGenerationCount === 0, error: failedGenerationCount > 0 ? firstGenerationError ?? "Failed to generate one or more 837P batch files" : undefined, batchesCreated: createdBatches.length, generationMode: "eager", jobsQueued: 0, selectionMode: explicitSelection ? "explicit" : "auto", scannedReadyClaims: readyClaims.length, claimsQueued: totalClaimsCovered, existingBatchesRegenerated: 0, message: failedGenerationCount > 0 ? `${failedGenerationCount} batch file${failedGenerationCount === 1 ? "" : "s"} failed to generate.` : `Generated ${createdBatches.length} new batch${createdBatches.length === 1 ? "" : "es"} and built 837P files.`, batches: outputBatches });
  } catch (error) {
    console.error("Charge batch generation failed", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to generate charge batches" }, { status: 500 });
  }
}
