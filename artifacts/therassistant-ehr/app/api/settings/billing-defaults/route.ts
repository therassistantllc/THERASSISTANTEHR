import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import {
  REJECTION_277CA_AUTOROUTE_DEFAULTS,
  REJECTION_277CA_AUTOROUTE_SETTING_KEY,
} from "@/lib/billing/rejections277ca";
const BILLING_DEFAULTS_KEY = "billing.defaults";

const AUTOROUTE_AUDIT_ACTION = "rejections_277ca_autoroute_updated";
const AUTOROUTE_OBJECT_TYPE = "system_setting";
const RECENT_AUTOROUTE_CHANGES_LIMIT = 20;

// Per-org payer-status auto-check overrides live in `organization_settings`,
// one row per key (matches what `resolveAutoCheckConfig` reads).
const PAYER_STATUS_AUTOCHECK_KEYS = {
  enabled: "payer_status.auto_check_enabled",
  ageDays: "payer_status.auto_check_age_days",
  recheckIntervalDays: "payer_status.auto_recheck_interval_days",
} as const;

const PAYER_STATUS_AUTOCHECK_DEFAULTS = {
  enabled: true,
  auto_check_age_days: 3,
  auto_recheck_interval_days: 2,
};


const DEFAULTS = {
  claim_frequency_code: "1",
  default_pos: "11",
  default_diagnosis_behavior: "first_encounter",
  default_procedure_charge_behavior: "manual",
  eligibility_recheck_days: 30,
  claim_hold_days: 3,
  aging_bucket_rules: "30/60/90/120",
  auto_route_missing_info: true,
};

const AUTOROUTE_DEFAULTS = {
  enabled: REJECTION_277CA_AUTOROUTE_DEFAULTS.enabled,
  route_invalid_member: REJECTION_277CA_AUTOROUTE_DEFAULTS.routeInvalidMember,
  route_invalid_provider: REJECTION_277CA_AUTOROUTE_DEFAULTS.routeInvalidProvider,
};

const AUTOROUTE_FIELD_LABELS: Record<keyof typeof AUTOROUTE_DEFAULTS, string> = {
  enabled: "Enable 277CA auto-routing",
  route_invalid_member: "Auto-defer Invalid Member rejections",
  route_invalid_provider: "Auto-defer Invalid Provider rejections",
};

function pickBooleans<T extends Record<string, boolean>>(
  defaults: T,
  raw: Record<string, unknown>,
): T {
  const out = { ...defaults } as Record<string, boolean>;
  for (const key of Object.keys(defaults)) {
    if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  }
  return out as T;
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

  const { data, error } = await supabase
    .from("system_settings")
    .select("setting_key,setting_value")
    .eq("organization_id", organizationId)
    .in("setting_key", [BILLING_DEFAULTS_KEY, REJECTION_277CA_AUTOROUTE_SETTING_KEY]);

  if (error) {
    console.error("[GET /api/settings/billing-defaults]", error);
    return NextResponse.json({ error: "Failed to load billing defaults" }, { status: 500 });
  }

  const rows = Array.isArray(data) ? data : [];
  const defaultsRow = rows.find((r) => r.setting_key === BILLING_DEFAULTS_KEY);
  const autorouteRow = rows.find((r) => r.setting_key === REJECTION_277CA_AUTOROUTE_SETTING_KEY);

  const storedDefaults =
    defaultsRow?.setting_value && typeof defaultsRow.setting_value === "object" && !Array.isArray(defaultsRow.setting_value)
      ? (defaultsRow.setting_value as Record<string, unknown>)
      : {};
  const storedAutoroute =
    autorouteRow?.setting_value && typeof autorouteRow.setting_value === "object" && !Array.isArray(autorouteRow.setting_value)
      ? (autorouteRow.setting_value as Record<string, unknown>)
      : {};

  const recentAutorouteChanges = await loadRecentAutorouteChanges(
    supabase,
    organizationId,
  );

  // Read the three per-org payer-status auto-check overrides from
  // `organization_settings` (separate table — the cron reads from there).
  const payerStatusAutoCheck = { ...PAYER_STATUS_AUTOCHECK_DEFAULTS };
  try {
    const { data: orgRows } = await supabase
      .from("organization_settings")
      .select("setting_key,setting_value")
      .eq("organization_id", organizationId)
      .in("setting_key", Object.values(PAYER_STATUS_AUTOCHECK_KEYS));
    for (const row of (orgRows ?? []) as Array<{ setting_key: string; setting_value: unknown }>) {
      if (row.setting_key === PAYER_STATUS_AUTOCHECK_KEYS.enabled) {
        const b = coerceBool(row.setting_value);
        if (b != null) payerStatusAutoCheck.enabled = b;
      } else if (row.setting_key === PAYER_STATUS_AUTOCHECK_KEYS.ageDays) {
        const n = coerceNonNegInt(row.setting_value);
        if (n != null) payerStatusAutoCheck.auto_check_age_days = n;
      } else if (row.setting_key === PAYER_STATUS_AUTOCHECK_KEYS.recheckIntervalDays) {
        const n = coerceNonNegInt(row.setting_value);
        if (n != null && n > 0) payerStatusAutoCheck.auto_recheck_interval_days = n;
      }
    }
  } catch (e) {
    // organization_settings is optional — fall through with defaults.
    console.warn("[GET /api/settings/billing-defaults] organization_settings unavailable", e);
  }

  return NextResponse.json({
    billing_defaults: { ...DEFAULTS, ...storedDefaults },
    rejections_277ca_autoroute: pickBooleans(AUTOROUTE_DEFAULTS, storedAutoroute),
    recent_autoroute_changes: recentAutorouteChanges,
    payer_status_auto_check: payerStatusAutoCheck,
  });
}

