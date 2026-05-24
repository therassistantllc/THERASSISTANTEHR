"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type PayerRule = {
  id: string;
  payer: string | null;
  payerProfileId: string | null;
  rarcCode: string | null;
  carcCode: string | null;
  rule: string;
  recommendedAction: string | null;
  source: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type DraftRule = {
  payer: string;
  rarcCode: string;
  carcCode: string;
  rule: string;
  recommendedAction: string;
};

const EMPTY_DRAFT: DraftRule = {
  payer: "",
  rarcCode: "",
  carcCode: "",
  rule: "",
  recommendedAction: "",
};

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

export default function PayerRulesClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [rules, setRules] = useState<PayerRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/billing/payer-rules?organizationId=${encodeURIComponent(organizationId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        rules?: PayerRule[];
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load payer rules");
      }
      setRules(json.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payer rules");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  function startNew() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(rule: PayerRule) {
    setEditingId(rule.id);
    setDraft({
      payer: rule.payer ?? "",
      rarcCode: rule.rarcCode ?? "",
      carcCode: rule.carcCode ?? "",
      rule: rule.rule,
      recommendedAction: rule.recommendedAction ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  }

  async function save() {
    if (!draft.rule.trim()) {
      setError("Rule text is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const res = await fetch(`/api/billing/payer-rules`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          id: isNew ? undefined : editingId,
          payer: draft.payer.trim() || null,
          rarcCode: draft.rarcCode.trim() || null,
          carcCode: draft.carcCode.trim() || null,
          rule: draft.rule.trim(),
          recommendedAction: draft.recommendedAction.trim() || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? `Save failed (${res.status})`);
      }
      setMessage(isNew ? "Rule created" : "Rule updated");
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  async function archive(rule: PayerRule) {
    if (!confirm(`Archive rule for ${rule.payer ?? "any payer"} / ${rule.rarcCode ?? rule.carcCode ?? "any code"}?`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/billing/payer-rules?id=${encodeURIComponent(rule.id)}&organizationId=${encodeURIComponent(organizationId)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? `Archive failed (${res.status})`);
      }
      setMessage("Rule archived");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive rule");
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => {
      const haystack = [
        r.payer ?? "",
        r.rarcCode ?? "",
        r.carcCode ?? "",
        r.rule,
        r.recommendedAction ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rules, filter]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Payer rules</h1>
          <p style={{ color: "#6B7280", margin: "4px 0 0", fontSize: 13 }}>
            Standing handling rules for payer/RARC/CARC combinations.
            Rules created from the Denials-by-RARC queue show up here.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            style={{ padding: 8, border: "1px solid #D1D5DB", borderRadius: 4, fontSize: 13 }}
          />
          <button type="button" className="button" onClick={startNew}>
            + New rule
          </button>
        </div>
      </header>

      {error ? (
        <div style={{ background: "#FEE2E2", color: "#991B1B", padding: 10, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div style={{ background: "#DCFCE7", color: "#166534", padding: 10, borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          {message}
        </div>
      ) : null}

      {editingId ? (
        <div style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: 16, marginBottom: 16, background: "#F9FAFB" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
            {editingId === "new" ? "New payer rule" : "Edit payer rule"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px", gap: 12, marginBottom: 12 }}>
            <Field label="Payer name (leave blank for any payer)">
              <input
                value={draft.payer}
                onChange={(e) => setDraft({ ...draft, payer: e.target.value })}
                placeholder="Aetna"
                style={inputStyle}
              />
            </Field>
            <Field label="RARC code">
              <input
                value={draft.rarcCode}
                onChange={(e) => setDraft({ ...draft, rarcCode: e.target.value.toUpperCase() })}
                placeholder="M25"
                style={inputStyle}
              />
            </Field>
            <Field label="CARC code">
              <input
                value={draft.carcCode}
                onChange={(e) => setDraft({ ...draft, carcCode: e.target.value.toUpperCase() })}
                placeholder="97"
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="Rule">
            <textarea
              value={draft.rule}
              onChange={(e) => setDraft({ ...draft, rule: e.target.value })}
              rows={4}
              style={{ ...inputStyle, fontFamily: "inherit" }}
            />
          </Field>
          <Field label="Recommended action (optional)">
            <input
              value={draft.recommendedAction}
              onChange={(e) => setDraft({ ...draft, recommendedAction: e.target.value })}
              placeholder="Attach treatment plan and resubmit"
              style={inputStyle}
            />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="button button-secondary" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save rule"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: "#6B7280" }}>Loading rules…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#6B7280", fontStyle: "italic" }}>
          No payer rules yet. Create one from the Denials-by-RARC queue
          or click “New rule” above.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#F1F5F9", textAlign: "left" }}>
              <th style={thStyle}>Payer</th>
              <th style={thStyle}>RARC</th>
              <th style={thStyle}>CARC</th>
              <th style={thStyle}>Rule</th>
              <th style={thStyle}>Updated</th>
              <th style={{ ...thStyle, width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                <td style={tdStyle}>{r.payer ?? <span style={muted}>any payer</span>}</td>
                <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace" }}>
                  {r.rarcCode ?? <span style={muted}>—</span>}
                </td>
                <td style={{ ...tdStyle, fontFamily: "ui-monospace, monospace" }}>
                  {r.carcCode ?? <span style={muted}>—</span>}
                </td>
                <td style={tdStyle}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{r.rule}</div>
                  {r.recommendedAction ? (
                    <div style={{ color: "#6B7280", fontSize: 12, marginTop: 4 }}>
                      Action: {r.recommendedAction}
                    </div>
                  ) : null}
                </td>
                <td style={{ ...tdStyle, color: "#6B7280", whiteSpace: "nowrap" }}>
                  {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "—"}
                </td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button type="button" className="button button-secondary" onClick={() => startEdit(r)} style={{ marginRight: 6 }}>
                    Edit
                  </button>
                  <button type="button" className="button button-secondary" onClick={() => archive(r)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #D1D5DB",
  borderRadius: 4,
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  color: "#475569",
  letterSpacing: 0.4,
};

const tdStyle: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "top",
};

const muted: React.CSSProperties = { color: "#9CA3AF" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
