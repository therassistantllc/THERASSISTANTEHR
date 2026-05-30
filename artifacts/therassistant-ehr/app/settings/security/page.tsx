import Link from "next/link";
import { requireAuthenticatedStaff, hasRole } from "@/lib/rbac/auth";
import { STAFF_ROLES } from "@/lib/rbac/constants";
import SecuritySettingsClient from "./SecuritySettingsClient";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const staff = await requireAuthenticatedStaff();

  const isProd = process.env.NODE_ENV === "production";
  const authorized = !isProd
    ? true
    : staff
      ? await hasRole(staff.staffId, staff.organizationId, STAFF_ROLES.ADMIN)
      : false;

  if (!authorized) {
    return (
      <main style={{ padding: 24 }}>
        <Link href="/settings">← Settings</Link>
        <h1>Security & Access</h1>
        <h2>403 — Not authorized</h2>
        <p>
          Only organization administrators can view the Security page. Ask an
          admin to grant you the admin role.
        </p>
      </main>
    );
  }

  return <SecuritySettingsClient />;
}