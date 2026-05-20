import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { runTestClaimSimulation } from "@/lib/validation/simulation";

/**
 * POST /api/settings/system-readiness/simulate
 *
 * Validation-only test-claim simulation. Synthesises a non-PHI test claim
 * from configuration and checks every dependency the 837P generator would
 * touch. NEVER transmits to a clearinghouse, NEVER persists.
 *
 * Body: { organizationId: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const organizationId =
      typeof body?.organizationId === "string" ? body.organizationId.trim() : "";

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
    }

    const report = await runTestClaimSimulation(supabase, organizationId);
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test claim simulation failed" },
      { status: 500 },
    );
  }
}
