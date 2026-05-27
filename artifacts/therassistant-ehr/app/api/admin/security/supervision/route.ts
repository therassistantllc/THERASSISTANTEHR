/**
 * PUT /api/admin/security/supervision
 *
 * Admin-only: update supervision billing rules per staff member.
 * Rules are stored under organization_settings.setting_key =
 * "security.supervision.rules" as a JSON object keyed by staff_profile.id.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoleInRoute, parseRequestBody, isValidUuid } from "@/lib/rbac/middleware";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/lib/rbac/constants";

const SUPERVISION_KEY = "security.supervision.rules";
const AUDIT_ACTION = "staff_supervision_billing_updated";

interface SupervisionRule {
  enabled: boolean;
  supervisorProviderId: string | null;
  applyToAllPayers: boolean;
  payerProfileIds: string[];
}

interface Body {
  staffId: string;
  rule: SupervisionRule;
}

export async function PUT(request: NextRequest) {
  const authOrError = await requireRoleInRoute(STAFF_ROLES.ADMIN);
  if (authOrError instanceof NextResponse) return authOrError;
  const { organizationId, staffId: actorStaffId, email: actorEmail, firstName, lastName } = authOrError;

  const bodyOrError = await parseRequestBody<Body>(request);
  if (bodyOrError instanceof NextResponse) return bodyOrError;
  const body = bodyOrError;

  if (!body.staffId || !isValidUuid(body.staffId)) {
    return NextResponse.json({ error: "Invalid staffId" }, { status: 400 });
  }

  const rule = body.rule;
  if (!rule || typeof rule !== "object") {
    return NextResponse.json({ error: "rule is required" }, { status: 400 });
  }

  const normalized: SupervisionRule = {
    enabled: Boolean(rule.enabled),
    supervisorProviderId:
      typeof rule.supervisorProviderId === "string" && rule.supervisorProviderId.trim()
        ? rule.supervisorProviderId.trim()
        : null,
    applyToAllPayers: rule.applyToAllPayers !== false,
    payerProfileIds: Array.isArray(rule.payerProfileIds)
      ? rule.payerProfileIds.map((x) => String(x)).filter((x) => isValidUuid(x))
      : [],
  };

  if (normalized.enabled && !normalized.supervisorProviderId) {
    return NextResponse.json(
      { error: "A supervisor provider is required when supervision is enabled" },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  // Validate target staff belongs to org.
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("id, first_name, last_name, email")
    .eq("id", body.staffId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .maybeSingle();
  if (!staff) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }

  // Validate supervisor provider belongs to org.
  let supervisorProvider: { id: string; npi: string | null; display_name: string | null; first_name: string | null; last_name: string | null } | null = null;
  if (normalized.supervisorProviderId) {
    const { data: p } = await supabase
      .from("providers")
      .select("id, npi, display_name, first_name, last_name")
      .eq("id", normalized.supervisorProviderId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .eq("is_active", true)
      .maybeSingle();
    if (!p) {
      return NextResponse.json({ error: "Supervisor provider not found" }, { status: 404 });
    }
    supervisorProvider = p;
  }

  // Validate payer ids if payer-scoped.
  if (!normalized.applyToAllPayers && normalized.payerProfileIds.length > 0) {
    const { data: payers } = await supabase
      .from("payer_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .in("id", normalized.payerProfileIds);
    const found = new Set((payers ?? []).map((p) => String(p.id)));
    const missing = normalized.payerProfileIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Unknown payer profiles: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Load existing rules.
  let existing: Record<string, SupervisionRule> = {};
  try {
    const { data: row } = await (supabase as unknown as { from: (t: string) => any })
      .from("organization_settings")
      .select("setting_value")
      .eq("organization_id", organizationId)
      .eq("setting_key", SUPERVISION_KEY)
      .maybeSingle();
    if (row?.setting_value && typeof row.setting_value === "object" && !Array.isArray(row.setting_value)) {
      const raw = row.setting_value as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) {
        const r = (v ?? {}) as Record<string, unknown>;
        existing[k] = {
          enabled: Boolean(r.enabled),
          supervisorProviderId:
            typeof r.supervisorProviderId === "string" && r.supervisorProviderId.trim()
              ? r.supervisorProviderId.trim()
              : null,
          applyToAllPayers: r.applyToAllPayers !== false,
          payerProfileIds: Array.isArray(r.payerProfileIds)
            ? r.payerProfileIds.map((x) => String(x)).filter((x) => isValidUuid(x))
            : [],
        };
      }
    }
  } catch {
    existing = {};
  }

  const before = existing[body.staffId] ?? {
    enabled: false,
    supervisorProviderId: null,
    applyToAllPayers: true,
    payerProfileIds: [],
  };

  existing[body.staffId] = normalized;

  const now = new Date().toISOString();
  const { error: upsertError } = await (supabase as unknown as { from: (t: string) => any })
    .from("organization_settings")
    .upsert(
      {
        organization_id: organizationId,
        setting_key: SUPERVISION_KEY,
        setting_value: existing,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,setting_key" },
    );

  if (upsertError) {
    return NextResponse.json(
      { error: `Failed to save supervision rule: ${upsertError.message}` },
      { status: 500 },
    );
  }

  const actorName = [firstName, lastName].filter(Boolean).join(" ") || null;
  const targetName = [staff.first_name, staff.last_name].filter(Boolean).join(" ") || staff.email || body.staffId;
  const supervisorName = supervisorProvider
    ? String(supervisorProvider.display_name ?? "").trim() ||
      [supervisorProvider.first_name, supervisorProvider.last_name].filter(Boolean).join(" ")
    : null;

  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    user_role: STAFF_ROLES.ADMIN,
    action: AUDIT_ACTION,
    object_type: "staff_profile",
    object_id: body.staffId,
    event_type: AUDIT_ACTION,
    event_summary: `Updated supervision billing rule for ${targetName}`,
    before_value: before as unknown as Record<string, unknown>,
    after_value: normalized as unknown as Record<string, unknown>,
    event_metadata: {
      actor_staff_id: actorStaffId,
      actor_name: actorName,
      actor_email: actorEmail,
      target_staff_id: body.staffId,
      target_name: targetName,
      supervisor_provider_id: normalized.supervisorProviderId,
      supervisor_provider_name: supervisorName,
      supervisor_provider_npi: supervisorProvider?.npi ?? null,
      apply_to_all_payers: normalized.applyToAllPayers,
      payer_profile_ids: normalized.payerProfileIds,
    },
  });

  return NextResponse.json({ success: true, rule: normalized });
}
