import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import {
  loadProviderEnrollmentIssues,
  type ProviderEnrollmentIssueFilters,
} from "@/lib/billing/providerEnrollmentIssuesService";

const FILTER_KEYS: Array<keyof ProviderEnrollmentIssueFilters> = [
  "practice",
  "clinician",
  "client",
  "payer",
  "dosFrom",
  "dosTo",
  "status",
  "priority",
  "minAmount",
  "maxAmount",
  "agingBucket",
  "assignedBiller",
  "carcRarc",
  "followUpDue",
];

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;

    const filters: ProviderEnrollmentIssueFilters = {};
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key);
      if (value != null && value !== "") {
        filters[key] = value;
      }
    }

    const rows = await loadProviderEnrollmentIssues({
      supabase,
      organizationId: guard.organizationId,
      filters: Object.keys(filters).length ? filters : undefined,
    });

    return NextResponse.json({ success: true, rows, appliedFilters: filters });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Failed to load provider enrollment issues",
      },
      { status: 500 },
    );
  }
}
