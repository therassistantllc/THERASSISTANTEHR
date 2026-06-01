import Link from "next/link";

type SettingsCard = {
  label: string;
  href: string;
  description: string;
};

type SettingsSection = {
  title: string;
  cards: SettingsCard[];
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: "Practice Setup",
    cards: [
      {
        label: "Organization Profile",
        href: "/settings/organization",
        description: "Practice identity, organization records, and core profile settings.",
      },
      {
        label: "Users & Provider Profiles",
        href: "/settings/users",
        description: "User access, clinician mappings, and provider profile management.",
      },
      {
        label: "Service Locations",
        href: "/settings/service-locations",
        description: "Facilities, place-of-service setup, and location defaults.",
      },
    ],
  },
  {
    title: "Billing Setup",
    cards: [
      {
        label: "Payers",
        href: "/settings/payers",
        description: "Payer profiles, identifiers, and billing relationships.",
      },
      {
        label: "Clearinghouse",
        href: "/settings/clearinghouse",
        description: "Clearinghouse credentials, connectivity, and submission plumbing.",
      },
      {
        label: "Eligibility Setup",
        href: "/settings/payer-enrollments",
        description: "Eligibility enrollment configuration and payer-specific readiness.",
      },
      {
        label: "ERA / Payment Setup",
        href: "/billing/payments",
        description: "Insurance payment workflows, ERA processing, and posting controls.",
      },
      {
        label: "Billing Defaults",
        href: "/settings/billing-defaults",
        description: "Claiming defaults, billing rules, and coding baseline configuration.",
      },
    ],
  },
  {
    title: "Operations",
    cards: [
      {
        label: "Mailroom Routing",
        href: "/settings/mailroom",
        description: "Inbound document routing, filing behavior, and mailroom controls.",
      },
      {
        label: "Patient Portal",
        href: "/settings/portal",
        description: "Portal messaging, access surfaces, and client-facing experience settings.",
      },
      {
        label: "Workqueue Rules",
        href: "/admin/payer-rules",
        description: "Rule-driven workflow routing and payer-response automation behavior.",
      },
    ],
  },
  {
    title: "Oversight",
    cards: [
      {
        label: "System Readiness",
        href: "/settings/system-readiness",
        description: "Operational readiness checks for claim generation and transmission.",
      },
      {
        label: "Security",
        href: "/settings/security",
        description: "Access policy and security posture controls for administration.",
      },
      {
        label: "Audit Log",
        href: "/settings/audit-log",
        description: "Trace setting changes and administrative events over time.",
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Settings</h1>
          <p className="hero-copy">
            Configure practice, billing, and operations from one structured setup center.
          </p>
        </div>
      </section>

      {SETTINGS_SECTIONS.map((section) => (
        <section key={section.title} style={{ marginTop: 20 }}>
          <h2 style={{ marginBottom: 12 }}>{section.title}</h2>
          <div
            className="metric-grid"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {section.cards.map((card) => (
              <Link key={card.label} href={card.href} style={{ textDecoration: "none" }}>
                <article className="metric-card" style={{ cursor: "pointer", minHeight: "96px" }}>
                  <strong>{card.label}</strong>
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-secondary)",
                      marginTop: "4px",
                    }}
                  >
                    {card.description}
                  </span>
                </article>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
