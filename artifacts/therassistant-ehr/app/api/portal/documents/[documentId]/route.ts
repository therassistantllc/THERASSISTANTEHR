import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { getPortalSession } from "@/lib/portal/session";

const SIGNED_URL_TTL_SECONDS = 60;

function clean(v: unknown) {
  return String(v ?? "").trim();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const session = await getPortalSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
  const { documentId } = await context.params;
  if (!documentId) {
    return NextResponse.json({ success: false, error: "documentId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
  }

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, file_name, storage_bucket, storage_path, patient_visible, archived_at")
    .eq("id", documentId)
    .eq("organization_id", session.organizationId)
    .eq("client_id", session.clientId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 422 });
  }
  if (!doc || doc.archived_at || !doc.patient_visible) {
    return NextResponse.json({ success: false, error: "Document not available" }, { status: 404 });
  }

  const bucket = clean(doc.storage_bucket);
  const path = clean(doc.storage_path);
  if (!bucket || !path) {
    return NextResponse.json(
      { success: false, error: "This document has no file attached." },
      { status: 404 },
    );
  }

  const fileName = clean(doc.file_name) || `document-${doc.id}`;
  const { data: signed, error: signErr } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: fileName });

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { success: false, error: signErr?.message || "File not available in storage" },
      { status: 404 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
