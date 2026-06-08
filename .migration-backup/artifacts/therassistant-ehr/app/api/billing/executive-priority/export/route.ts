/**
 * POST /api/billing/executive-priority/export
 *
 * Audits an Executive / Priority CSV export. The CSV itself is generated
 * client-side from the data the user is already looking at; this endpoint
 * just records who exported what (tab, filters, row count) for compliance.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const text = (v: unknown) => String(v ?? "").trim();

interface Body {
  organizationId?: string;
  tab?: string;
  filters?: Record<string, unknown>;
  rowCount?: number;
  totalDollars?: number;
  claimIds?: string[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
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

    const tab = text(body.tab) || "high_dollar";
    const rowCount = Number.isFinite(body.rowCount) ? Number(body.rowCount) : 0;
    const totalDollars = Number.isFinite(body.totalDollars)
      ? Number(body.totalDollars)
      : 0;
    const filters = body.filters ?? {};
    const claimIds = Array.isArray(body.claimIds)
      ? body.claimIds.map(text).filter(Boolean).slice(0, 500)
      : [];

    // Best-effort audit. We use the existing audit_logs table if present;
    // fall back to no-op if the project hasn't deployed that table yet so
    // the export still succeeds.
    const payload = {
      organization_id: organizationId,
      actor_user_id: guard.userId,
      action: "billing.executive_priority.export",
      target_table: "professional_claims",
      target_id: null as string | null,
      context: {
        tab,
        rowCount,
        totalDollars,
        filters,
        claimIds,
      },
    };

    const { error } = await (supabase as any).from("audit_logs").insert(payload);
    if (error) {
      // Table missing or schema mismatch — log to server console but don't
      // block the user's export. The CSV is already in their browser.
      console.warn("executive-priority export audit failed:", error.message);
    }

    return NextResponse.json({
      success: true,
      audited: !error,
      exportedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Export audit failed" },
      { status: 500 },
    );
  }
}
