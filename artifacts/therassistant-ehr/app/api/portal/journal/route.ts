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
      "id, entry_type, body, tags, audio_storage_path, audio_mime_type, audio_duration_seconds, imported_into_note_id, imported_into_field, imported_at, created_at, updated_at",
    )
    .eq("organization_id", session.organizationId)
    .eq("client_id", session.clientId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    entries: ((data ?? []) as Row[]).map(mapJournalRow),
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
      "id, entry_type, body, tags, audio_storage_path, audio_mime_type, audio_duration_seconds, imported_into_note_id, imported_into_field, imported_at, created_at, updated_at",
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
