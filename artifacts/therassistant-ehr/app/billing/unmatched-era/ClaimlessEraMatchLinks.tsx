"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type EraRow = {
  eraClaimPaymentId: string;
  payerName: string | null;
  patientName: string;
  claimNumberFromEra: string;
  paidAmount: number;
  clientId: string | null;
  tab: string;
};

function getOrg() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

export default function ClaimlessEraMatchLinks() {
  const organizationId = useMemo(() => getOrg(), []);
  const [rows, setRows] = useState<EraRow[]>([]);

  useEffect(() => {
    const qs = new URLSearchParams({ organizationId });
    fetch(`/api/billing/unmatched-era?${qs.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json?.success) return;
        setRows((json.items ?? []).filter((row: EraRow) => !row.clientId || row.tab === "client_match_needed"));
      })
      .catch(() => setRows([]));
  }, [organizationId]);

  if (rows.length === 0) return null;

  return (
    <section style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
      <strong>Client match needed</strong>
      {rows.slice(0, 10).map((row) => (
        <div key={row.eraClaimPaymentId} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
          <span>{row.patientName || row.claimNumberFromEra || row.payerName || "ERA row"}</span>
          <Link href={`/billing/unmatched-era/${encodeURIComponent(row.eraClaimPaymentId)}/match-client?organizationId=${encodeURIComponent(organizationId)}`}>Match client</Link>
        </div>
      ))}
    </section>
  );
}
