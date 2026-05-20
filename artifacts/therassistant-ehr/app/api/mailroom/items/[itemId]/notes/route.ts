import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/config";

type DbRow = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function noteDto(row: DbRow) {
  return {
    id: clean(row.id),
    mailroomItemId: clean(row.mailroom_item_id),
    authorName: clean(row.author_name) || "Staff",
    authorUserId: clean(row.author_user_id),
    body: clean(row.body),
    createdAt: clean(row.created_at),
  };
}

async function ensureItemInOrg(
  supabase: ReturnType<typeof createServerSupabaseAdminClient>,
  itemId: string,
  organizationId: string,
) {
  if (!supabase) return false;
  const { data } = await supabase
    .from("mailroom_items")
    .select("id")
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { itemId } = await context.params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    if (!itemId) return NextResponse.json({ success: false, error: "itemId is required" }, { status: 400 });

    const allowed = await ensureItemInOrg(supabase, itemId, organizationId);
    if (!allowed) return NextResponse.json({ success: false, error: "Mailroom item not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("mailroom_item_notes")
      .select("id, mailroom_item_id, author_name, author_user_id, body, created_at")
      .eq("mailroom_item_id", itemId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    return NextResponse.json({ success: true, notes: ((data ?? []) as DbRow[]).map(noteDto) });
  } catch (error) {
    console.error("Mailroom notes GET error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to load notes" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });

    const { itemId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const organizationId = clean(body.organizationId) || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
    const text = clean(body.body);
    const authorName = clean(body.authorName) || "Staff";
    const authorUserId = clean(body.authorUserId) || null;

    if (!organizationId) return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    if (!itemId) return NextResponse.json({ success: false, error: "itemId is required" }, { status: 400 });
    if (!text) return NextResponse.json({ success: false, error: "Note body is required" }, { status: 400 });

    const allowed = await ensureItemInOrg(supabase, itemId, organizationId);
    if (!allowed) return NextResponse.json({ success: false, error: "Mailroom item not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("mailroom_item_notes")
      .insert({
        mailroom_item_id: itemId,
        organization_id: organizationId,
        author_name: authorName,
        author_user_id: authorUserId,
        body: text,
      })
      .select("id, mailroom_item_id, author_name, author_user_id, body, created_at")
      .single();

    if (error || !data) return NextResponse.json({ success: false, error: error?.message || "Failed to save note" }, { status: 422 });
    return NextResponse.json({ success: true, note: noteDto(data as DbRow) });
  } catch (error) {
    console.error("Mailroom notes POST error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to save note" }, { status: 500 });
  }
}
