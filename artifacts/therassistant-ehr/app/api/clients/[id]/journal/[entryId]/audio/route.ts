import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

const SIGNED_TTL_SECONDS = 60 * 10;

function value(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id: clientId, entryId } = await context.params;
  const url = new URL(request.url);
  const requested = value(url.searchParams.get("organizationId"));
  const guard = await requireOrgAccess({
    requestedOrganizationId: requested || null,
    permission: "view_patient_chart",
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
  }
  const { data: row } = await supabase
    .from("patient_journal_entries")
    .select("audio_storage_bucket, audio_storage_path")
    .eq("id", entryId)
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  const bucket = value((row as Record<string, unknown> | null)?.audio_storage_bucket);
  const path = value((row as Record<string, unknown> | null)?.audio_storage_path);
  if (!bucket || !path) {
    return NextResponse.json({ success: false, error: "No audio attached" }, { status: 404 });
  }
  const { data: signed, error: signErr } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { success: false, error: signErr?.message || "File not available" },
      { status: 404 },
    );
  }
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, no-store" },
  });
}