function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return null;
}

function coerceNonNegInt(v: unknown): number | null {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return null;
}

export async function PUT(req: NextRequest) {
  const guard = await requireOrgAccess({
    requestedOrganizationId: req.nextUrl.searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

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

  const allowedKeys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
  const updates: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in body) updates[key] = body[key];
  }

  const now = new Date().toISOString();
  const upserts: Array<{
    organization_id: string;
    setting_key: string;
    setting_value: Record<string, unknown>;
    updated_at: string;
    created_at: string;
  }> = [];

  // ── Per-org payer-status auto-check overrides (`organization_settings`) ──
  // Accept a `payer_status_auto_check` block from the client and translate it
  // into the three discrete rows the cron reads. We upsert one row per key
  // (not a single JSON blob) so `resolveAutoCheckConfig` keeps working
  // unchanged. Stored as raw scalars: bool for the toggle, integer for days.
  const payerStatusBody =
    body.payer_status_auto_check && typeof body.payer_status_auto_check === "object"
      ? (body.payer_status_auto_check as Record<string, unknown>)
      : null;
  const orgSettingUpserts: Array<{
    organization_id: string;
    setting_key: string;
    setting_value: unknown;
    updated_at: string;
    created_at: string;
  }> = [];
  if (payerStatusBody) {
    if (typeof payerStatusBody.enabled === "boolean") {
      orgSettingUpserts.push({
        organization_id: organizationId,
        setting_key: PAYER_STATUS_AUTOCHECK_KEYS.enabled,
        setting_value: payerStatusBody.enabled,
        updated_at: now,
        created_at: now,
      });
    }
    const ageRaw = payerStatusBody.auto_check_age_days;
    if (typeof ageRaw === "number" || typeof ageRaw === "string") {
      const n = Number(ageRaw);
      if (Number.isFinite(n) && n >= 0 && n <= 365) {
        orgSettingUpserts.push({
          organization_id: organizationId,
          setting_key: PAYER_STATUS_AUTOCHECK_KEYS.ageDays,
          setting_value: Math.floor(n),
          updated_at: now,
          created_at: now,
        });
      }
    }
    const recheckRaw = payerStatusBody.auto_recheck_interval_days;
    if (typeof recheckRaw === "number" || typeof recheckRaw === "string") {
      const n = Number(recheckRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 365) {
        orgSettingUpserts.push({
          organization_id: organizationId,
          setting_key: PAYER_STATUS_AUTOCHECK_KEYS.recheckIntervalDays,
          setting_value: Math.floor(n),
          updated_at: now,
          created_at: now,
        });
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    upserts.push({
      organization_id: organizationId,
      setting_key: BILLING_DEFAULTS_KEY,
      setting_value: updates,
      updated_at: now,
      created_at: now,
    });
  }

  let autorouteAuditPayload: {
    before: Record<string, boolean>;
    after: Record<string, boolean>;
  } | null = null;

  const autorouteBody =
    body.rejections_277ca_autoroute && typeof body.rejections_277ca_autoroute === "object"
      ? (body.rejections_277ca_autoroute as Record<string, unknown>)
      : null;
  if (autorouteBody) {
    const autorouteUpdates: Record<string, boolean> = {};
    for (const key of Object.keys(AUTOROUTE_DEFAULTS)) {
      if (typeof autorouteBody[key] === "boolean") {
        autorouteUpdates[key] = autorouteBody[key] as boolean;
      }
    }
    if (Object.keys(autorouteUpdates).length > 0) {
      // Load the prior value first so we can diff it for the audit log.
      const { data: existingRow, error: loadErr } = await supabase
        .from("system_settings")
        .select("setting_value")
        .eq("organization_id", organizationId)
        .eq("setting_key", REJECTION_277CA_AUTOROUTE_SETTING_KEY)
        .maybeSingle();
      if (loadErr) {
        console.error("[PUT /api/settings/billing-defaults] load prior autoroute", loadErr);
        return NextResponse.json(
          { error: "Failed to save billing defaults" },
          { status: 500 },
        );
      }
      const storedPrior =
        existingRow?.setting_value && typeof existingRow.setting_value === "object" && !Array.isArray(existingRow.setting_value)
          ? (existingRow.setting_value as Record<string, unknown>)
          : {};
      const beforeValues = pickBooleans(AUTOROUTE_DEFAULTS, storedPrior);
      const afterValues = pickBooleans(AUTOROUTE_DEFAULTS, {
        ...beforeValues,
        ...autorouteUpdates,
      });

      autorouteAuditPayload = { before: beforeValues, after: afterValues };

      upserts.push({
        organization_id: organizationId,
        setting_key: REJECTION_277CA_AUTOROUTE_SETTING_KEY,
        setting_value: autorouteUpdates,
        updated_at: now,
        created_at: now,
      });
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("system_settings")
      .upsert(upserts, { onConflict: "organization_id,setting_key" });
    if (error) {
      console.error("[PUT /api/settings/billing-defaults]", error);
      return NextResponse.json({ error: "Failed to save billing defaults" }, { status: 500 });
    }
  }

  if (orgSettingUpserts.length > 0) {
    const { error: orgErr } = await supabase
      .from("organization_settings")
      .upsert(orgSettingUpserts, { onConflict: "organization_id,setting_key" });
    if (orgErr) {
      console.error("[PUT /api/settings/billing-defaults] organization_settings", orgErr);
      return NextResponse.json(
        { error: "Failed to save payer-status auto-check settings" },
        { status: 500 },
      );
    }
  }

  if (autorouteAuditPayload) {
    await writeAutorouteAuditLogs({
      supabase,
      organizationId,
      userId: guard.userId,
      userRole: guard.roles[0] ?? null,
      before: autorouteAuditPayload.before,
      after: autorouteAuditPayload.after,
    });
  }

  return NextResponse.json({ success: true });
}

type AdminClient = NonNullable<ReturnType<typeof createServerSupabaseAdminClient>>;

async function writeAutorouteAuditLogs(params: {
  supabase: AdminClient;
  organizationId: string;
  userId: string | null;
  userRole: string | null;
  before: Record<string, boolean>;
  after: Record<string, boolean>;
}): Promise<void> {
  const { supabase, organizationId, userId, userRole, before, after } = params;
  const rows: Array<Record<string, unknown>> = [];
  for (const key of Object.keys(AUTOROUTE_DEFAULTS) as (keyof typeof AUTOROUTE_DEFAULTS)[]) {
    const priorValue = before[key];
    const newValue = after[key];
    if (priorValue === newValue) continue;
    const label = AUTOROUTE_FIELD_LABELS[key];
    rows.push({
      organization_id: organizationId,
      user_id: userId,
      user_role: userRole,
      action: AUTOROUTE_AUDIT_ACTION,
      object_type: AUTOROUTE_OBJECT_TYPE,
      object_id: null,
      before_value: { [key]: priorValue },
      after_value: { [key]: newValue },
      event_type: AUTOROUTE_AUDIT_ACTION,
      event_summary: `277CA auto-routing: ${label} turned ${newValue ? "on" : "off"}`,
      event_metadata: {
        setting_key: REJECTION_277CA_AUTOROUTE_SETTING_KEY,
        field: key,
        field_label: label,
      },
    });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("audit_logs").insert(rows as never);
  if (error) {
    // Audit failure should not block the user's save (the upsert already
    // succeeded), but it must be loud so it gets noticed.
    console.error(
      "[PUT /api/settings/billing-defaults] audit_logs insert failed",
      error.message,
    );
  }
}

export interface AutorouteAuditChange {
  id: string;
  created_at: string;
  field: string;
  field_label: string;
  before_value: boolean | null;
  after_value: boolean | null;
  user_id: string | null;
  user_role: string | null;
  actor_label: string | null;
}

async function loadRecentAutorouteChanges(
  supabase: AdminClient,
  organizationId: string,
): Promise<AutorouteAuditChange[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, created_at, action, before_value, after_value, event_metadata, user_id, user_role",
    )
    .eq("organization_id", organizationId)
    .eq("action", AUTOROUTE_AUDIT_ACTION)
    .order("created_at", { ascending: false })
    .limit(RECENT_AUTOROUTE_CHANGES_LIMIT);

  if (error) {
    console.error(
      "[GET /api/settings/billing-defaults] recent autoroute changes",
      error,
    );
    return [];
  }

  const rows = Array.isArray(data) ? data : [];
  const userIds = Array.from(
    new Set(
      rows
        .map((r) => (r as { user_id?: string | null }).user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );

  const actorByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: staffRows, error: staffErr } = await supabase
      .from("staff_profiles")
      .select("auth_user_id, email, first_name, last_name")
      .in("auth_user_id", userIds);
    if (staffErr) {
      console.error(
        "[GET /api/settings/billing-defaults] staff lookup",
        staffErr,
      );
    } else if (Array.isArray(staffRows)) {
      for (const s of staffRows as Array<{
        auth_user_id: string | null;
        email: string | null;
        first_name: string | null;
        last_name: string | null;
      }>) {
        if (!s.auth_user_id) continue;
        const name = [s.first_name, s.last_name].filter(Boolean).join(" ");
        actorByUserId.set(s.auth_user_id, name || s.email || s.auth_user_id);
      }
    }
  }

  return rows.map((raw) => {
    const r = raw as {
      id: string;
      created_at: string;
      before_value: Record<string, unknown> | null;
      after_value: Record<string, unknown> | null;
      event_metadata: Record<string, unknown> | null;
      user_id: string | null;
      user_role: string | null;
    };
    const meta = r.event_metadata ?? {};
    const field =
      typeof meta.field === "string"
        ? meta.field
        : Object.keys(r.before_value ?? r.after_value ?? {})[0] ?? "";
    const fieldLabel =
      typeof meta.field_label === "string"
        ? meta.field_label
        : AUTOROUTE_FIELD_LABELS[field as keyof typeof AUTOROUTE_DEFAULTS] ?? field;
    const beforeVal = r.before_value?.[field];
    const afterVal = r.after_value?.[field];
    return {
      id: r.id,
      created_at: r.created_at,
      field,
      field_label: fieldLabel,
      before_value: typeof beforeVal === "boolean" ? beforeVal : null,
      after_value: typeof afterVal === "boolean" ? afterVal : null,
      user_id: r.user_id,
      user_role: r.user_role,
      actor_label: r.user_id ? actorByUserId.get(r.user_id) ?? null : null,
    };
  });
}
