import { NextRequest, NextResponse } from "next/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import { normalizePortalSettings, PORTAL_SETTINGS_KEY } from "@/lib/portal/portalSettings";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type PortalSettingsPayload = {
  portalDisplayName?: unknown;
  welcomeHeadingTemplate?: unknown;
  welcomeMessage?: unknown;
  supportMessage?: unknown;
  accentColor?: unknown;
};

function validate(payload: PortalSettingsPayload): Record<string, string> {
  const errors: Record<string, string> = {};
  const displayName = String(payload.portalDisplayName ?? "").trim();
  const heading = String(payload.welcomeHeadingTemplate ?? "").trim();
  const welcome = String(payload.welcomeMessage ?? "").trim();
  const support = String(payload.supportMessage ?? "").trim();
  const accent = String(payload.accentColor ?? "").trim();

  if (displayName.length > 80) {
    errors.portalDisplayName = "Display name must be 80 characters or fewer.";
  }
  if (heading.length > 120) {
    errors.welcomeHeadingTemplate = "Welcome heading must be 120 characters or fewer.";
  }
  if (welcome.length > 400) {
    errors.welcomeMessage = "Welcome message must be 400 characters or fewer.";
  }
  if (support.length > 400) {
    errors.supportMessage = "Support message must be 400 characters or fewer.";
  }
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    errors.accentColor = "Accent color must be a hex color like #1D4ED8.";
  }

  return errors;
}

export async function GET(req: NextRequest) {
  const guard = await requireOrgAccess({
    requestedOrganizationId: req.nextUrl.searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;

  const organizationId = guard.organizationId;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  const [{ data: org }, { data: row }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("system_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", PORTAL_SETTINGS_KEY)
      .maybeSingle(),
  ]);

  const settings = normalizePortalSettings(row?.setting_value);
  return NextResponse.json({
    success: true,
    organizationName: String(org?.name ?? "").trim(),
    settings,
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOrgAccess({
    requestedOrganizationId: req.nextUrl.searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;

  const organizationId = guard.organizationId;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Database connection not available" }, { status: 503 });
  }

  let body: PortalSettingsPayload;
  try {
    body = (await req.json()) as PortalSettingsPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validate(body);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "Validation failed for one or more fields.", fields: errors },
      { status: 422 },
    );
  }

  const normalized = normalizePortalSettings(body);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("system_settings")
    .upsert(
      {
        organization_id: organizationId,
        setting_key: PORTAL_SETTINGS_KEY,
        setting_value: normalized,
        updated_at: now,
        created_at: now,
      },
      { onConflict: "organization_id,setting_key" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ success: true, settings: normalized });
}
