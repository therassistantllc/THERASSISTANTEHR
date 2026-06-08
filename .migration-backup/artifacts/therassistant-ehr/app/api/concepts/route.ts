import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { ORGANIZATION_ID } from "@/lib/config";

type DbRow = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function rowToConcept(row: DbRow) {
  return {
    id: clean(row.id),
    name: clean(row.name),
    description: clean(row.description),
    datatype: clean(row.datatype),
    conceptClass: clean(row.concept_class),
    isSet: Boolean(row.is_set),
    retired: Boolean(row.retired),
    createdByOrganizationId: clean(row.created_by_organization_id) || null,
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
  };
}

export async function GET(request: Request) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const conceptClass = (searchParams.get("class") || "").trim();
    const includeRetired = searchParams.get("includeRetired") === "true";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 200);
    const offset = Math.max(Number(searchParams.get("offset") || 0), 0);
    // Org scope is intentionally NOT taken from query params here — we don't want
    // a caller to spoof another org's local dictionary. We use the server-side
    // ORGANIZATION_ID (configured per deployment). Once user auth lands, swap
    // this for the authenticated user's org from their session.
    const organizationId = ORGANIZATION_ID;

    // Visibility: global dictionary (created_by_organization_id IS NULL) plus
    // anything created by the caller's org. Other orgs' local concepts are hidden.
    let query = supabase
      .from("concepts")
      .select(
        "id, name, description, datatype, concept_class, is_set, retired, created_by_organization_id, created_at, updated_at",
        { count: "exact" },
      )
      .or(`created_by_organization_id.is.null,created_by_organization_id.eq.${organizationId}`)
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (!includeRetired) query = query.eq("retired", false);
    if (conceptClass) query = query.eq("concept_class", conceptClass);
    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error, count } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });

    return NextResponse.json({
      success: true,
      total: count ?? null,
      limit,
      offset,
      organizationId,
      concepts: ((data ?? []) as DbRow[]).map(rowToConcept),
    });
  } catch (error) {
    console.error("Concepts list API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list concepts" },
      { status: 500 },
    );
  }
}
