/**
 * /api/billing/claims/[claimId]/277ca-status
 *
 * GET — return EVERY 277CA acknowledgement for the EDI batch(es) this
 * claim was submitted in, newest first, each sliced down to the
 * per-claim STC entries that actually name THIS claim. The 277CA
 * parser keeps each claim's own STC entries on `parsed.claimRefs`
 * (keyed by TRN02 echoing the 837P CLM01), so a mixed-rejection batch
 * can be reduced to "which STC rejected MY claim" rather than the
 * batch-wide outcome.
 *
 * We return the full history (not just the latest) so that when a
 * claim has been resubmitted — corrected claim, second batch — the
 * earlier rejections that explain WHY it was corrected remain
 * visible in the claim's audit trail.
 *
 * Matching mirrors the intake's `matchClaimsForTrn`:
 * patient_account_number → claim_number → claim id, all
 * case/whitespace-insensitive. If no claimRef matches this claim we
 * fall back to the batch-level outcome + STC list so the biller still
 * sees *something*.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type Row = Record<string, unknown>;

type ParsedStc = {
  raw?: string;
  category: string | null;
  status: string | null;
  entity: string | null;
  actionCode?: string | null;
  monetaryAmount?: string | null;
  message: string | null;
};

type ParsedClaimRef = {
  trn: string;
  stcStatuses: ParsedStc[];
  message: string | null;
};

type ParsedContent = {
  outcome?: string;
  stcStatuses?: ParsedStc[];
  claimRefs?: ParsedClaimRef[];
};

function trnKey(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    // 1. Pull the claim's identifiers so we can match TRN02 back to it.
    const { data: claim, error: claimErr } = await supabase
      .from("professional_claims")
      .select("id, claim_number, patient_account_number")
      .eq("organization_id", organizationId)
      .eq("id", claimId)
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json(
        { success: false, error: claimErr.message },
        { status: 500 },
      );
    }
    if (!claim) {
      return NextResponse.json(
        { success: false, error: "Claim not found" },
        { status: 404 },
      );
    }
    const claimRow = claim as Row;
    const claimKeys = new Set<string>(
      [
        claimRow["patient_account_number"],
        claimRow["claim_number"],
        claimRow["id"],
      ]
        .map(trnKey)
        .filter((s): s is string => Boolean(s)),
    );

    // 2. Find every edi_batch this claim was submitted in.
    const { data: links, error: linkErr } = await supabase
      .from("edi_batch_claims")
      .select("edi_batch_id")
      .eq("claim_id", claimId);
    if (linkErr) {
      return NextResponse.json(
        { success: false, error: linkErr.message },
        { status: 500 },
      );
    }
    const batchIds = ((links ?? []) as Array<{ edi_batch_id: string }>)
      .map((r) => String(r.edi_batch_id))
      .filter(Boolean);
    if (batchIds.length === 0) {
      return NextResponse.json({ success: true, acknowledgements: [] });
    }

    // 3. Every 277CA across those batches, newest first.
    const { data: acks, error: ackErr } = await supabase
      .from("edi_acknowledgements")
      .select("id, edi_batch_id, file_name, parsed_content, created_at")
      .eq("organization_id", organizationId)
      .eq("acknowledgement_type", "277CA")
      .in("edi_batch_id", batchIds)
      .order("created_at", { ascending: false });
    if (ackErr) {
      return NextResponse.json(
        { success: false, error: ackErr.message },
        { status: 500 },
      );
    }

    const acknowledgements = ((acks ?? []) as Row[]).map((ack) => {
      const parsed = (ack["parsed_content"] ?? {}) as ParsedContent;
      const refs = Array.isArray(parsed.claimRefs) ? parsed.claimRefs : [];

      // 4. Match TRN ↔ this claim — mirrors matchClaimsForTrn() in the
      //    intake service (case/whitespace-insensitive, falls back
      //    through patient_account_number → claim_number → id).
      const matchedRef =
        refs.find((ref) => claimKeys.has(trnKey(ref.trn))) ?? null;

      const batchStcStatuses = Array.isArray(parsed.stcStatuses)
        ? parsed.stcStatuses
        : [];

      return {
        id: String(ack["id"] ?? ""),
        edi_batch_id: String(ack["edi_batch_id"] ?? ""),
        file_name: ack["file_name"] ? String(ack["file_name"]) : null,
        created_at: ack["created_at"] ? String(ack["created_at"]) : null,
        outcome: parsed.outcome ?? null,
        matched_claim_ref: matchedRef
          ? {
              trn: matchedRef.trn,
              message: matchedRef.message,
              stc_statuses: matchedRef.stcStatuses ?? [],
            }
          : null,
        batch_stc_statuses: batchStcStatuses,
      };
    });

    return NextResponse.json({
      success: true,
      acknowledgements,
      // Back-compat: the latest one, in case anything still reads
      // `acknowledgement` (singular).
      acknowledgement: acknowledgements[0] ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
