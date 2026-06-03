import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { routeRejectedClaimsToWorkqueue } from "@/lib/workqueue/claimRejectionWorkqueueService";
import {
  detect277CADocumentationRequest,
  writeMedicalReviewRequestAudit,
} from "@/lib/medical-review/documentationRequestDetection";

type Edi277CAOutcome = "accepted" | "rejected" | "partial" | "unknown";

export interface Intake277CAAcknowledgementInput {
  organizationId: string;
  batchId?: string | null;
  fileName?: string | null;
  rawContent: string;
}

export interface Intake277CAAcknowledgementResult {
  ok: boolean;
  acknowledgementId: string | null;
  batchId: string | null;
  outcome: Edi277CAOutcome;
  linkedClaimIds: string[];
  errors: Array<{ field: string; message: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRecord = Record<string, any>;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function splitSegments(rawContent: string): string[] {
  return rawContent.split("~").map((segment) => segment.trim()).filter(Boolean);
}

function splitElements(segment: string): string[] {
  return segment.split("*").map((element) => element.trim());
}

type ParsedStc = {
  raw: string;
  category: string | null;
  status: string | null;
  entity: string | null;
  actionCode: string | null;
  monetaryAmount: string | null;
  message: string | null;
};

function parseStcSegment(elements: string[]): ParsedStc {
  const composite = normalizeText(elements[1]);
  const [category, status, entity] = composite.split(":");
  return {
    raw: elements.join("*"),
    category: category || null,
    status: status || null,
    entity: entity || null,
    actionCode: normalizeText(elements[3]) || null,
    monetaryAmount: normalizeText(elements[4]) || null,
    message: normalizeText(elements[11]) || null,
  };
}

function isRejectStc(entry: ParsedStc): boolean {
  const category = normalizeText(entry.category).toUpperCase();
  const status = normalizeText(entry.status).toUpperCase();
  return (
    ["A3", "A6", "A7", "A8", "E0"].includes(category) ||
    ["562", "U", "R"].includes(status)
  );
}

function isAcceptStc(entry: ParsedStc): boolean {
  const category = normalizeText(entry.category).toUpperCase();
  return ["A1", "A2", "A5"].includes(category);
}

export type Parsed277CaClaimRef = {
  trn: string;
  stcStatuses: ParsedStc[];
  message: string | null;
};

function parse277CA(rawContent: string) {
  const parsedSegments = splitSegments(rawContent).map(splitElements);
  const bht = parsedSegments.find((elements) => elements[0] === "BHT");
  const stcStatuses: ParsedStc[] = [];
  const claimRefs: Parsed277CaClaimRef[] = [];
  let currentHlLevel: string | null = null;
  let currentClaim: Parsed277CaClaimRef | null = null;

  for (const elements of parsedSegments) {
    const tag = elements[0];
    if (tag === "HL") {
      currentHlLevel = normalizeText(elements[3]) || null;
      currentClaim = null;
      continue;
    }
    if (tag === "TRN" && currentHlLevel === "23") {
      const trn = normalizeText(elements[2]);
      if (trn) {
        currentClaim = { trn, stcStatuses: [], message: null };
        claimRefs.push(currentClaim);
      } else {
        currentClaim = null;
      }
      continue;
    }
    if (tag === "STC") {
      const entry = parseStcSegment(elements);
      stcStatuses.push(entry);
      if (currentClaim) {
        currentClaim.stcStatuses.push(entry);
        if (!currentClaim.message && entry.message) currentClaim.message = entry.message;
      }
    }
  }

  const hasReject = stcStatuses.some(isRejectStc);
  const hasAccept = stcStatuses.some(isAcceptStc);
  let outcome: Edi277CAOutcome = "unknown";
  if (hasReject && hasAccept) outcome = "partial";
  else if (hasReject) outcome = "rejected";
  else if (hasAccept) outcome = "accepted";

  return {
    outcome,
    bht: bht ? bht.join("*") : null,
    stcStatuses,
    claimRefs,
    segmentCount: parsedSegments.length,
  };
}

async function loadBatchById(organizationId: string, batchId: string) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data, error } = await supabase
    .from("claim_837p_batches")
    .select("id, organization_id, batch_status, batch_number")
    .eq("id", batchId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as DbRecord | null;
}

async function loadLinkedClaimIds(organizationId: string, batchId: string) {
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

type ClaimContextRow = {
  patient_id: string | null;
  appointment_id: string | null;
  patient_account_number: string | null;
  claim_number: string | null;
};

async function loadClaimContexts(
  organizationId: string,
  claimIds: string[],
): Promise<Map<string, ClaimContextRow>> {
  const out = new Map<string, ClaimContextRow>();
  if (claimIds.length === 0) return out;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return out;
  const { data } = await supabase
    .from("professional_claims")
    .select("id, patient_id, appointment_id, patient_account_number, claim_number")
    .eq("organization_id", organizationId)
    .in("id", claimIds);
  for (const row of (data ?? []) as Array<{
    id: string;
    patient_id: string | null;
    appointment_id: string | null;
    patient_account_number: string | null;
    claim_number: string | null;
  }>) {
    out.set(String(row.id), {
      patient_id: row.patient_id ?? null,
      appointment_id: row.appointment_id ?? null,
      patient_account_number: row.patient_account_number ?? null,
      claim_number: row.claim_number ?? null,
    });
  }
  return out;
}

function matchClaimsForTrn(
  trn: string,
  linkedClaimIds: string[],
  contexts: Map<string, ClaimContextRow>,
): string[] {
  const key = trn.trim().toUpperCase();
  if (!key) return [];
  const matches: string[] = [];
  for (const claimId of linkedClaimIds) {
    const ctx = contexts.get(claimId);
    const candidates = [ctx?.patient_account_number, ctx?.claim_number, claimId];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (String(candidate).trim().toUpperCase() === key) {
        matches.push(claimId);
        break;
      }
    }
  }
  return matches;
}

function batchStatusForOutcome(outcome: Edi277CAOutcome) {
  if (outcome === "accepted") return "accepted_277ca";
  if (outcome === "rejected") return "rejected_277ca";
  if (outcome === "partial") return "partially_accepted";
  return "submitted";
}

function claimStatusForOutcome(outcome: Edi277CAOutcome) {
  if (outcome === "accepted") return "accepted_payer";
  if (outcome === "rejected") return "rejected_payer";
  if (outcome === "partial") return "accepted_payer";
  return "submitted";
}

function outcomeForClaimRef(ref: Parsed277CaClaimRef): Edi277CAOutcome {
  const hasReject = ref.stcStatuses.some(isRejectStc);
  const hasAccept = ref.stcStatuses.some(isAcceptStc);
  if (hasReject && hasAccept) return "partial";
  if (hasReject) return "rejected";
  if (hasAccept) return "accepted";
  return "unknown";
}

export async function intake277CAAcknowledgement(
  input: Intake277CAAcknowledgementInput,
): Promise<Intake277CAAcknowledgementResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      acknowledgementId: null,
      batchId: input.batchId ?? null,
      outcome: "unknown",
      linkedClaimIds: [],
      errors: [{ field: "system", message: "Database connection not available" }],
    };
  }

  if (!normalizeText(input.rawContent)) {
    return {
      ok: false,
      acknowledgementId: null,
      batchId: input.batchId ?? null,
      outcome: "unknown",
      linkedClaimIds: [],
      errors: [{ field: "raw_content", message: "277CA acknowledgement content is required" }],
    };
  }

  const parsed = parse277CA(input.rawContent);
  const batch = input.batchId ? await loadBatchById(input.organizationId, input.batchId) : null;

  if (!batch) {
    return {
      ok: false,
      acknowledgementId: null,
      batchId: input.batchId ?? null,
      outcome: parsed.outcome,
      linkedClaimIds: [],
      errors: [{ field: "claim_837p_batches", message: "Could not match 277CA acknowledgement to an active 837P batch" }],
    };
  }

  const batchId = String(batch.id);
  const linkedClaimIds = await loadLinkedClaimIds(input.organizationId, batchId);

  const { data: ack, error: ackError } = await supabase
    .from("edi_acknowledgements")
    .insert({
      organization_id: input.organizationId,
      edi_batch_id: batchId,
      acknowledgement_type: "277CA",
      file_name: input.fileName ?? undefined,
      raw_content: input.rawContent,
      parsed_content: parsed,
    })
    .select("id")
    .single();

  if (ackError || !ack) {
    return {
      ok: false,
      acknowledgementId: null,
      batchId,
      outcome: parsed.outcome,
      linkedClaimIds,
      errors: [{ field: "edi_acknowledgements", message: ackError?.message ?? "Failed to store 277CA acknowledgement" }],
    };
  }

  const acknowledgementId = String(ack.id);
  const { error: batchUpdateError } = await supabase
    .from("claim_837p_batches")
    .update({ batch_status: batchStatusForOutcome(parsed.outcome), updated_at: new Date().toISOString() })
    .eq("id", batchId)
    .eq("organization_id", input.organizationId);

  if (batchUpdateError) {
    return {
      ok: false,
      acknowledgementId,
      batchId,
      outcome: parsed.outcome,
      linkedClaimIds,
      errors: [{ field: "claim_837p_batches", message: batchUpdateError.message }],
    };
  }

  const claimContexts =
    linkedClaimIds.length > 0
      ? await loadClaimContexts(input.organizationId, linkedClaimIds)
      : new Map<string, ClaimContextRow>();

  if (linkedClaimIds.length > 0) {
    const batchStatus = claimStatusForOutcome(parsed.outcome);
    const perClaimStatus = new Map<string, string>();
    for (const claimId of linkedClaimIds) perClaimStatus.set(claimId, batchStatus);

    for (const ref of parsed.claimRefs) {
      const refOutcome = outcomeForClaimRef(ref);
      if (refOutcome === "unknown") continue;
      const matched = matchClaimsForTrn(ref.trn, linkedClaimIds, claimContexts);
      if (matched.length === 0) continue;
      const status = claimStatusForOutcome(refOutcome);
      for (const claimId of matched) perClaimStatus.set(claimId, status);
    }

    const idsByStatus = new Map<string, string[]>();
    for (const [claimId, status] of perClaimStatus) {
      const bucket = idsByStatus.get(status);
      if (bucket) bucket.push(claimId);
      else idsByStatus.set(status, [claimId]);
    }

    const updatedAt = new Date().toISOString();
    for (const [status, ids] of idsByStatus) {
      const { error: claimUpdateError } = await supabase
        .from("professional_claims")
        .update({ claim_status: status, updated_at: updatedAt })
        .in("id", ids)
        .eq("organization_id", input.organizationId);

      if (claimUpdateError) {
        return {
          ok: false,
          acknowledgementId,
          batchId,
          outcome: parsed.outcome,
          linkedClaimIds,
          errors: [{ field: "professional_claims", message: claimUpdateError.message }],
        };
      }
    }
  }

  if (["rejected", "partial"].includes(parsed.outcome) && linkedClaimIds.length > 0) {
    const routed = await routeRejectedClaimsToWorkqueue({
      organizationId: input.organizationId,
      acknowledgementId,
      batchId,
      claimIds: linkedClaimIds,
      source: "277CA",
      outcome: parsed.outcome as "rejected" | "partial",
      parsedContent: parsed,
    });

    if (!routed.ok) {
      return {
        ok: false,
        acknowledgementId,
        batchId,
        outcome: parsed.outcome,
        linkedClaimIds,
        errors: routed.errors,
      };
    }
  }

  if (linkedClaimIds.length > 0 && parsed.claimRefs.length > 0) {
    const contexts = claimContexts;
    const seededClaimIds = new Set<string>();

    for (const claimRef of parsed.claimRefs) {
      const perClaimDetected = detect277CADocumentationRequest({
        stcStatuses: claimRef.stcStatuses,
      });
      if (!perClaimDetected) continue;

      const matchedClaimIds = matchClaimsForTrn(claimRef.trn, linkedClaimIds, contexts);
      if (matchedClaimIds.length === 0) {
        console.warn(
          `[277CA medical-review seed] no claim matched TRN ${claimRef.trn} in batch ${batchId}`,
        );
        continue;
      }

      for (const claimId of matchedClaimIds) {
        if (seededClaimIds.has(claimId)) continue;
        seededClaimIds.add(claimId);
        const ctx = contexts.get(claimId);
        const writeResult = await writeMedicalReviewRequestAudit(supabase, {
          organizationId: input.organizationId,
          claimId,
          clientId: ctx?.patient_id ?? null,
          appointmentId: ctx?.appointment_id ?? null,
          detected: perClaimDetected,
          origin: "277CA",
          sourceObjectId: acknowledgementId,
          claimRefTrn: claimRef.trn || null,
        });
        if (writeResult.status === "error") {
          console.warn(
            `[277CA medical-review seed] failed for claim ${claimId}: ${writeResult.error}`,
          );
        }
      }
    }
  }

  return {
    ok: true,
    acknowledgementId,
    batchId,
    outcome: parsed.outcome,
    linkedClaimIds,
    errors: [],
  };
}

// Test-only: exposes the internal parser to unit tests.
export const __private277CAParserForTests = { parse277CA };
