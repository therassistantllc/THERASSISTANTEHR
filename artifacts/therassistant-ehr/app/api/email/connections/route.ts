import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { DEFAULT_ORG_ID } from "@/lib/config";

type DbRow = Record<string, unknown>;

function getString(v: unknown) {
  return typeof v === "string" ? v : "";
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }
    const url = new URL(request.url);

    // Per-clinician scoping: a logged-in staff member sees only their own
    // Gmail connection. If no session is present (dev/local), fall back to
    // org scope so the existing UI keeps working.
    const ctx = await requireAuthenticatedStaff();
    const organizationId =
      ctx?.organizationId ||
      url.searchParams.get("organizationId") ||
      process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
      DEFAULT_ORG_ID;

    let query = supabase
      .from("integration_connections")
      .select("id, integration_type, connection_status, display_name, external_account_email, last_sync_at, sync_error, owner_user_id")
      .eq("organization_id", organizationId)
      .in("integration_type", ["gmail"])
      .order("created_at", { ascending: false });

    if (ctx?.userId) {
      query = query.eq("owner_user_id", ctx.userId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      connections: ((data ?? []) as DbRow[]).map((r) => ({
        id: getString(r.id),
        integrationType: getString(r.integration_type),
        connectionStatus: getString(r.connection_status),
        displayName: getString(r.display_name),
        externalAccountEmail: getString(r.external_account_email),
        lastSyncAt: getString(r.last_sync_at),
        syncError: getString(r.sync_error),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Connections list failed" },
      { status: 500 },
    );
  }
}
