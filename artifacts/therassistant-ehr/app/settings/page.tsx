import { SettingsIndexTable, type SettingsIndexRow } from "./_components/SettingsTables";

const rows: SettingsIndexRow[] = [
  {
    settingArea: "Users & Clinicians",
    purpose: "Manage user access and clinician roster settings.",
    route: "/settings/users",
    status: "Placeholder",
  },
  {
    settingArea: "Organizations",
    purpose: "Review organization profile and legal entity details.",
    route: "/settings/organizations",
    status: "Live",
  },
  {
    settingArea: "Payers",
    purpose: "Configure payer profiles and operational references.",
    route: "/settings/payers",
    status: "Placeholder",
  },
  {
    settingArea: "Clearinghouse / Availity",
    purpose: "Manage clearinghouse connectivity and transport setup.",
    route: "/settings/clearinghouse",
    status: "Placeholder",
  },
  {
    settingArea: "Service Locations",
    purpose: "Track service location configuration used across workflows.",
    route: "/settings/service-locations",
    status: "Placeholder",
  },
  {
    settingArea: "Billing Defaults",
    purpose: "Maintain billing-level defaults used by operational pages.",
    route: "/settings/billing-defaults",
    status: "Placeholder",
  },
  {
    settingArea: "Patient Portal",
    purpose: "Configure patient portal-level settings and behavior.",
    route: "/settings/portal",
    status: "Placeholder",
  },
  {
    settingArea: "Security",
    purpose: "Manage security controls and access policy settings.",
    route: "/settings/security",
    status: "Placeholder",
  },
  {
    settingArea: "System Readiness",
    purpose: "Review readiness checks and deployment prerequisites.",
    route: "/settings/system-readiness",
    status: "Placeholder",
  },
  {
    settingArea: "Audit Log",
    purpose: "Review administrative actions and compliance events.",
    route: "/settings/audit-log",
    status: "Placeholder",
  },
  {
    settingArea: "Mailroom Settings",
    purpose: "Configure mailroom operational defaults and processing.",
    route: "/settings/mailroom",
    status: "Placeholder",
  },
  {
    settingArea: "Trading Partner",
    purpose: "Maintain trading partner profile and identifiers.",
    route: "/settings/trading-partner",
    status: "Placeholder",
  },
  {
    settingArea: "Payer Enrollments",
    purpose: "Track and manage payer enrollment setup status.",
    route: "/settings/payer-enrollments",
    status: "Placeholder",
  },
  {
    settingArea: "Business Associate Agreements",
    purpose: "Track BAA documentation and review state.",
    route: "/settings/baa",
    status: "Placeholder",
  },
  {
    settingArea: "Code Sets",
    purpose: "Manage code-set references used by the platform.",
    route: "/settings/code-sets",
    status: "Placeholder",
  },
  {
    settingArea: "EDI Setup",
    purpose: "Centralize EDI setup references and readiness notes.",
    route: "/settings/edi",
    status: "Placeholder",
  },
];

export default function SettingsPage() {
  return <SettingsIndexTable rows={rows} />;
}
