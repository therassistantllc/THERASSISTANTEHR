import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export interface Mark837PBatchSubmittedInput {
  organizationId: string;
  batchId: string;
  availityFileId?: string | null;
  submittedAt?: string | null;
}

export interface Mark837PBatchFailedInput {
  organizationId: string;
  batchId: string;
  reason: string;
}

export interface EdiSubmissionTrackingResult {
  ok: boolean;
  batchId: string;
  linkedClaimIds: string[];
  errors: Array<{ field: string; message: string }>;
}

type BatchRow = {
  id: string;
  organization_id: string;
  batch_status: string;
};

async function loadBatch(organizationId: string, batchId: string): Promise<BatchRow | null> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("claim_837p_batches")
    .select("id, organization_id, batch_status")
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as BatchRow | null;
}

async function loadLinkedClaimIds(organizationId: string, batchId: string): Promise<string[]> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("claim_837p_batch_claims")
    .select("professional_claim_id")
    .eq("organization_id", organizationId)
    .eq("batch_id", batchId)
    .is("archived_at", null);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { professional_claim_id: string }) => String(row.professional_claim_id));
}

export async function mark837PBatchSubmitted(
  input: Mark837PBatchSubmittedInput,
): Promise<EdiSubmissionTrackingResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const batch = await loadBatch(input.organizationId, input.batchId);
  if (!batch) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "claim_837p_batches", message: "837P batch not found for organization" }],
    };
  }

  if (!["generated", "ready_to_submit", "ready", "failed", "ready_to_generate"].includes(batch.batch_status)) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "claim_837p_batches.batch_status", message: `Batch status ${batch.batch_status} cannot be marked submitted` }],
    };
  }

  const linkedClaimIds = await loadLinkedClaimIds(input.organizationId, input.batchId);
  if (linkedClaimIds.length === 0) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "claim_837p_batch_claims", message: "837P batch has no linked claims" }],
    };
  }

  const submittedAt = input.submittedAt ?? new Date().toISOString();
  const { error: batchUpdateError } = await supabase
    .from("claim_837p_batches")
    .update({
      batch_status: "submitted",
      office_ally_transaction_id: input.availityFileId ?? undefined,
      submitted_at: submittedAt,
      last_submission_attempted_at: submittedAt,
      updated_at: submittedAt,
    })
    .eq("id", input.batchId)
    .eq("organization_id", input.organizationId);

  if (batchUpdateError) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds,
      errors: [{ field: "claim_837p_batches", message: batchUpdateError.message }],
    };
  }

  const { error: claimUpdateError } = await supabase
    .from("professional_claims")
    .update({ claim_status: "submitted", updated_at: new Date().toISOString() })
    .in("id", linkedClaimIds)
    .eq("organization_id", input.organizationId);

  if (claimUpdateError) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds,
      errors: [{ field: "professional_claims", message: claimUpdateError.message }],
    };
  }

  return { ok: true, batchId: input.batchId, linkedClaimIds, errors: [] };
}

export async function mark837PBatchSubmissionFailed(
  input: Mark837PBatchFailedInput,
): Promise<EdiSubmissionTrackingResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  const batch = await loadBatch(input.organizationId, input.batchId);
  if (!batch) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds: [],
      errors: [{ field: "claim_837p_batches", message: "837P batch not found for organization" }],
    };
  }

  const linkedClaimIds = await loadLinkedClaimIds(input.organizationId, input.batchId);
  const { error: batchUpdateError } = await supabase
    .from("claim_837p_batches")
    .update({
      batch_status: "failed",
      submission_error: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.batchId)
    .eq("organization_id", input.organizationId);

  if (batchUpdateError) {
    return {
      ok: false,
      batchId: input.batchId,
      linkedClaimIds,
      errors: [{ field: "claim_837p_batches", message: batchUpdateError.message }],
    };
  }

  return {
    ok: true,
    batchId: input.batchId,
    linkedClaimIds,
    errors: [{ field: "submission", message: input.reason }],
  };
}
