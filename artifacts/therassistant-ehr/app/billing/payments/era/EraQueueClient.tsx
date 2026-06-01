"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, ChevronRight, Archive, Clock, Copy, FileText, Upload, Plus } from "lucide-react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import styles from "./era.module.css";

interface BatchListItem {
  id: string;
  source: string;
  fileName: string | null;
  importStatus: string;
  payer: { identifier: string | null; name: string };
  eftOrCheckNumber: string | null;
  paymentMethodCode: string | null;
  paymentDate: string | null;
  receivedAt: string | null;
  totalPaymentAmount: number;
  totalPatientResponsibility: number;
  totalAllocated: number;
  unallocated: number;
  counts: {
    total: number;
    matched: number;
    unmatched: number;
    blocked: number;
    posted: number;
    denied: number;
    recoupment: number;
  };
  archivedAt: string | null;
  deferred: boolean;
  markedDuplicateOf: string | null;
  assignedBiller: string | null;
  createdAt: string;
  updatedAt: string;
}

type Tab = "all" | "unmatched" | "blocked" | "ready" | "posted" | "denials" | "recoupment" | "deferred" | "archived";

const TAB_LABELS: Record<Tab, string> = {
  all: "All",
  unmatched: "Unmatched",
  blocked: "Blocked",
  ready: "Ready to post",
  posted: "Posted",
  denials: "Denials",
  recoupment: "Recoupment",
  deferred: "Deferred",
  archived: "Archived",
};

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function QuickAddPatientModal({
  organizationId,
  payerName,
  onClose,
  onCreated,
}: {
  organizationId: string;
  payerName: string;
  onClose: () => void;
  onCreated: (message: string) => Promise<void> | void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !dateOfBirth.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dateOfBirth.trim(),
          sexAtBirth: "unknown",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to create client");
      await onCreated("Patient created.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Failed to create client");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick add patient"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.38)",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "min(440px, 100%)",
          borderRadius: 18,
          border: "1px solid #CBD5E1",
          background: "#FFFFFF",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px", borderBottom: "1px solid #E2E8F0" }}>
          <div>
            <strong style={{ display: "block", fontSize: 16, color: "#0F172A" }}>Quick Add Patient</strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#64748B" }}>{payerName}</span>
          </div>
          <button type="button" onClick={onClose} disabled={saving} style={{ border: "none", background: "transparent", fontSize: 22, lineHeight: 1, color: "#64748B", cursor: saving ? "not-allowed" : "pointer" }}>
            ×
          </button>
        </div>
        <div style={{ padding: 18, display: "grid", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>This quick add stays on the ERA screen. Only name and date of birth are required.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
              <span>First name *</span>
              <input type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} required autoFocus style={{ border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
              <span>Last name *</span>
              <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} required style={{ border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, fontSize: 12, color: "#475569" }}>
            <span>Date of birth *</span>
            <input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} required max={new Date().toISOString().slice(0, 10)} style={{ border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px", fontSize: 14 }} />
          </label>
          {error ? <div style={{ color: "#B91C1C", fontSize: 12, fontWeight: 600 }}>{error}</div> : null}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} disabled={saving} className={styles.btn}>Cancel</button>
            <button type="submit" disabled={saving || !firstName.trim() || !lastName.trim() || !dateOfBirth.trim()} className={`${styles.btn} ${styles.btnPrimary}`}>
              {saving ? "Saving..." : "Save Patient"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function EraQueueClient() {
  const organizationId = DEFAULT_ORG_ID;
  const [items, setItems] = useState<BatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [addPatientBatch, setAddPatientBatch] = useState<BatchListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/billing/era-batches", window.location.origin);
      url.searchParams.set("organizationId", organizationId);
      if (includeArchived) url.searchParams.set("includeArchived", "1");
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load");
      setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [organizationId, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = {
      all: 0,
      unmatched: 0,
      blocked: 0,
      ready: 0,
      posted: 0,
      denials: 0,
      recoupment: 0,
      deferred: 0,
      archived: 0,
    };
    for (const b of items) {
      if (b.archivedAt) c.archived += 1;
      else c.all += 1;
      if (b.archivedAt) continue;
      if (b.deferred) c.deferred += 1;
      if (b.counts.unmatched > 0) c.unmatched += 1;
      if (b.counts.blocked > 0) c.blocked += 1;
      if (b.counts.posted === b.counts.total && b.counts.total > 0) c.posted += 1;
      else if (b.counts.matched > 0 && b.counts.posted < b.counts.total) c.ready += 1;
      if (b.counts.denied > 0) c.denials += 1;
      if (b.counts.recoupment > 0) c.recoupment += 1;
    }
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((b) => {
      const archived = Boolean(b.archivedAt);
      if (tab === "archived") {
        if (!archived) return false;
      } else if (archived) {
        return false;
      } else if (tab === "deferred") {
        if (!b.deferred) return false;
      } else if (tab === "unmatched") {
        if (b.counts.unmatched === 0) return false;
      } else if (tab === "blocked") {
        if (b.counts.blocked === 0) return false;
      } else if (tab === "ready") {
        if (b.counts.matched === 0 || b.counts.posted === b.counts.total) return false;
      } else if (tab === "posted") {
        if (b.counts.posted !== b.counts.total || b.counts.total === 0) return false;
      } else if (tab === "denials") {
        if (b.counts.denied === 0) return false;
      } else if (tab === "recoupment") {
        if (b.counts.recoupment === 0) return false;
      }
      if (!term) return true;
      const haystack = [
        b.payer.name,
        b.payer.identifier,
        b.eftOrCheckNumber,
        b.fileName,
        b.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [items, search, tab]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.title}>ERA queue</div>
        <span className={styles.crumb}>
          <Link href="/billing/payments">Payments</Link>
          <ChevronRight size={12} style={{ display: "inline-block", verticalAlign: "middle", margin: "0 2px" }} />
          ERA queue
        </span>
        <div className={styles.spacer} />
        <div className={styles.row}>
          <Search size={12} className={styles.muted} />
          <input
            className={styles.searchInput}
            placeholder="Search payer, EFT, file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className={styles.row} style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button className={styles.btn} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={12} /> Refresh
        </button>
        <Link href="/billing/era-import" className={styles.btn}>
          <Upload size={12} /> Upload / Import Workspace
        </Link>
        <label
          className={`${styles.btn} ${styles.btnPrimary}`}
          style={{ cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.6 : 1 }}
          title="Upload an X12 835 ERA file (.835, .edi, .txt)"
        >
          <Upload size={12} /> {importing ? "Importing…" : "Import 835"}
          <input
            type="file"
            accept=".835,.edi,.txt,text/plain,application/edi-x12"
            disabled={importing}
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setImporting(true);
              setError(null);
              setFlash(null);
              try {
                const form = new FormData();
                form.append("file", file);
                form.append("organizationId", organizationId);
                const res = await fetch("/api/payments/import-835", { method: "POST", body: form });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || json?.success === false) {
                  throw new Error(json?.error || `Import failed (${res.status})`);
                }
                const s = json?.summary ?? {};
                const total = s.claimsFound;
                const matched = s.matchedClaims;
                const unmatched = s.unmatchedClaims;
                const parts: string[] = [`Imported ${file.name}`];
                if (typeof total === "number") parts.push(`${total} claim${total === 1 ? "" : "s"}`);
                if (typeof matched === "number") parts.push(`${matched} matched`);
                if (typeof unmatched === "number" && unmatched > 0) parts.push(`${unmatched} unmatched`);
                setFlash(parts.join(" • "));
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "835 import failed");
              } finally {
                setImporting(false);
              }
            }}
          />
        </label>
      </header>

      <div className={styles.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            <span className={styles.tabBadge}>{counts[t]}</span>
          </button>
        ))}
      </div>

      {error ? <div className={styles.errorBanner}>{error}</div> : null}
      {flash ? <div className={styles.flashBanner}>{flash}</div> : null}

      <div className={styles.queueScroll}>
        {loading && items.length === 0 ? (
          <div className={styles.emptyState}>Loading ERA queue…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>No ERAs match the current filter.</div>
        ) : (
          <table className={styles.queueTable}>
            <thead>
              <tr>
                <th>Payer</th>
                <th>EFT / Check</th>
                <th>Payment date</th>
                <th>Received</th>
                <th className={styles.numCell}>Total $</th>
                <th className={styles.numCell}>Allocated</th>
                <th className={styles.numCell}>Unallocated</th>
                <th>Claims</th>
                <th>Status</th>
                <th>File</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const rowClass = b.archivedAt
                  ? styles.archived
                  : b.deferred
                  ? styles.deferred
                  : "";
                return (
                  <tr key={b.id} className={rowClass}>
                    <td>
                      <Link href={`/billing/payments/era/${b.id}`}>
                        <strong>{b.payer.name}</strong>
                      </Link>
                      {b.payer.identifier ? (
                        <div className={`${styles.mono} ${styles.muted}`} style={{ fontSize: 10 }}>
                          {b.payer.identifier}
                        </div>
                      ) : null}
                    </td>
                    <td className={styles.mono}>{b.eftOrCheckNumber ?? "—"}</td>
                    <td>{formatDate(b.paymentDate)}</td>
                    <td>{formatDate(b.receivedAt)}</td>
                    <td className={styles.numCell}>{currency(b.totalPaymentAmount)}</td>
                    <td className={styles.numCell}>{currency(b.totalAllocated)}</td>
                    <td
                      className={styles.numCell}
                      style={{
                        color:
                          b.unallocated > 0.01
                            ? "#92400E"
                            : b.unallocated < -0.01
                            ? "#991B1B"
                            : undefined,
                      }}
                    >
                      {currency(b.unallocated)}
                    </td>
                    <td>
                      <div className={styles.row}>
                        <span className={`${styles.statusPill} ${styles.pillMatched}`} title="Matched">
                          {b.counts.matched}
                        </span>
                        {b.counts.unmatched > 0 ? (
                          <span className={`${styles.statusPill} ${styles.pillUnmatched}`} title="Unmatched">
                            {b.counts.unmatched}
                          </span>
                        ) : null}
                        {b.counts.blocked > 0 ? (
                          <span className={`${styles.statusPill} ${styles.pillBlocked}`} title="Blocked">
                            {b.counts.blocked}
                          </span>
                        ) : null}
                        {b.counts.posted > 0 ? (
                          <span className={`${styles.statusPill} ${styles.pillPosted}`} title="Posted">
                            {b.counts.posted}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {b.deferred ? (
                        <span className={`${styles.statusPill} ${styles.pillDeferred}`}>Deferred</span>
                      ) : b.archivedAt ? (
                        <span className={styles.statusPill}>Archived</span>
                      ) : b.counts.posted === b.counts.total && b.counts.total > 0 ? (
                        <span className={`${styles.statusPill} ${styles.pillPosted}`}>Posted</span>
                      ) : (
                        <span className={`${styles.statusPill} ${styles.pillReady}`}>
                          {b.importStatus}
                        </span>
                      )}
                    </td>
                    <td title={b.fileName ?? undefined} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.fileName ? (
                        <span className={styles.row}>
                          <FileText size={11} className={styles.muted} /> {b.fileName}
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.row}>
                        <Link href={`/billing/payments/era/${b.id}`} className={`${styles.btn} ${styles.btnPrimary}`}>
                          Open
                        </Link>
                        <button
                          className={styles.btn}
                          title={
                            b.counts.unmatched > 0
                              ? "Create a patient from this unmatched ERA batch"
                              : "No unmatched claims in this batch"
                          }
                          disabled={b.counts.unmatched === 0}
                          onClick={() => setAddPatientBatch(b)}
                        >
                          <Plus size={12} /> Add Patient
                        </button>
                        <button
                          className={styles.btnGhost}
                          title={b.deferred ? "Un-defer" : "Defer for later"}
                          onClick={async () => {
                            await fetch(`/api/billing/era-batches/${b.id}/defer`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ organizationId, undo: b.deferred }),
                            });
                            setFlash(b.deferred ? "Un-deferred" : "Deferred");
                            await load();
                          }}
                        >
                          <Clock size={12} />
                        </button>
                        <button
                          className={styles.btnGhost}
                          title="Mark duplicate"
                          onClick={async () => {
                            const of = window.prompt("Duplicate of batch ID (leave blank to just mark):", "");
                            await fetch(`/api/billing/era-batches/${b.id}/archive`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                organizationId,
                                reason: "duplicate",
                                duplicateOfBatchId: of ?? undefined,
                              }),
                            });
                            setFlash("Marked duplicate");
                            await load();
                          }}
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          className={styles.btnGhost}
                          title={b.archivedAt ? "Restore" : "Archive"}
                          onClick={async () => {
                            await fetch(`/api/billing/era-batches/${b.id}/archive`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                organizationId,
                                reason: "archive",
                                undo: Boolean(b.archivedAt),
                              }),
                            });
                            setFlash(b.archivedAt ? "Restored" : "Archived");
                            await load();
                          }}
                        >
                          <Archive size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {addPatientBatch ? (
        <QuickAddPatientModal
          organizationId={organizationId}
          payerName={addPatientBatch.payer.name}
          onClose={() => setAddPatientBatch(null)}
          onCreated={async (message) => {
            setAddPatientBatch(null);
            setFlash(message);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}
