import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = createServerSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Database unavailable" },
      { status: 500 },
    );
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json(
      { success: false, error: "organizationId is required" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("claim_837p_batches")
    .select("id, generated_file_name, generated_file_content")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Batch not found" },
      { status: 404 },
    );
  }

  if (!data.generated_file_content) {
    return NextResponse.json(
      { success: false, error: "Batch has no generated 837P file content yet." },
      { status: 422 },
    );
  }

  const fileName = data.generated_file_name || `837P_${id}.edi`;

  return new Response(String(data.generated_file_content), {
    status: 200,
    headers: {
      "Content-Type": "application/edi-x12; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}