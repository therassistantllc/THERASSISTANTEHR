"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRbac } from "@/lib/rbac/client";
import styles from "./AppShell.module.css";

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

function active(pathname: string, prefixes: string[], exact = false): boolean {
  if (exact) return prefixes.includes(pathname);
  return prefixes.some((p) => pathname.startsWith(p));
}

// Prefix arrays referencing existing routes
const DASHBOARD_PREFIXES = ["/billing/my-inbox", "/billing/executive-priority"];
const CHARGE_CAPTURE_PREFIXES = ["/billing/charge-capture", "/billing/charges"];
const BATCHES_837P_PREFIXES = ["/billing/batches", "/billing/837p-batches", "/billing/orphaned-batches"];
const CLAIMS_PREFIXES = ["/billing/claims", "/billing/documentation-pending", "/billing/no-response", "/billing/resubmissions", "/billing/corrected-claims", "/billing/submitted-claims", "/billing/payer-received", "/billing/appeals", "/billing/cob-issues", "/billing/secondary-billing", "/billing/transmission-failures", "/billing/claim-hold", "/billing/adjustments-review", "/billing/audit-queue", "/billing/compliance-audit", "/billing/compliance-holds", "/billing/blocked-claims"];
const ELIGIBILITY_PREFIXES = ["/billing/eligibility-batches", "/billing/eligibility-issues"];
const PAYMENTS_PREFIXES = ["/billing/payments/era", "/billing/payments", "/billing/era-import", "/billing/unmatched-era", "/billing/partial-payments", "/billing/unposted-payments", "/billing/vcc", "/billing/paper-checks", "/billing/fax-queue", "/billing/patient-balances", "/billing/patient-responsibility", "/billing/patient-billing", "/billing/bad-debt-review", "/billing/write-offs", "/billing/refunds", "/billing/credit-balances", "/billing/recoupments", "/billing/reconciliation-exceptions"];
const DENIALS_PREFIXES = ["/billing/denials", "/billing/denials-by-carc", "/billing/denials-by-rarc", "/billing/partial-denials", "/billing/underpayments", "/billing/timely-filing", "/billing/medical-necessity", "/billing/medical-review", "/billing/aging", "/billing/claim-submission"];

type PermissionCode =
  | "dashboard.read"
  | "schedule.read"
  | "workqueue.read"
  | "clients.read"
  | "clinical.read"
  | "billing.read"
  | "charge_capture.read"
  | "claims.read"
  | "eligibility.read"
  | "payments.read"
  | "denials.read"
  | "documents.read"
  | "settings.read"
  | "settings.manage";

export default function AppSidebarNav() {
  const pathname = usePathname();
  const rbac = useRbac();

  const allow = (permissions: PermissionCode[]) => {
    if (rbac.loading || rbac.error) return true;
    return rbac.hasAnyPermission(permissions);
  };

  return (
    <nav className={styles.nav} aria-label="Primary navigation">
      {/* Today group */}
      <div className={styles.navSection}>Today</div>
      {allow(["dashboard.read", "workqueue.read"]) && <NavLink href="/billing/my-inbox" icon={<TasksIcon />} label="Dashboard" prefixes={DASHBOARD_PREFIXES} pathname={pathname} />}
      {allow(["schedule.read"]) && <NavLink href="/calendar" icon={<CalendarIcon />} label="Schedule" prefixes={["/calendar", "/clinician/agenda"]} pathname={pathname} />}
      {allow(["workqueue.read"]) && <NavLink href="/inbox" icon={<TasksIcon />} label="My Workqueue" prefixes={["/inbox"]} pathname={pathname} />}
      <div className={styles.navSectionSpacer} />
      {/* Clinical group */}
      {allow(["clients.read", "clinical.read"]) && <div className={styles.navSection}>Clinical</div>}
      {allow(["clients.read", "clinical.read"]) && <NavLink href="/clients" icon={<UsersIcon />} label="Clients" prefixes={["/clients", "/patients"]} pathname={pathname} />}
      <div className={styles.navSectionSpacer} />
      {/* Billing group */}
      {allow(["billing.read", "charge_capture.read", "claims.read", "eligibility.read", "payments.read", "denials.read"]) && <div className={styles.navSection}>Billing</div>}
      {allow(["billing.read", "charge_capture.read"]) && <NavLink href="/billing/charge-capture" icon={<ClipboardIcon />} label="Charge Capture" prefixes={CHARGE_CAPTURE_PREFIXES} pathname={pathname} />}
      {allow(["billing.read", "claims.read"]) && <NavLink href="/billing/claims" icon={<ClipboardIcon />} label="Claims" prefixes={CLAIMS_PREFIXES} pathname={pathname} />}
      {allow(["billing.read", "claims.read"]) && <NavLink href="/billing/batches" icon={<ClipboardIcon />} label="837P Batches" prefixes={BATCHES_837P_PREFIXES} pathname={pathname} />}
      {allow(["billing.read", "eligibility.read"]) && <NavLink href="/billing/eligibility-batches" icon={<ShieldIcon />} label="Eligibility" prefixes={ELIGIBILITY_PREFIXES} pathname={pathname} />}
      {allow(["billing.read", "payments.read"]) && <NavLink href="/billing/payments" icon={<CreditCardIcon />} label="Payments" prefixes={PAYMENTS_PREFIXES} pathname={pathname} />}
      {allow(["billing.read", "denials.read"]) && <NavLink href="/billing/denials-by-carc" icon={<XCircleIcon />} label="Denials & Appeals" prefixes={DENIALS_PREFIXES} pathname={pathname} />}
      <div className={styles.navSectionSpacer} />
      {/* Operations group */}
      {allow(["documents.read", "settings.read", "settings.manage"]) && <div className={styles.navSection}>Operations</div>}
      {allow(["documents.read"]) && <NavLink href="/mailroom" icon={<InboxIcon />} label="Documents" prefixes={["/mailroom"]} pathname={pathname} />}
      {allow(["settings.read", "settings.manage"]) && <NavLink href="/settings" icon={<ShieldIcon />} label="Settings" prefixes={["/settings"]} pathname={pathname} />}
      {allow(["settings.manage"]) && <NavLink href="/settings/system-readiness" icon={<ChartIcon />} label="Admin" prefixes={["/settings/system-readiness", "/settings/audit-log", "/settings/edi"]} pathname={pathname} />}
    </nav>
  );
}

function NavLink({ href, icon, label, prefixes, pathname }: { href: string; icon: React.ReactNode; label: string; prefixes: string[]; pathname: string }) {
  const isActive = active(pathname, prefixes);
  return (
    <Link href={href} className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}> 
      <span className={styles.navIcon}>{icon}</span>
      {label}
    </Link>
  );
}
