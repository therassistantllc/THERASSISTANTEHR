/**
 * GET /api/billing/documentation-pending/notes?clientId=…
 *
 * Returns the most recent clinical notes for a client, used by the
 * Documentation Pending right-side "Prior note history" panel.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type DbRow = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").trim();

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
    const organizationId = guard.organizationId;

    const clientId = searchParams.get("clientId");
    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Missing clientId" },
        { status: 400 },
      );
    }
    const limit = Math.max(
      1,
      Math.min(50, Number(searchParams.get("limit") ?? "10")),
    );

    const { data: encs, error: encErr } = await (supabase as any)
      .from("encounters")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .is("archived_at", null);
    if (encErr) throw encErr;
    const encIds = ((encs ?? []) as DbRow[])
      .map((e) => text(e.id))
      .filter(Boolean);

    if (encIds.length === 0) {
      return NextResponse.json({ success: true, organizationId, notes: [] });
    }

    const { data: notes, error: notesErr } = await (supabase as any)
      .from("encounter_notes")
      .select("id, encounter_id, note_status, signed_at, updated_at")
      .eq("organization_id", organizationId)
      .in("encounter_id", encIds)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (notesErr) throw notesErr;

    return NextResponse.json({
      success: true,
      organizationId,
      notes: ((notes ?? []) as DbRow[]).map((n) => ({
        id: text(n.encounter_id),
        updated_at: text(n.updated_at),
        note_status: text(n.note_status) || "—",
        signed_at: (n.signed_at as string | null) ?? null,
      })),
    });
  } catch (error) {
    console.error("Documentation Pending notes error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load notes",
      },
      { status: 500 },
    );
  }
}
