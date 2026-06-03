import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { getProviderIdForUser } from "@/lib/rbac/auth";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { rebuild837PBatchFile } from "@/lib/claims/rebuild837PBatchFile";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isClinicianScoped(roles: string[]) {
  const hasClinician = roles.includes("clinician");
  const hasExpandedAccess = roles.some((r) =>
    ["admin", "biller", "supervisor", "support"].includes(r),
  );
  return hasClinician && !hasExpandedAccess;
}

function isMissingRpcError(error: unknown) {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "PGRST202";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    if (m.includes("not authenticated")) return "Not authenticated";
    if (m.includes("forbidden")) return "Forbidden";
  }
  return "Failed to load charge batches";
}

function makeBatchNumber(suffix?: number) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return suffix == null ? `CC-${stamp}` : `CC-${stamp}-${suffix}`;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function loadCanonical837PBatches({
  supabase,
  organizationId,
  limit,
  offset,
}: {
  supabase: any;
  organizationId: string;
  limit: number;
  offset: number;
}) {
  const { data: batchRowsRaw, error: batchError } = await supabase
    .from("claim_837p_batches")
    .select(
      "id, batch_number, batch_status, claim_count, total_charge_amount, generated_file_name, submitted_at, created_at, updated_at, payer_profile_id, billing_provider_tax_id",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .in("batch_status", ["draft", "ready_to_generate", "generation_failed", "generated", "submitted", "accepted", "failed", "rejected"])
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (batchError) throw batchError;

  const batchRows = (batchRowsRaw ?? []) as DbRow[];
  const batchIds = batchRows.map((b) => text(b.id)).filter(Boolean);
  const payerIds = [...new Set(batchRows.map((b) => text(b.payer_profile_id)).filter(Boolean))];

  const { data: linksRaw, error: linksError } = batchIds.length
    ? await supabase
        .from("claim_837p_batch_claims")
        .select("batch_id, professional_claim_id")
        .eq("organization_id", organizationId)
        .in("batch_id", batchIds)
        .is("archived_at", null)
    : { data: [] as DbRow[], error: null };
  if (linksError) throw linksError;

  const claimIds = [...new Set(((linksRaw ?? []) as DbRow[]).map((l) => text(l.professional_claim_id)).filter(Boolean))];
  const { data: claimsRaw, error: claimsError } = claimIds.length
    ? await supabase
        .from("professional_claims")
        .select("id, patient_id, client_id, claim_number, claim_status, total_charge, payer_profile_id, rendering_provider_last_name_or_org, rendering_provider_first_name")
        .eq("organization_id", organizationId)
        .in("id", claimIds)
        .is("archived_at", null)
    : { data: [] as DbRow[], error: null };
  if (claimsError) throw claimsError;

  const clientIds = [...new Set(((claimsRaw ?? []) as DbRow[]).map((c) => text(c.patient_id) || text(c.client_id)).filter(Boolean))];
  const { data: clientsRaw, error: clientsError } = clientIds.length
    ? await supabase.from("clients").select("id, first_name, last_name").in("id", clientIds)
    : { data: [] as DbRow[], error: null };
  if (clientsError) throw clientsError;

  const { data: payersRaw, error: payersError } = payerIds.length
    ? await supabase.from("payer_profiles").select("id, payer_name").in("id", payerIds)
    : { data: [] as DbRow[], error: null };
  if (payersError) throw payersError;

  const { data: lineRowsRaw, error: lineError } = claimIds.length
    ? await supabase
        .from("professional_claim_service_lines")
        .select("id, claim_id, line_number, service_date_from, procedure_code, charge_amount")
        .in("claim_id", claimIds)
    : { data: [] as DbRow[], error: null };
  if (lineError) throw lineError;

  const clientById = new Map<string, DbRow>(((clientsRaw ?? []) as DbRow[]).map((c) => [text(c.id), c]));
  const payerNameById = new Map<string, string>(((payersRaw ?? []) as DbRow[]).map((p) => [text(p.id), text(p.payer_name) || "Payer"]));
  const claimById = new Map<string, DbRow>(((claimsRaw ?? []) as DbRow[]).map((c) => [text(c.id), c]));

  const linesByClaimId = new Map<string, DbRow[]>();
  for (const line of (lineRowsRaw ?? []) as DbRow[]) {
    const claimId = text(line.claim_id);
    if (!claimId) continue;
    const rows = linesByClaimId.get(claimId) ?? [];
    rows.push(line);
    linesByClaimId.set(claimId, rows);
  }

  const claimIdsByBatchId = new Map<string, string[]>();
  for (const link of (linksRaw ?? []) as DbRow[]) {
    const batchId = text(link.batch_id);
    const claimId = text(link.professional_claim_id);
    if (!batchId || !claimId) continue;
    const rows = claimIdsByBatchId.get(batchId) ?? [];
    rows.push(claimId);
    claimIdsByBatchId.set(batchId, rows);
  }

  const practiceSet = new Set<string>();

  const batches = batchRows.map((batch) => {
    const batchId = text(batch.id);
    const claimIdsForBatch = claimIdsByBatchId.get(batchId) ?? [];
    const claims = claimIdsForBatch.map((claimId) => {
      const claim = claimById.get(claimId) ?? {};
      const client = clientById.get(text(claim.patient_id) || text(claim.client_id));
      const patientName = client
        ? [client.first_name, client.last_name].map(text).filter(Boolean).join(" ")
        : "Unknown Client";
      const providerName = [claim.rendering_provider_first_name, claim.rendering_provider_last_name_or_org]
        .map(text)
        .filter(Boolean)
        .join(" ") || "—";
      const serviceLinesRaw = linesByClaimId.get(claimId) ?? [];
      return {
        id: claimId,
        claimNumber: text(claim.claim_number) || claimId.slice(0, 8),
        status: text(claim.claim_status),
        totalCharge: money(claim.total_charge),
        practiceId: null,
        patientName,
        providerName,
        serviceLines: serviceLinesRaw.map((line) => ({
          id: text(line.id) || `${claimId}-${text(line.line_number) || "1"}`,
          lineNumber: Number(line.line_number ?? 0) || 0,
          dateOfService: text(line.service_date_from) || null,
          procedureCode: text(line.procedure_code) || "—",
          chargeAmount: money(line.charge_amount),
        })),
      };
    });

    return {
      id: batchId,
      batchNumber: text(batch.batch_number) || batchId.slice(0, 8),
      status: text(batch.batch_status),
      claimCount: Number(batch.claim_count ?? claims.length) || claims.length,
      totalChargeAmount: money(batch.total_charge_amount),
      generatedFileName: text(batch.generated_file_name) || null,
      submittedAt: text(batch.submitted_at) || null,
      createdAt: text(batch.created_at) || null,
      updatedAt: text(batch.updated_at) || null,
      payerProfileId: text(batch.payer_profile_id) || null,
      payerName: text(batch.payer_profile_id) ? payerNameById.get(text(batch.payer_profile_id)) ?? "Payer" : "Payer",
      billingProviderTaxId: text(batch.billing_provider_tax_id) || null,
      claims,
    };
  });

  const chargeRows = batches.flatMap((batch) =>
    batch.claims.flatMap((claim) => {
      if (!claim.serviceLines.length) {
        return [
          {
            chargeId: `${claim.id}-1`,
            claimId: claim.id,
            patientName: claim.patientName,
            dateOfService: null,
            providerName: claim.providerName,
            cptCode: "—",
            billedAmount: claim.totalCharge,
            status: claim.status,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            submitDate: batch.submittedAt,
            notes: "837P batch",
          },
        ];
      }
      return claim.serviceLines.map((line) => ({
        chargeId: line.id,
        claimId: claim.id,
        patientName: claim.patientName,
        dateOfService: line.dateOfService,
        providerName: claim.providerName,
        cptCode: line.procedureCode,
        billedAmount: line.chargeAmount,
        status: claim.status,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        submitDate: batch.submittedAt,
        notes: "837P batch",
      }));
    }),
  );

  const submittedBatchIds = new Set(
    batches.filter((b) => ["submitted", "accepted"].includes((b.status || "").toLowerCase())).map((b) => b.id),
  );
  const totalUnbilledCharges = Math.round(
    chargeRows.filter((row) => !submittedBatchIds.has(row.batchId)).reduce((sum, row) => sum + Number(row.billedAmount ?? 0), 0) * 100,
  ) / 100;
  const pendingBatches = batches.filter((b) => !["submitted", "accepted"].includes((b.status || "").toLowerCase())).length;
  const readyToSubmit = batches.filter((b) => ["generated"].includes((b.status || "").toLowerCase()) && !!b.generatedFileName).length;

  return {
    practiceOptions: Array.from(practiceSet).sort().map((p) => ({ value: p, label: p })),
    pagination: {
      limit,
      offset,
      returned: batches.length,
      totalCount: batches.length,
      hasMore: batches.length === limit,
    },
    totals: { totalUnbilledCharges, pendingBatches, readyToSubmit },
    chargeRows,
    batches,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const practiceFilter = text(searchParams.get("practice"));
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

    const clinicianOnly = isClinicianScoped(guard.roles ?? []);
    const providerId = clinicianOnly && guard.userId ? await getProviderIdForUser(guard.userId, guard.organizationId) : null;

    const emptyPayload = {
      success: true,
      clinicianOnly,
      canManage: !clinicianOnly,
      practiceOptions: [] as Array<{ value: string; label: string }>,
      pagination: { limit, offset, returned: 0, totalCount: 0, hasMore: false },
      totals: { totalUnbilledCharges: 0, pendingBatches: 0, readyToSubmit: 0 },
      chargeRows: [] as unknown[],
      batches: [] as unknown[],
    };

    if (clinicianOnly && !providerId) return NextResponse.json({ ...emptyPayload, canManage: false });

    try {
      const { data, error } = await (supabase as any).rpc("billing_charge_batches_page", {
        p_organization_id: guard.organizationId,
        p_practice: practiceFilter || null,
        p_provider_id: clinicianOnly ? providerId : null,
        p_limit: limit,
        p_offset: offset,
      });

      if (error && !isMissingRpcError(error)) throw error;

      const rpcRows = (data ?? []) as DbRow[];
      if (!error && rpcRows.length > 0) {
        const totalCount = Number(rpcRows[0].total_count ?? rpcRows.length);
        const practiceSet = new Set<string>();
        const batches = rpcRows.map((r) => {
          const rawClaims = Array.isArray(r.claims) ? (r.claims as DbRow[]) : [];
          const claims = rawClaims.map((claim) => {
            const serviceLinesRaw = Array.isArray(claim.serviceLines) ? (claim.serviceLines as DbRow[]) : [];
            const practiceId = text(claim.practiceId) || null;
            if (practiceId) practiceSet.add(practiceId);
            return {
              id: text(claim.id),
              claimNumber: text(claim.claimNumber) || text(claim.id).slice(0, 8),
              status: text(claim.status),
              totalCharge: money(claim.totalCharge),
              practiceId,
              patientName: text(claim.patientName) || "Unknown Client",
              providerName: text(claim.providerName) || "—",
              serviceLines: serviceLinesRaw.map((line) => ({
                id: text(line.id) || `${text(claim.id)}-${text(line.lineNumber) || "1"}`,
                lineNumber: Number(line.lineNumber ?? 0) || 0,
                dateOfService: text(line.dateOfService) || null,
                procedureCode: text(line.procedureCode) || "—",
                chargeAmount: money(line.chargeAmount),
              })),
            };
          });
          return {
            id: text(r.id),
            batchNumber: text(r.batch_number) || text(r.id).slice(0, 8),
            status: text(r.batch_status),
            claimCount: Number(r.claim_count ?? claims.length) || claims.length,
            totalChargeAmount: money(r.total_charge_amount),
            generatedFileName: text(r.generated_file_name) || null,
            submittedAt: text(r.submitted_at) || null,
            createdAt: text(r.created_at) || null,
            updatedAt: text(r.updated_at) || null,
            payerProfileId: text(r.payer_profile_id) || null,
            payerName: text(r.payer_name) || "Payer",
            billingProviderTaxId: text(r.billing_provider_tax_id) || null,
            claims,
          };
        });
        const chargeRows = batches.flatMap((batch) => batch.claims.flatMap((claim) => claim.serviceLines.length ? claim.serviceLines.map((line) => ({ chargeId: line.id, claimId: claim.id, patientName: claim.patientName, dateOfService: line.dateOfService, providerName: claim.providerName, cptCode: line.procedureCode, billedAmount: line.chargeAmount, status: claim.status, batchId: batch.id, batchNumber: batch.batchNumber, submitDate: batch.submittedAt, notes: "Auto-batched by payer/TIN" })) : [{ chargeId: `${claim.id}-1`, claimId: claim.id, patientName: claim.patientName, dateOfService: null, providerName: claim.providerName, cptCode: "—", billedAmount: claim.totalCharge, status: claim.status, batchId: batch.id, batchNumber: batch.batchNumber, submitDate: batch.submittedAt, notes: "Auto-batched by payer/TIN" }]));
        const submittedBatchIds = new Set(batches.filter((b) => ["submitted", "accepted"].includes((b.status || "").toLowerCase())).map((b) => b.id));
        const totalUnbilledCharges = Math.round(chargeRows.filter((row) => !submittedBatchIds.has(row.batchId)).reduce((sum, row) => sum + Number(row.billedAmount ?? 0), 0) * 100) / 100;
        const pendingBatches = batches.filter((b) => !["submitted", "accepted"].includes((b.status || "").toLowerCase())).length;
        const readyToSubmit = batches.filter((b) => ["generated"].includes((b.status || "").toLowerCase()) && !!b.generatedFileName).length;
        return NextResponse.json({ success: true, clinicianOnly, canManage: !clinicianOnly, practiceOptions: Array.from(practiceSet).sort().map((p) => ({ value: p, label: p })), pagination: { limit, offset, returned: batches.length, totalCount, hasMore: offset + batches.length < totalCount }, totals: { totalUnbilledCharges, pendingBatches, readyToSubmit }, chargeRows, batches });
      }
    } catch (error) {
      console.warn("billing_charge_batches_page RPC failed; falling back to canonical claim_837p_batches", error);
    }

    const fallback = await loadCanonical837PBatches({ supabase, organizationId: guard.organizationId, limit, offset });
    return NextResponse.json({ success: true, clinicianOnly, canManage: !clinicianOnly, ...fallback });
  } catch (error) {
    console.error("Failed to load charge batches", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
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

    let existingProcessable: Array<{ batchId: string; batchNumber: string; claimCount: number }> = [];
    const { data: existingBatchesRaw, error: existingBatchesError } = await supabase
      .from("claim_837p_batches")
      .select("id, batch_number, batch_status, generated_file_name, batch_source")
      .eq("organization_id", organizationId)
      .in("batch_status", ["draft", "ready_to_generate", "generation_failed", "generated"])
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (existingBatchesError) throw existingBatchesError;
    const existingBatchRows = (existingBatchesRaw ?? []) as DbRow[];
    const existingBatchIds = existingBatchRows.map((b) => text(b.id)).filter(Boolean);
    const { data: existingLinksRaw, error: existingLinksError } = existingBatchIds.length > 0
      ? await supabase.from("claim_837p_batch_claims").select("batch_id, professional_claim_id").eq("organization_id", organizationId).in("batch_id", existingBatchIds).is("archived_at", null)
      : { data: [] as DbRow[], error: null };
    if (existingLinksError) throw existingLinksError;
    const existingClaimCountsByBatchId = new Map<string, number>();
    for (const link of (existingLinksRaw ?? []) as DbRow[]) {
      const batchId = text(link.batch_id);
      if (batchId) existingClaimCountsByBatchId.set(batchId, (existingClaimCountsByBatchId.get(batchId) ?? 0) + 1);
    }
    existingProcessable = existingBatchRows.filter((b) => (existingClaimCountsByBatchId.get(text(b.id)) ?? 0) > 0).map((b) => ({ batchId: text(b.id), batchNumber: text(b.batch_number) || text(b.id).slice(0, 8), claimCount: existingClaimCountsByBatchId.get(text(b.id)) ?? 0 }));

    let readyClaimsQuery = supabase.from("professional_claims").select("id, claim_status, total_charge, payer_profile_id, created_at").eq("organization_id", organizationId).eq("claim_status", "ready_for_batch").is("archived_at", null).order("created_at", { ascending: true });
    if (explicitSelection) readyClaimsQuery = readyClaimsQuery.in("id", selectedClaimIds);
    const allReady: DbRow[] = [];
    if (explicitSelection) {
      const { data, error } = await readyClaimsQuery;
      if (error) throw error;
      allReady.push(...((data ?? []) as DbRow[]));
    } else {
      const pageSize = 500;
      let from = 0;
      while (true) {
        const { data, error } = await readyClaimsQuery.range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as DbRow[];
        allReady.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }

    const readyIds = allReady.map((c) => text(c.id)).filter(Boolean);
    const { data: readyLinksRaw, error: readyLinksError } = readyIds.length > 0
      ? await supabase.from("claim_837p_batch_claims").select("professional_claim_id, batch_id").eq("organization_id", organizationId).in("professional_claim_id", readyIds).is("archived_at", null)
      : { data: [] as DbRow[], error: null };
    if (readyLinksError) throw readyLinksError;
    const alreadyLinkedClaimIds = new Set(((readyLinksRaw ?? []) as DbRow[]).map((r) => text(r.professional_claim_id)).filter(Boolean));
    const unbatched = allReady.filter((c) => !alreadyLinkedClaimIds.has(text(c.id)));
    const unbatchedIds = unbatched.map((c) => text(c.id)).filter(Boolean);
    const { data: partySnapshotsRaw, error: partySnapshotError } = unbatchedIds.length > 0 ? await supabase.from("claim_parties_snapshot").select("claim_id, billing_provider_tax_id").in("claim_id", unbatchedIds) : { data: [] as DbRow[], error: null };
    if (partySnapshotError) throw partySnapshotError;
    const billingTinByClaimId = new Map<string, string>();
    for (const row of (partySnapshotsRaw ?? []) as DbRow[]) {
      const claimId = text(row.claim_id);
      const tin = text(row.billing_provider_tax_id);
      if (claimId && tin && !billingTinByClaimId.has(claimId)) billingTinByClaimId.set(claimId, tin);
    }
    const groups = new Map<string, { payerProfileId: string | null; billingProviderTaxId: string | null; rows: DbRow[] }>();
    for (const claim of unbatched) {
      const payerProfileId = text(claim.payer_profile_id) || null;
      const billingProviderTaxId = billingTinByClaimId.get(text(claim.id)) ?? null;
      const key = `${payerProfileId ?? "__no_payer__"}::${billingProviderTaxId ?? "__no_tin__"}`;
      const group = groups.get(key) ?? { payerProfileId, billingProviderTaxId, rows: [] };
      group.rows.push(claim);
      groups.set(key, group);
    }
    const orderedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    const createdBatches: Array<{ batchId: string; batchNumber: string; payerProfileId: string | null; billingProviderTaxId: string | null; claimCount: number; totalChargeAmount: number; claimIds: string[] }> = [];
    for (let i = 0; i < orderedGroups.length; i++) {
      const [, group] = orderedGroups[i];
      const rowChunks = chunkRows(group.rows, 5000);
      for (let chunkIndex = 0; chunkIndex < rowChunks.length; chunkIndex++) {
        const chunk = rowChunks[chunkIndex];
        const ids = chunk.map((c) => text(c.id)).filter(Boolean);
        const totalChargeAmount = chunk.reduce((sum, row) => sum + money(row.total_charge), 0);
        const batchNumber = orderedGroups.length === 1 && rowChunks.length === 1 ? makeBatchNumber() : makeBatchNumber(Number(`${i + 1}${chunkIndex + 1}`));
        const { data: rpcData, error: rpcError } = await (supabase as any).rpc("create_837p_batch_atomic", { p_organization_id: organizationId, p_claim_ids: ids, p_batch_number: batchNumber, p_payer_profile_id: group.payerProfileId });
        if (rpcError) throw new Error(rpcError.message ?? "Batch creation failed");
        const result = (rpcData ?? {}) as { batch_id?: string; batch_number?: string };
        if (!result.batch_id) throw new Error("Batch creation returned no batch id");
        const { error: stampError } = await supabase.from("claim_837p_batches").update({ batch_source: "charge_auto", billing_provider_tax_id: group.billingProviderTaxId, updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("id", result.batch_id);
        if (stampError) throw stampError;
        createdBatches.push({ batchId: result.batch_id, batchNumber: result.batch_number ?? batchNumber, payerProfileId: group.payerProfileId, billingProviderTaxId: group.billingProviderTaxId, claimCount: chunk.length, totalChargeAmount: Math.round(totalChargeAmount * 100) / 100, claimIds: ids });
      }
    }
    const processedBatchMap = new Map<string, { batchId: string; batchNumber: string; payerProfileId: string | null; billingProviderTaxId: string | null; claimCount: number; totalChargeAmount: number; claimIds: string[]; source: "existing" | "created" }>();
    for (const batch of existingProcessable) processedBatchMap.set(batch.batchId, { batchId: batch.batchId, batchNumber: batch.batchNumber, payerProfileId: null, billingProviderTaxId: null, claimCount: batch.claimCount, totalChargeAmount: 0, claimIds: [], source: "existing" });
    for (const batch of createdBatches) processedBatchMap.set(batch.batchId, { ...batch, source: "created" });
    const processedBatches = Array.from(processedBatchMap.values());
    if (processedBatches.length === 0) return NextResponse.json({ success: true, batchesCreated: 0, generationMode: "eager", jobsQueued: 0, selectionMode: explicitSelection ? "explicit" : "auto", scannedReadyClaims: allReady.length, claimsQueued: 0, existingBatchesRegenerated: 0, batches: [], message: "No ready batches or unbatched ready claims were found." });
    const batchResults = await Promise.allSettled(processedBatches.map((batch) => rebuild837PBatchFile({ batchId: batch.batchId, organizationId })));
    const outputBatches = processedBatches.map((batch, index) => {
      const result = batchResults[index];
      const generated = result.status === "fulfilled" && result.value.ok;
      const generationError = result.status === "rejected" ? String(result.reason) : result.status === "fulfilled" && !result.value.ok ? result.value.error ?? "837P generation failed" : null;
      return { batchId: batch.batchId, batchNumber: batch.batchNumber, payerProfileId: batch.payerProfileId, billingProviderTaxId: batch.billingProviderTaxId, claimCount: batch.claimCount, totalChargeAmount: batch.totalChargeAmount, source: batch.source, generated, generationError, generationDeferred: false };
    });
    const failedGenerationCount = outputBatches.filter((b) => !b.generated).length;
    const existingRegenerated = outputBatches.filter((b) => b.source === "existing").length;
    const totalClaimsCovered = processedBatches.reduce((sum, b) => sum + b.claimCount, 0);
    const firstGenerationError = outputBatches.find((b) => !b.generated)?.generationError ?? null;
    return NextResponse.json({ success: failedGenerationCount === 0, error: failedGenerationCount > 0 ? firstGenerationError ?? "Failed to generate one or more 837P batch files" : undefined, batchesCreated: createdBatches.length, generationMode: "eager", jobsQueued: 0, selectionMode: explicitSelection ? "explicit" : "auto", scannedReadyClaims: allReady.length, claimsQueued: totalClaimsCovered, existingBatchesRegenerated: existingRegenerated, message: failedGenerationCount > 0 ? `${failedGenerationCount} batch file${failedGenerationCount === 1 ? "" : "s"} failed to generate.` : createdBatches.length === 0 && existingRegenerated > 0 ? `Generated 837P files for ${existingRegenerated} existing batch${existingRegenerated === 1 ? "" : "es"}.` : `Generated ${createdBatches.length} new batch${createdBatches.length === 1 ? "" : "es"} and built 837P files.`, batches: outputBatches });
  } catch (error) {
    console.error("Charge batch generation failed", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to generate charge batches" }, { status: 500 });
  }
}
