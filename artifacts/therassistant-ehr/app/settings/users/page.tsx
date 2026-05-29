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
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Users</h1>
          </div>
          <div className="hero-actions">
            <Link className="button button-secondary" href="/settings">← Settings</Link>
          </div>
        </section>
        <section className="panel" role="alert">
          <h2>403 — Not authorized</h2>
          <p style={{ color: "var(--text-secondary)" }}>
            Only organization administrators can manage users.
          </p>
        </section>
      </main>
    );
  }

  return <UsersSettingsClient apiEnabled={Boolean(staff)} />;
}
