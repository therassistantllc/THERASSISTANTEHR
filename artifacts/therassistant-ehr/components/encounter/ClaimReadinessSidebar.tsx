"use client";

export type ClaimReadinessCheck = {
  label: string;
  isComplete: boolean;
  required: boolean;
};

type Props = {
  checks: ClaimReadinessCheck[];
};

export default function ClaimReadinessSidebar({ checks }: Props) {
  const requiredChecks = checks.filter((check) => check.required);
  const optionalChecks = checks.filter((check) => !check.required);

  const requiredComplete = requiredChecks.filter((check) => check.isComplete).length;
  const requiredTotal = requiredChecks.length;

  const isReady = requiredTotal > 0 && requiredComplete === requiredTotal;

  return (
    <aside
      style={{
        border: "1px solid #d8dee8",
        borderRadius: 10,
        padding: 16,
        background: "#ffffff",
        width: "100%",
        maxWidth: 320,
      }}
      aria-label="Claim readiness"
    >
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          Claim Readiness
        </h3>

        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#5f6b7a" }}>
          {isReady
            ? "Ready for billing review"
            : `${requiredComplete} of ${requiredTotal} required checks complete`}
        </p>
      </div>

      <div
        style={{
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 14,
          background: isReady ? "#ecfdf3" : "#fff7ed",
          border: isReady ? "1px solid #b7ebc6" : "1px solid #fed7aa",
          fontSize: 13,
          fontWeight: 600,
          color: isReady ? "#166534" : "#9a3412",
        }}
      >
        {isReady ? "READY" : "NOT READY"}
      </div>

      <section>
        <h4 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>
          Required
        </h4>

        {requiredChecks.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
            No required checks configured.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {requiredChecks.map((check) => (
              <li
                key={check.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  fontSize: 13,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    background: check.isComplete ? "#dcfce7" : "#fee2e2",
                    color: check.isComplete ? "#166534" : "#991b1b",
                    flexShrink: 0,
                  }}
                >
                  {check.isComplete ? "✓" : "!"}
                </span>

                <span style={{ color: check.isComplete ? "#1f2937" : "#991b1b" }}>
                  {check.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {optionalChecks.length > 0 && (
        <section style={{ marginTop: 14 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700 }}>
            Optional
          </h4>

          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {optionalChecks.map((check) => (
              <li
                key={check.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  fontSize: 13,
                  color: "#374151",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    background: check.isComplete ? "#e0f2fe" : "#f3f4f6",
                    color: check.isComplete ? "#075985" : "#6b7280",
                    flexShrink: 0,
                  }}
                >
                  {check.isComplete ? "✓" : "–"}
                </span>

                <span>{check.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}