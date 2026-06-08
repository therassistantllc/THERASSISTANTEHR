import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { id } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const { data, error } = await supabase
      .from("claim_837p_batches")
      .select("id, generated_file_name, generated_file_content, batch_number")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    if (!data) return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });

    const content = String((data as Record<string, unknown>).generated_file_content ?? "");
    if (!content) return NextResponse.json({ success: false, error: "Batch has no generated EDI content yet" }, { status: 404 });

    const fileName = String((data as Record<string, unknown>).generated_file_name ?? `${(data as Record<string, unknown>).batch_number ?? id}.837P.txt`);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
