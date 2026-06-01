import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { searchParams } = new URL(request.url);

    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });

    if (guard instanceof NextResponse) return guard;

    const { id } = await ctx.params;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: batch, error } = await supabase
      .from("eligibility_270_batches")
      .select(
        "id,batch_number,generated_file_name,generated_file_content,batch_status",
      )
      .eq("organization_id", guard.organizationId)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();

    if (error) throw error;

    if (!batch) {
      return NextResponse.json(
        { success: false, error: "Eligibility batch not found" },
        { status: 404 },
      );
    }

    const content = text(batch.generated_file_content);
    const fileName =
      text(batch.generated_file_name) ||
      `${text(batch.batch_number) || id}.270`;

    if (!content) {
      return NextResponse.json(
        { success: false, error: "No 270 content available for this batch" },
        { status: 404 },
      );
    }

    await supabase
      .from("eligibility_270_batches")
      .update({
        downloaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", guard.organizationId)
      .eq("id", id);

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to download eligibility batch",
      },
      { status: 500 },
    );
  }
}
