import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

function normalizeMonth(value: string | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) return null;
  return `${raw.slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const month = normalizeMonth(searchParams.get("month"));
    if (!month) {
      return NextResponse.json({ success: false, error: "month is required in YYYY-MM or YYYY-MM-DD format" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const monthStart = month;
    const monthEnd = new Date(`${monthStart}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const monthEndText = monthEnd.toISOString().slice(0, 10);

    const { data, error } = await supabase.rpc("eligibility_270_candidates_for_month", {
      p_organization_id: guard.organizationId,
      p_month_start: monthStart,
      p_month_end: monthEndText,
    });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      month: monthStart,
      count: Array.isArray(data) ? data.length : 0,
      candidates: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load eligibility candidates" },
      { status: 500 },
    );
  }
}
