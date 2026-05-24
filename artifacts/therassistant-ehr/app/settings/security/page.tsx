import Link from "next/link";
import { requireAuthenticatedStaff, hasRole } from "@/lib/rbac/auth";
import { STAFF_ROLES } from "@/lib/rbac/constants";
import SecuritySettingsClient from "./SecuritySettingsClient";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const staff = await requireAuthenticatedStaff();

  // In development we allow access when there's no logged-in staff so the
  // page is still reachable from the settings shell. In production we require
  // an admin role.
  const isProd = process.env.NODE_ENV === "production";
  let authorized = false;
  if (staff) {
    authorized = await hasRole(staff.staffId, staff.organizationId, STAFF_ROLES.ADMIN);
  } else if (!isProd) {
    authorized = true;
  }

  if (!authorized) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Security &amp; Access</h1>
            <p className="hero-copy">Restricted area.</p>
          </div>
          <div className="hero-actions">
            <Link className="button button-secondary" href="/settings">← Settings</Link>
          </div>
        </section>
        <section className="panel" role="alert">
          <h2>403 — Not authorized</h2>
          <p style={{ color: "var(--text-secondary)" }}>
            Only organization administrators can view the Security page. If you need
            access, ask an admin to grant you the <code>admin</code> role.
          </p>
        </section>
      </main>
    );
  }

  return <SecuritySettingsClient />;
}
