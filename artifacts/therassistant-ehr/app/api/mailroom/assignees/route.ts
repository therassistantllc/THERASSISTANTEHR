import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("staff_profiles")
      .select("auth_user_id, first_name, last_name, email")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .is("archived_at", null)
      .not("auth_user_id", "is", null)
      .order("first_name", { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    const assignees = ((data ?? []) as DbRow[])
      .map((row) => {
        const userId = text(row.auth_user_id);
        const name = [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") || text(row.email);
        return { userId, name };
      })
      .filter((row) => Boolean(row.userId));

    return NextResponse.json({ success: true, assignees });
  } catch (error) {
    console.error("Mailroom assignees API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load assignees" },
      { status: 500 },
    );
  }
}
