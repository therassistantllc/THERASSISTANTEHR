import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requirePermissionInRoute } from "@/lib/rbac/middleware";
import { PERMISSIONS } from "@/lib/rbac/constants";

type Row = Record<string, unknown>;

const CARD_BUCKET = "intake-card-images";

export async function GET(
  _request: Request,
  context: { params: Promise<{ submissionId: string; side: string }> },
) {
  try {
    const auth = await requirePermissionInRoute(PERMISSIONS.VIEW_PATIENT_CHART);
    if (auth instanceof NextResponse) return auth;
    const { organizationId } = auth;

    const { submissionId, side } = await context.params;
    if (side !== "front" && side !== "back") {
      return NextResponse.json({ success: false, error: "Invalid side" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { data: submission, error } = await supabase
      .from("intake_submissions")
      .select("organization_id, insurance")
      .eq("id", submissionId)
      .maybeSingle();
    if (error) throw error;
    if (!submission) {
      return NextResponse.json({ success: false, error: "Submission not found" }, { status: 404 });
    }
    const subRow = submission as Row;
    if (String(subRow.organization_id ?? "") !== organizationId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const insurance = (subRow.insurance ?? {}) as Row;
    const cardKey = side === "front" ? "cardFront" : "cardBack";
    const card = insurance[cardKey] as Row | null | undefined;
    if (!card || typeof card !== "object") {
      return NextResponse.json({ success: false, error: "No card on file" }, { status: 404 });
    }

    const path = typeof card.path === "string" ? card.path : "";
    const bucket = typeof card.bucket === "string" && card.bucket ? card.bucket : CARD_BUCKET;

    // Backwards compatibility: older submissions stored the image inline as a
    // base64 data URL under `content`. Stream those bytes directly so existing
    // records keep working.
    if (!path && typeof card.content === "string" && card.content.startsWith("data:image/")) {
      const commaIdx = card.content.indexOf(",");
      if (commaIdx < 0) {
        return NextResponse.json({ success: false, error: "Card content malformed" }, { status: 500 });
      }
      const header = card.content.slice(5, commaIdx);
      const mime = header.split(";")[0] || "image/jpeg";
      const bytes = Buffer.from(card.content.slice(commaIdx + 1), "base64");
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (!path) {
      return NextResponse.json({ success: false, error: "No card on file" }, { status: 404 });
    }

    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { success: false, error: dlErr?.message ?? "Card image unavailable" },
        { status: 404 },
      );
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const contentType = typeof card.type === "string" ? card.type : blob.type || "image/jpeg";
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Intake card fetch error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load card image" },
      { status: 500 },
    );
  }
}
