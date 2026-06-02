"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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

function DollarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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

function XCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease", marginLeft: "auto", flexShrink: 0, opacity: 0.5 }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function active(pathname: string, prefixes: string[], exact = false): boolean {
  if (exact) return prefixes.includes(pathname);
  return prefixes.some((p) => pathname.startsWith(p));
}

const CLAIMS_PREFIXES = [
  "/billing/claims",
  "/billing/documentation-pending",
  "/billing/no-response",
  "/billing/claim-readiness",
  "/billing/batches",
  "/billing/claim-edit-dashboard",
  "/billing/resubmissions",
  "/billing/corrected-claims",
  "/billing/submitted-claims",
  "/billing/payer-received",
  "/billing/appeals",
  "/billing/cob-issues",
  "/billing/secondary-billing",
  "/billing/transmission-failures",
  "/billing/claim-build-errors",
  "/billing/claim-hold",
  "/billing/ready-to-generate",
  "/billing/adjustments-review",
  "/billing/audit-queue",
  "/billing/compliance-audit",
  "/billing/compliance-holds",
  "/billing/blocked-claims",
];

const BATCHES_837P_PREFIXES = [
  "/billing/837p-batches",
  "/billing/orphaned-batches",
];

const REJECTIONS_PREFIXES = [
  "/billing/rejections",
  "/billing/rejections-999",
  "/billing/rejections-277ca",
  "/billing/payer-rejections",
  "/billing/authorization-required",
  "/billing/provider-enrollment-issues",
];

const ERA_INSURANCE_PREFIXES = [
  "/billing/payments/era",
  "/billing/payments",
  "/billing/era-import",
  "/billing/unmatched-era",
  "/billing/partial-payments",
  "/billing/unposted-payments",
  "/billing/vcc",
];

const PAPER_CHECKS_PREFIXES = [
  "/billing/paper-checks",
  "/billing/fax-queue",
];

const PATIENT_BALANCES_PREFIXES = [
  "/billing/patient-balances",
  "/billing/patient-responsibility",
  "/billing/patient-billing",
  "/billing/bad-debt-review",
  "/billing/write-offs",
];

const REFUNDS_CREDITS_PREFIXES = [
  "/billing/refunds",
  "/billing/credit-balances",
  "/billing/recoupments",
];

const RECONCILIATION_PREFIXES = [
  "/billing/reconciliation-exceptions",
];

const PAYMENTS_PREFIXES = [
  ...ERA_INSURANCE_PREFIXES,
  ...PAPER_CHECKS_PREFIXES,
  ...PATIENT_BALANCES_PREFIXES,
  ...REFUNDS_CREDITS_PREFIXES,
  ...RECONCILIATION_PREFIXES,
];

