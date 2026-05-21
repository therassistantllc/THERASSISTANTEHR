import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { normalizePayerBillingRules } from "@/lib/validation/claim/facts";

/**
 * Coerce arbitrary client input into the canonical billing-rules shape so we
 * never persist unexpected keys / types into the jsonb column. Re-uses the
 * same normalizer the validation engine consumes, guaranteeing the rules
 * surface in the engine exactly as written here.
 */
function sanitizeBillingRules(raw: unknown): Record<string, unknown> {
  const r = normalizePayerBillingRules(raw);
  return {
    requires_telehealth_modifier: r.requires_telehealth_modifier,
    allowed_pos_codes: r.allowed_pos_codes,
    requires_rendering_provider_taxonomy: r.requires_rendering_provider_taxonomy,
    requires_subscriber_relationship: r.requires_subscriber_relationship,
    timely_filing_days: r.timely_filing_days,
    allowed_cpt_codes: r.allowed_cpt_codes,
    denied_cpt_codes: r.denied_cpt_codes,
  };
}

function getOrgId(req: NextRequest) {
  return (
    req.nextUrl.searchParams.get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    ""
  );
}

export async function GET(req: NextRequest) {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("payer_profiles")
    .select(
      "id, payer_name, availity_payer_id, payer_type, is_active, notes, requires_authorization, billing_rules, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("payer_name", { ascending: true });

  if (error) {
    console.error("[GET /api/settings/payer-profiles]", error);
    return NextResponse.json({ error: "Failed to load payer profiles" }, { status: 500 });
  }

  return NextResponse.json({ payers: data ?? [] });
}

export async function POST(req: NextRequest) {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.payer_name || !body.availity_payer_id) {
    return NextResponse.json({ error: "payer_name and availity_payer_id are required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("payer_profiles")
    .insert({
      organization_id: organizationId,
      payer_name: String(body.payer_name),
      availity_payer_id: String(body.availity_payer_id),
      payer_type: body.payer_type ? String(body.payer_type) : null,
      is_active: Boolean(body.is_active ?? true),
      notes: body.notes ? String(body.notes) : null,
      requires_authorization: Boolean(body.requires_authorization ?? false),
      billing_rules: sanitizeBillingRules(body.billing_rules),
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[POST /api/settings/payer-profiles]", error);
    return NextResponse.json({ error: "Failed to create payer profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query parameter required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const allowedFields = [
    "payer_name",
    "availity_payer_id",
    "payer_type",
    "is_active",
    "notes",
    "requires_authorization",
  ] as const;
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }
  if ("billing_rules" in body) {
    updates.billing_rules = sanitizeBillingRules(body.billing_rules);
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("payer_profiles")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    console.error("[PATCH /api/settings/payer-profiles]", error);
    return NextResponse.json({ error: "Failed to update payer profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const organizationId = getOrgId(req);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query parameter required" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  // Soft-delete via is_active = false rather than hard delete
  const { error } = await supabase
    .from("payer_profiles")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    console.error("[DELETE /api/settings/payer-profiles]", error);
    return NextResponse.json({ error: "Failed to deactivate payer profile" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
