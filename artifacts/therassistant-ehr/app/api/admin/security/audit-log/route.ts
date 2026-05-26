/**
 * GET /api/admin/security/audit-log
 *
 * Admin-only paginated read of public.audit_logs scoped to the caller's org.
 * Supports filters: actorId, action, from, to (date strings).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoleInRoute } from "@/lib/rbac/middleware";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/lib/rbac/constants";

type AuditRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  user_role: string | null;
  action: string | null;
  object_type: string | null;
  object_id: string | null;
  event_summary: string | null;
  event_metadata: Record<string, unknown> | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
};

function parseDateBound(value: string | null, endOfDay: boolean): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET(request: NextRequest) {
  const authOrError = await requireRoleInRoute(STAFF_ROLES.ADMIN);
  if (authOrError instanceof NextResponse) return authOrError;

  const { organizationId } = authOrError;

  const supabase = createServerSupabaseServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service role key is required to read audit logs." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? "50") || 50, 1),
    200,
  );
  const offset = Math.max(Number(searchParams.get("offset") ?? "0") || 0, 0);
  const from = parseDateBound(searchParams.get("from"), false);
  const to = parseDateBound(searchParams.get("to"), true);
  const action = (searchParams.get("action") ?? "").trim();
  const actorId = (searchParams.get("actorId") ?? "").trim();

  let query = supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_id, user_role, action, object_type, object_id, event_summary, event_metadata, before_value, after_value",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);
  if (action) query = query.eq("action", action);
  if (actorId) query = query.eq("user_id", actorId);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      { error: `Failed to read audit log: ${error.message}` },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as AuditRow[];
  const totalCount = typeof count === "number" ? count : null;

  // Resolve actor names — first via staff_profiles.auth_user_id, then via
  // event_metadata.actor_staff_id (some routes write that instead).
  const authIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id)),
  );
  const metaStaffIds = Array.from(
    new Set(
      rows
        .map((r) => (r.event_metadata?.actor_staff_id as string | undefined) ?? null)
        .filter((id): id is string => !!id),
    ),
  );

  const nameByAuth = new Map<string, { name: string; email: string | null }>();
  if (authIds.length > 0) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("auth_user_id, first_name, last_name, email")
      .in("auth_user_id", authIds);
    for (const row of (staff ?? []) as Array<{
      auth_user_id: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      if (!row.auth_user_id) continue;
      const name =
        [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unknown";
      nameByAuth.set(row.auth_user_id, { name, email: row.email });
    }
  }
  const nameByStaffId = new Map<string, { name: string; email: string | null }>();
  if (metaStaffIds.length > 0) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("id, first_name, last_name, email")
      .in("id", metaStaffIds);
    for (const row of (staff ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      const name =
        [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email || "Unknown";
      nameByStaffId.set(row.id, { name, email: row.email });
    }
  }

  const entries = rows.map((row) => {
    const meta = row.event_metadata ?? {};
    const metaStaffId = (meta.actor_staff_id as string | undefined) ?? null;
    const fromAuth = row.user_id ? nameByAuth.get(row.user_id) ?? null : null;
    const fromMeta = metaStaffId ? nameByStaffId.get(metaStaffId) ?? null : null;
    const fromMetaInline =
      typeof meta.actor_name === "string" && meta.actor_name
        ? { name: meta.actor_name as string, email: (meta.actor_email as string) || null }
        : null;
    const actor = fromAuth ?? fromMeta ?? fromMetaInline;
    // Surface settings-writer breadcrumbs (settings page audit writers stash
    // setting_key / field / field_label in event_metadata and a one-key
    // {field: value} object in before_value/after_value). The Security tab
    // renders these so admins can read a billing-defaults change here without
    // bouncing to the Billing Defaults page.
    const settingKey =
      typeof meta.setting_key === "string" ? (meta.setting_key as string) : null;
    const field = typeof meta.field === "string" ? (meta.field as string) : null;
    const fieldLabel =
      typeof meta.field_label === "string" ? (meta.field_label as string) : field;
    const before = row.before_value ?? null;
    const after = row.after_value ?? null;
    const beforeAtField =
      field && before && Object.prototype.hasOwnProperty.call(before, field)
        ? before[field]
        : null;
    const afterAtField =
      field && after && Object.prototype.hasOwnProperty.call(after, field)
        ? after[field]
        : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      summary: row.event_summary,
      actorId: row.user_id ?? metaStaffId,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      userRole: row.user_role,
      settingKey,
      field,
      fieldLabel,
      beforeValue: beforeAtField ?? before,
      afterValue: afterAtField ?? after,
      detail: meta,
    };
  });

  // Distinct action options (cheap, scoped to org, capped).
  const { data: actionRows } = await supabase
    .from("audit_logs")
    .select("action")
    .eq("organization_id", organizationId)
    .not("action", "is", null)
    .limit(2000);
  const actionOptions = Array.from(
    new Set(
      ((actionRows ?? []) as Array<{ action: string | null }>)
        .map((r) => r.action)
        .filter((a): a is string => !!a),
    ),
  ).sort();

  // Actor options drawn from organization staff (small set).
  const { data: staffRows } = await supabase
    .from("staff_profiles")
    .select("auth_user_id, first_name, last_name, email")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .not("auth_user_id", "is", null);
  const actorOptions = ((staffRows ?? []) as Array<{
    auth_user_id: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  }>)
    .filter((r) => !!r.auth_user_id)
    .map((r) => ({
      id: r.auth_user_id as string,
      name:
        [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email || "Unknown",
      email: r.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    success: true,
    entries,
    pagination: {
      limit,
      offset,
      returned: entries.length,
      totalCount,
      hasMore:
        totalCount === null ? entries.length === limit : offset + entries.length < totalCount,
    },
    filterOptions: { actions: actionOptions, actors: actorOptions },
  });
}