export default function AppSidebarNav() {
  const pathname = usePathname();

  const billingGroupActive = pathname.startsWith("/billing");
  const billingRouteActive = pathname.startsWith("/billing");
  const paymentsActive = PAYMENTS_PREFIXES.some((p) => pathname.startsWith(p));

  const [billingOpen, setBillingOpen] = useState(billingRouteActive || false);
  const [paymentsOpen, setPaymentsOpen] = useState(paymentsActive || false);

  const billingExpanded = billingOpen || billingRouteActive;
  const paymentsExpanded = billingExpanded || paymentsOpen || paymentsActive;

  return (
    <nav className={styles.nav} aria-label="Primary navigation">

      {/* ── HOME ─────────────────────────────────────────────── */}
      <div className={styles.navSection}>Home</div>

      <NavLink href="/calendar" icon={<CalendarIcon />} label="Schedule" prefixes={["/calendar", "/clinician/agenda"]} pathname={pathname} />
      <NavLink href="/clients" icon={<UsersIcon />} label="Clients" prefixes={["/clients", "/patients"]} pathname={pathname} />
      <NavLink href="/inbox" icon={<TasksIcon />} label="Inbox" prefixes={["/inbox"]} pathname={pathname} />
      <NavLink href="/chat" icon={<ChatIcon />} label="Chat" prefixes={["/chat"]} pathname={pathname} />
      <NavLink href="/mailroom" icon={<InboxIcon />} label="Mailroom" prefixes={["/mailroom"]} pathname={pathname} />
      <NavLink href="/settings" icon={<ShieldIcon />} label="Settings" prefixes={["/settings"]} pathname={pathname} />
      <NavLink
        href="/settings/system-readiness"
        icon={<ChartIcon />}
        label="Admin"
        prefixes={["/settings/system-readiness", "/settings/audit-log", "/settings/edi"]}
        pathname={pathname}
      />

      {/* ── BILLING ──────────────────────────────────────────── */}
      <div className={styles.navSectionSpacer} />
      <div className={styles.navSection}>Billing</div>

      <button
        type="button"
        className={`${styles.navItem} ${styles.navItemCollapsible} ${billingGroupActive ? styles.navItemActive : ""}`}
        onClick={() => setBillingOpen((o) => !o)}
        aria-expanded={billingExpanded}
      >
        <span className={styles.navIcon}><DollarIcon /></span>
        Billing
        <ChevronIcon open={billingExpanded} />
      </button>

      {billingExpanded ? (
        <div className={styles.subnav}>
          <SubNavLinkIcon href="/billing/my-inbox" icon={<TasksIcon />} label="Dashboard" prefixes={["/billing/my-inbox", "/billing/executive-priority"]} pathname={pathname} badge={<MyInboxBadge />} />
          <SubNavLinkIcon href="/billing/charge-capture" icon={<ClipboardIcon />} label="Charges" prefixes={["/billing/charge-capture", "/billing/charges"]} pathname={pathname} />
          <SubNavLinkIcon href="/billing/eligibility-batches" icon={<ShieldIcon />} label="Eligibility" prefixes={["/billing/eligibility-batches", "/billing/eligibility-issues"]} pathname={pathname} />
          <SubNavLinkIcon href="/billing/claims" icon={<ClipboardIcon />} label="Claims" prefixes={CLAIMS_PREFIXES} pathname={pathname} />
          <SubNavLinkIcon href="/billing/837p-batches" icon={<ClipboardIcon />} label="837P Batches" prefixes={BATCHES_837P_PREFIXES} pathname={pathname} />
          <SubNavLinkIcon href="/billing/rejections" icon={<XCircleIcon />} label="Rejections" prefixes={REJECTIONS_PREFIXES} pathname={pathname} />
          <SubNavLinkIcon href="/billing/denials" icon={<XCircleIcon />} label="Denials" prefixes={["/billing/denials", "/billing/denials-by-carc", "/billing/denials-by-rarc", "/billing/partial-denials", "/billing/underpayments", "/billing/timely-filing", "/billing/medical-necessity", "/billing/medical-review", "/billing/aging", "/billing/claim-submission"]} pathname={pathname} />

          {/* ── Payments submenu ───────────────────────────────────── */}
          <button
            type="button"
            className={`${styles.subnavItem} ${styles.subnavItemCollapsible ?? ""} ${paymentsActive ? styles.subnavItemActive : ""}`}
            onClick={() => setPaymentsOpen((o) => !o)}
            aria-expanded={paymentsExpanded}
            style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
          >
            <span className={styles.subnavIcon}><CreditCardIcon /></span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>Payments</span>
            <ChevronIcon open={paymentsExpanded} />
          </button>

          {paymentsExpanded ? (
            <div style={{ paddingLeft: 12 }}>
              <SubNavLinkIcon href="/billing/payments/era" icon={<CreditCardIcon />} label="ERA / Insurance" prefixes={ERA_INSURANCE_PREFIXES} pathname={pathname} />
              <SubNavLinkIcon href="/billing/paper-checks" icon={<InboxIcon />} label="Paper Checks" prefixes={PAPER_CHECKS_PREFIXES} pathname={pathname} />
              <SubNavLinkIcon href="/billing/patient-balances" icon={<UsersIcon />} label="Patient Balances" prefixes={PATIENT_BALANCES_PREFIXES} pathname={pathname} />
              <SubNavLinkIcon href="/billing/refunds" icon={<CreditCardIcon />} label="Refunds / Credits" prefixes={REFUNDS_CREDITS_PREFIXES} pathname={pathname} />
              <SubNavLinkIcon href="/billing/reconciliation-exceptions" icon={<ChartIcon />} label="Reconciliation" prefixes={RECONCILIATION_PREFIXES} pathname={pathname} />
            </div>
          ) : null}

          <SubNavLinkIcon href="/billing/reports" icon={<ChartIcon />} label="Reports" prefixes={["/billing/reports"]} pathname={pathname} />
        </div>
      ) : null}

    </nav>
  );
}

function NavLink({
  href, icon, label, prefixes, pathname, exact = false, activeOverride, disabled = false,
}: {
  href: string; icon: React.ReactNode; label: string; prefixes: string[]; pathname: string;
  exact?: boolean; activeOverride?: boolean; disabled?: boolean;
}) {
  const isActive = activeOverride !== undefined
    ? activeOverride
    : exact
    ? pathname === href || prefixes.includes(pathname)
    : prefixes.some((p) => pathname.startsWith(p));

  if (disabled) {
    return (
      <span className={`${styles.navItem} ${styles.navItemDisabled}`}>
        <span className={styles.navIcon}>{icon}</span>
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={styles.navIcon}>{icon}</span>
      {label}
    </Link>
  );
}

function SubNavLinkIcon({
  href, icon, label, prefixes, pathname, badge,
}: {
  href: string; icon: React.ReactNode; label: string; prefixes: string[]; pathname: string;
  badge?: React.ReactNode;
}) {
  const isActive = prefixes.some((p) => pathname.startsWith(p));
  return (
    <Link
      href={href}
      className={isActive ? `${styles.subnavItem} ${styles.subnavItemActive}` : styles.subnavItem}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={styles.subnavIcon}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {badge ?? null}
    </Link>
  );
}

function MyInboxBadge() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/billing/my-inbox?countOnly=1", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { count?: number };
        if (!cancelled) setCount(typeof json.count === "number" ? json.count : 0);
      } catch {
        /* badge is best-effort; ignore failures */
      }
    }
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  if (!count) return null;
  return (
    <span
      aria-label={`${count} routed eligibility items`}
      style={{
        background: "#DC2626",
        color: "#FFFFFF",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        padding: "1px 7px",
        minWidth: 18,
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

