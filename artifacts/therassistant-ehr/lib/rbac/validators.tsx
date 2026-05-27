/**
 * Validation Helpers for Staff/Role Management API
 * Provides reusable validation functions for email, roles, staffing constraints, etc.
 */

import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.toLowerCase());
}

/**
 * Validate email uniqueness within organization
 */
export async function isEmailUniqueInOrg(
  email: string,
  organizationId: string,
  excludeStaffId?: string,
): Promise<boolean> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return false;

  let query = supabase
    .from("staff_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", email.toLowerCase())
    .is("archived_at", null);

  if (excludeStaffId) {
    query = query.neq("id", excludeStaffId);
  }

  const { data, error } = await query;

  if (error) return false;
  return !data || data.length === 0;
}

/**
 * Check if role exists in organization
 */
export async function roleExistsInOrg(
  roleId: string,
  organizationId: string,
): Promise<boolean> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("staff_roles")
    .select("id")
    .eq("id", roleId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .single();

  return !error && !!data;
}

/**
 * Check if staff member is the last active admin in organization
 * If true, prevent deactivation to avoid locking out the org
 */
export async function isLastActiveAdmin(
  staffId: string,
  organizationId: string,
): Promise<boolean> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return false;

  // Get admin role ID for this org
  const { data: adminRole, error: roleError } = await supabase
    .from("staff_roles")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("role_code", "admin")
    .is("archived_at", null)
    .single();

  if (roleError || !adminRole) return false;

  // Count active admins in org (excluding this staff member)
  const { data: activeAdmins, error: countError } = await supabase
    .from("staff_role_assignments")
    .select("staff_id", { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("staff_role_id", adminRole.id)
    .neq("staff_id", staffId)
    .is("archived_at", null);

  if (countError) return false;

  const activeAdminCount = activeAdmins?.length ?? 0;
  return activeAdminCount === 0;
}

/**
 * Check if staff member already has a specific role assignment (active)
 */
export async function staffHasRoleAssignment(
  staffId: string,
  roleId: string,
  organizationId: string,
): Promise<boolean> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("staff_role_assignments")
    .select("id")
    .eq("staff_id", staffId)
    .eq("staff_role_id", roleId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .single();

  return !error && !!data;
}

/**
 * Validate create staff payload
 */
export interface CreateStaffPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  job_title?: string;
  provider_npi?: string;
  is_active?: boolean;
}

export async function validateCreateStaffPayload(
  payload: CreateStaffPayload,
  organizationId: string,
): Promise<{ valid: boolean; error?: string }> {
  // Validate required fields
  if (!payload.first_name?.trim()) {
    return { valid: false, error: "First name is required" };
  }
  if (!payload.last_name?.trim()) {
    return { valid: false, error: "Last name is required" };
  }
  if (!payload.email?.trim()) {
    return { valid: false, error: "Email is required" };
  }

  // Validate email format
  if (!isValidEmail(payload.email)) {
    return { valid: false, error: "Invalid email format" };
  }

  // Check email uniqueness
  const emailUnique = await isEmailUniqueInOrg(payload.email, organizationId);
  if (!emailUnique) {
    return { valid: false, error: "Email already exists in organization" };
  }

  return { valid: true };
}

