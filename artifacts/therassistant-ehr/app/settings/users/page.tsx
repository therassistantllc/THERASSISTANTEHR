import { requireAuthenticatedStaff, hasRole } from "@/lib/rbac/auth";
import { STAFF_ROLES } from "@/lib/rbac/constants";
import Link from "next/link";
import UsersSettingsClient from "./UsersSettingsClient";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const staff = await requireAuthenticatedStaff();

  const isProd = process.env.NODE_ENV === "production";
  let authorized = false;
  if (!isProd) {
    // Keep settings pages usable in local/dev even when seeded accounts are
    // not admins yet.
    authorized = true;
  } else if (staff) {
    authorized = await hasRole(staff.staffId, staff.organizationId, STAFF_ROLES.ADMIN);
  }

  if (!authorized) {
    return <UsersSettingsClient />;
  }

  return <UsersSettingsClient apiEnabled={Boolean(staff)} />;
}
