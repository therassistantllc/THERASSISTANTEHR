import { NextResponse } from "next/server";
import { createClaimDraftFromChargeCapture } from "@/lib/claims/chargeCaptureClaimBridgeService";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

interface ReleaseRequestBody {
  organizationId?: string;
  chargeCaptureIds?: unknown;
}

type ReleaseResult = {
  chargeCaptureId: string;
  ok: boolean;
  claimId: string | null;
  errors: Array<{ field?: string; message: string }>;
};

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ReleaseRequestBody;

    const requestedOrg =
      typeof body.organizationId === "string" ? body.organizationId.trim() : "";

    const guard = await requireBillingAccess({
      requestedOrganizationId: requestedOrg || null,
    });

    if (guard instanceof NextResponse) return guard;

    const organizationId = guard.organizationId;
    const ids = normalizeIds(body.chargeCaptureIds);

    if (ids.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "chargeCaptureIds is required",
        },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const results: ReleaseResult[] = [];

    for (const chargeCaptureId of ids) {
      try {
        const result = await createClaimDraftFromChargeCapture({
          organizationId,
          chargeCaptureId,
        });

        if (!result.ok || !result.claimId) {
          results.push({
            chargeCaptureId,
            ok: false,
            claimId: result.claimId ?? null,
            errors: result.errors ?? [],
          });
          continue;
        }

        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("charge_capture_items")
          .update({
            charge_status: "released",
            claim_id: result.claimId,
            released_at: now,
            updated_at: now,
          })
          .eq("organization_id", organizationId)
          .eq("id", chargeCaptureId)
          .is("archived_at", null);

        if (updateError) {
          results.push({
            chargeCaptureId,
            ok: false,
            claimId: result.claimId,
            errors: [{ field: "charge_capture_items", message: updateError.message }],
          });
          continue;
        }

        results.push({
          chargeCaptureId,
          ok: true,
          claimId: result.claimId,
          errors: [],
        });
      } catch (error) {
        results.push({
          chargeCaptureId,
          ok: false,
          claimId: null,
          errors: [
            {
              field: "release",
              message:
                error instanceof Error
                  ? error.message
                  : "Claim creation failed",
            },
          ],
        });
      }
    }

    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;

    return NextResponse.json(
      {
        success: failed === 0,
        totalRequested: ids.length,
        succeeded,
        failed,
        results,
        message:
          failed === 0
            ? `Released ${succeeded} charge${succeeded === 1 ? "" : "s"} to claims.`
            : `Released ${succeeded} charge${succeeded === 1 ? "" : "s"}; ${failed} failed.`,
      },
      { status: failed === ids.length ? 422 : 200 },
    );
  } catch (error) {
    console.error("Charge release API error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Release to billing failed",
      },
      { status: 500 },
    );
  }
}
