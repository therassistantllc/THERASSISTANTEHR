/**
 * POST /api/admin/security/password-reset
 *
 * Admin-only: send a password recovery email to a staff member via Supabase
 * Auth. We use `auth.admin.generateLink({ type: 'recovery' })` which both
 * generates the action link and (when Supabase SMTP is configured) emails it
 * to the user. The action is recorded in audit_logs.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoleInRoute, parseRequestBody, isValidUuid } from "@/lib/rbac/middleware";
import {
  createServerSupabaseAdminClient,
  createServerSupabaseServiceRoleClient,
} from "@/lib/supabase/server";
import { STAFF_ROLES } from "@/lib/rbac/constants";

interface PasswordResetPayload {
  staff_id: string;
}

export async function POST(request: NextRequest) {
  const authOrError = await requireRoleInRoute(STAFF_ROLES.ADMIN);
  if (authOrError instanceof NextResponse) return authOrError;

  const { staffId: actorStaffId, organizationId, email: actorEmail, firstName, lastName } =
    authOrError;

  const bodyOrError = await parseRequestBody<PasswordResetPayload>(request);
  if (bodyOrError instanceof NextResponse) return bodyOrError;
  const { staff_id: targetStaffId } = bodyOrError;

  if (!targetStaffId || !isValidUuid(targetStaffId)) {
    return NextResponse.json({ error: "Invalid or missing staff_id" }, { status: 400 });
  }

  const supabase = createServerSupabaseAdminClient();
  const serviceRole = createServerSupabaseServiceRoleClient();
  if (!supabase || !serviceRole) {
    return NextResponse.json(
      { error: "Service role key is required to send a password reset." },
      { status: 503 },
    );
  }

  const { data: target, error: targetError } = await supabase
    .from("staff_profiles")
    .select("id, organization_id, email, auth_user_id, first_name, last_name, archived_at")
    .eq("id", targetStaffId)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  }
  if (target.organization_id !== organizationId) {
    return NextResponse.json({ error: "Access denied: organization mismatch" }, { status: 403 });
  }
  if (target.archived_at) {
    return NextResponse.json(
      { error: "Cannot reset password for an archived staff member" },
      { status: 400 },
    );
  }
  if (!target.email) {
    return NextResponse.json(
      { error: "Staff member has no email address on file" },
      { status: 400 },
    );
  }

  const redirectBase = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || ""
  ).replace(/\/$/, "");
  const redirectTo = redirectBase ? `${redirectBase}/auth/reset-password` : undefined;

  const { error: linkError } = await serviceRole.auth.admin.generateLink({
    type: "recovery",
    email: target.email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (linkError) {
    return NextResponse.json(
      { error: `Failed to send recovery email: ${linkError.message}` },
      { status: 502 },
    );
  }

  const actorName = [firstName, lastName].filter(Boolean).join(" ") || null;
  await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    user_role: STAFF_ROLES.ADMIN,
    action: "password_reset_sent",
    object_type: "staff_profile",
    object_id: target.id,
    event_type: "password_reset_sent",
    event_summary: `Password reset email sent to ${target.email}`,
    event_metadata: {
      actor_staff_id: actorStaffId,
      actor_name: actorName,
      actor_email: actorEmail,
      target_email: target.email,
      target_name: [target.first_name, target.last_name].filter(Boolean).join(" ") || null,
    },
  });

  return NextResponse.json({
    success: true,
    message: `Recovery email queued for ${target.email}.`,
  });
}
