import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { getPortalSession } from "@/lib/portal/session";
import {
  ENTRY_TYPES,
  EntryType,
  mapJournalRow,
  sanitizeBody,
} from "@/lib/portal/journal";

type Row = Record<string, unknown>;

export async function GET() {
  const session = await getPortalSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("patient_journal_entries")
    .select(
      "id, entry_type, body, tags, audio_storage_path, audio_mime_type, audio_duration_seconds, audio_transcript, imported_into_note_id, imported_into_field, imported_at, reviewed_at, reviewed_by_user_id, created_at, updated_at",
    )
    .eq("organization_id", session.organizationId)
    .eq("client_id", session.clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Row[];
  // Resolve "Reviewed by <clinician>" labels. The portal needs the clinician's
  // display name (not a uuid). We look it up via staff_profiles.auth_user_id.
  const reviewerIds = Array.from(
    new Set(
      rows
        .map((r) => String(r.reviewed_by_user_id ?? "").trim())
        .filter((v) => v.length > 0),
    ),
  );
  const nameById = new Map<string, string>();
  if (reviewerIds.length > 0) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("auth_user_id, first_name, last_name")
      .eq("organization_id", session.organizationId)
      .in("auth_user_id", reviewerIds);
    for (const s of (staff ?? []) as Row[]) {
      const uid = String(s.auth_user_id ?? "").trim();
      if (!uid) continue;
      const name = `${String(s.first_name ?? "").trim()} ${String(s.last_name ?? "").trim()}`.trim();
      if (name) nameById.set(uid, name);
    }
  }
  for (const r of rows) {
    const uid = String(r.reviewed_by_user_id ?? "").trim();
    if (uid && nameById.has(uid)) r.reviewed_by_name = nameById.get(uid);
  }
  return NextResponse.json({
    success: true,
    entries: rows.map(mapJournalRow),
  });
}

export async function POST(request: Request) {
  const session = await getPortalSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Row | null;
  const entryType = String(body?.entryType ?? "").trim() as EntryType;
  if (!ENTRY_TYPES.includes(entryType)) {
    return NextResponse.json(
      { success: false, error: "entryType must be one of: " + ENTRY_TYPES.join(", ") },
      { status: 400 },
    );
  }
  const tagsRaw = Array.isArray(body?.tags) ? (body!.tags as unknown[]) : [];
  const tags = tagsRaw
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);
  const sanitized = sanitizeBody(entryType, body?.body);

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ success: false, error: "DB unavailable" }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("patient_journal_entries")
    .insert({
      organization_id: session.organizationId,
      client_id: session.clientId,
      entry_type: entryType,
      body: sanitized,
      tags,
    })
    .select(
      "id, entry_type, body, tags, audio_storage_path, audio_mime_type, audio_duration_seconds, audio_transcript, imported_into_note_id, imported_into_field, imported_at, created_at, updated_at",
    )
    .single();
  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "Failed to create entry" },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, entry: mapJournalRow(data as Row) });
}
