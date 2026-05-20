// File: app/api/mailroom/file/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Server Supabase configuration is missing");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const body = await req.json();
    const {
      mailroom_item_id,
      filing_destination,
      target_id,
      admin_comments,
      organization_id,
    } = body;

    if (!mailroom_item_id || !filing_destination || !organization_id) {
      return NextResponse.json(
        { error: "Missing required fields: mailroom_item_id, filing_destination, organization_id" },
        { status: 400 }
      );
    }

    // Get mailroom item, enforcing org ownership
    const { data: mailroomItem, error: mailroomError } = await supabase
      .from("mailroom_items")
      .select("*")
      .eq("id", mailroom_item_id)
      .eq("organization_id", organization_id)
      .single();

    if (mailroomError || !mailroomItem) {
      return NextResponse.json(
        { error: "Mailroom item not found" },
        { status: 404 }
      );
    }

    const mimeType =
      clean((mailroomItem as Record<string, unknown>).mime_type) ||
      clean((mailroomItem as Record<string, unknown>).file_mime_type) ||
      "application/pdf";

    const scope =
      filing_destination === "patient_chart" ? "client"
      : filing_destination === "claim" ? "claim"
      : filing_destination === "encounter" ? "encounter"
      : "practice";

    // Create document record using actual schema columns
    const documentData: Record<string, unknown> = {
      organization_id,
      mailroom_item_id,
      document_scope: scope,
      document_type: clean((mailroomItem as Record<string, unknown>).document_type) || "other",
      file_name: clean((mailroomItem as Record<string, unknown>).file_name) || "mailroom_document",
      mime_type: mimeType,
      storage_bucket: clean((mailroomItem as Record<string, unknown>).storage_bucket) || null,
      storage_path: clean((mailroomItem as Record<string, unknown>).storage_path) || null,
      uploaded_by_user_id: (mailroomItem as Record<string, unknown>).uploaded_by_user_id || null,
      filed_at: new Date().toISOString(),
      notes: admin_comments || null,
    };

    // Set appropriate FK based on filing destination
    if (filing_destination === "patient_chart" && target_id) {
      documentData.client_id = target_id;
    } else if (filing_destination === "claim" && target_id) {
      documentData.claim_id = target_id;
    } else if (filing_destination === "encounter" && target_id) {
      documentData.encounter_id = target_id;
    }

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .insert([documentData])
      .select()
      .single();

    if (documentError) {
      return NextResponse.json(
        { error: `Failed to create document: ${documentError.message}` },
        { status: 500 }
      );
    }

    // Update mailroom item status to filed (with org guard)
    const { error: updateError } = await supabase
      .from("mailroom_items")
      .update({
        status: "filed",
        admin_comments: admin_comments ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mailroom_item_id)
      .eq("organization_id", organization_id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update mailroom item: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      document_id: document.id,
      message: "Document filed successfully",
    });
  } catch (error: unknown) {
    console.error("Mailroom filing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
