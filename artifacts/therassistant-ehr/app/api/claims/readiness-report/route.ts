import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { runConfigValidation } from "@/lib/validation/runValidation";
import { runClaimContentValidation } from "@/lib/validation/claim/runClaimContentValidation";
import type { ValidationReport, ValidationSummary } from "@/lib/validation/types";

/**
 * GET /api/claims/readiness-report?organizationId=...[&claimId=...|&encounterId=...]
 *
 * Returns the combined readiness report consumed by the Claim Readiness
 * panel. System-readiness and claim-content findings are returned grouped
 * separately (under `systemReadiness` and `claimContent`) — never merged —
 * so the UI can render them under distinct sections.
 *
 * If neither claimId nor encounterId is provided, only the system-readiness
 * report is returned (claimContent is null). If encounterId is provided we
 * resolve it to the most recent professional claim for that encounter.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  const claimIdParam = url.searchParams.get("claimId");
  const encounterId = url.searchParams.get("encounterId");

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available." }, { status: 503 });
  }

  // Resolve claimId from encounterId if needed.
  let claimId: string | null = claimIdParam;
  if (!claimId && encounterId) {
    const { data } = await supabase
      .from("professional_claims")
      .select("id, created_at")
      .eq("organization_id", organizationId)
      .eq("encounter_id", encounterId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as { id: string } | undefined;
    claimId = row?.id ?? null;
  }

  let systemReadiness: ValidationReport;
  let claimContent: ValidationReport | null = null;

  try {
    if (claimId) {
      const [sys, claim] = await Promise.all([
        runConfigValidation(supabase, organizationId),
        runClaimContentValidation(supabase, organizationId, claimId).then((r) => r.report),
      ]);
      systemReadiness = sys;
      claimContent = claim;
    } else {
      systemReadiness = await runConfigValidation(supabase, organizationId);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Validation engine failed." },
      { status: 500 },
    );
  }

  const combined: ValidationSummary = {
    blocking: systemReadiness.summary.blocking + (claimContent?.summary.blocking ?? 0),
    warning: systemReadiness.summary.warning + (claimContent?.summary.warning ?? 0),
    info: systemReadiness.summary.info + (claimContent?.summary.info ?? 0),
    total: systemReadiness.summary.total + (claimContent?.summary.total ?? 0),
    ready: false,
  };
  combined.ready = combined.blocking === 0;

  return NextResponse.json({
    organizationId,
    claimId,
    encounterId,
    generatedAt: new Date().toISOString(),
    systemReadiness,
    claimContent,
    combined,
  });
}
