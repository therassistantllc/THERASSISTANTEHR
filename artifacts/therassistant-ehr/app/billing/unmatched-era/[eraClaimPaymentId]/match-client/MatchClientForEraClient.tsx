"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type ClientRow = { id: string; name: string; dateOfBirth?: string | null; phone?: string | null; email?: string | null };

function initialSearchName() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("patientName") || "";
}

export default function MatchClientForEraClient({
  eraClaimPaymentId,
  initialOrganizationId,
}: {
  eraClaimPaymentId: string;
  initialOrganizationId: string;
}) {
  const organizationId = useMemo(() => initialOrganizationId || DEFAULT_ORG_ID, [initialOrganizationId]);
  const [q, setQ] = useState(initialSearchName);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadClients(search = q) {
    setError(null);
    const params = new URLSearchParams({ organizationId, limit: "25" });
    if (search.trim()) params.set("q", search.trim());
    const res = await fetch(`/api/clients?${params.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || "Could not load clients");
    setClients(json.clients ?? []);
  }

  useEffect(() => {
    const search = initialSearchName();
    if (search) setQ(search);
    void loadClients(search).catch((e) => setError(e instanceof Error ? e.message : "Could not load clients"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function save() {
    if (!clientId) {
      setError("Select a client first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/billing/era-payments/${encodeURIComponent(eraClaimPaymentId)}/match-client`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, clientId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Could not save match");
      setNotice("Saved. This ERA line is ready to post to the selected client account.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save match");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: 24, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Match ERA to client</h1>
          <p style={{ margin: "6px 0 0", color: "#475569" }}>Select the patient account for this imported ERA line.</p>
        </div>
        <Link href={`/billing/unmatched-era?organizationId=${encodeURIComponent(organizationId)}`}>Back</Link>
      </div>

      {notice ? <div style={{ padding: 12, border: "1px solid #86efac", background: "#f0fdf4", color: "#166534", borderRadius: 8 }}>{notice}</div> : null}
      {error ? <div style={{ padding: 12, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>{error}</div> : null}

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" style={{ flex: 1, minHeight: 38, padding: "0 10px", border: "1px solid #cbd5e1", borderRadius: 6 }} />
          <button type="button" onClick={() => void loadClients().catch((e) => setError(e instanceof Error ? e.message : "Could not load clients"))}>Search</button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {clients.map((client) => (
            <label key={client.id} style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
              <input type="radio" name="client" checked={clientId === client.id} onChange={() => setClientId(client.id)} />
              <span><strong>{client.name}</strong><span style={{ color: "#64748b", marginLeft: 8 }}>{client.dateOfBirth ? `DOB ${client.dateOfBirth}` : ""}{client.phone ? ` · ${client.phone}` : ""}{client.email ? ` · ${client.email}` : ""}</span></span>
            </label>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={save} disabled={busy || !clientId}>{busy ? "Saving…" : "Save match"}</button>
      </div>
    </main>
  );
}
