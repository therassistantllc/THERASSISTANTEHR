"use client";

/**
 * PlaceClaimOnHoldModal — shared modal that lets a biller place either
 * a single claim or many selected claims on hold from any screen that
 * opens a claim row.
 *
 * Single mode: pass `claimId`.  Submits to
 *   POST /api/billing/claims/[claimId]/hold  with action="place".
 *
 * Bulk mode:   pass `claimIds` (1+ ids).  Submits to
 *   POST /api/billing/claims/bulk-hold
 * with the same category/reason/follow-up/priority applied to every
 * selected claim. The API processes each claim individually and the
 * modal surfaces a per-claim success/failure summary via `onPlacedBulk`
 * so the caller can show a toast like "12 placed on hold, 1 failed".
 *
 * Callers are responsible for refreshing their list after `onPlaced`/
 * `onPlacedBulk` fires.
 */
import { useEffect, useState } from "react";

export type HoldCategory =
  | "manual"
  | "documentation"
  | "eligibility"
  | "auth"
  | "compliance"
  | "payer_rule";

export type HoldPriority = "low" | "normal" | "high" | "urgent";

const CATEGORY_OPTIONS: Array<{ id: HoldCategory; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "documentation", label: "Documentation" },
  { id: "eligibility", label: "Eligibility" },
  { id: "auth", label: "Authorization" },
  { id: "compliance", label: "Compliance" },
  { id: "payer_rule", label: "Payer rule" },
];

const PRIORITY_OPTIONS: Array<{ id: HoldPriority; label: string }> = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
};
const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #D1D5DB",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 13,
};
const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  marginTop: 16,
};

export interface PlaceOnHoldResult {
  claimId: string;
  category: HoldCategory;
  reason: string;
  followUpDate: string | null;
  priority: HoldPriority;
}

export interface BulkPlaceOnHoldResult {
  category: HoldCategory;
  reason: string;
  followUpDate: string | null;
  priority: HoldPriority;
  totalRequested: number;
  succeeded: number;
  failed: number;
  results: Array<{
    claimId: string;
    success: boolean;
    claimNumber?: string | null;
    error?: string;
  }>;
}

export interface PlaceClaimOnHoldModalProps {
  /** Single-claim mode: provide this. Ignored when `claimIds` is set. */
  claimId?: string;
  /** Bulk mode: provide a non-empty array of claim ids. */
  claimIds?: string[];
  organizationId: string;
  /** Optional context line shown under the title (e.g. "Claim 12345 · Aetna"). */
  subtitle?: string | null;
  /** Default category preselected in the dropdown. */
  defaultCategory?: HoldCategory;
  /** Default priority preselected in the dropdown. */
  defaultPriority?: HoldPriority;
  onClose: () => void;
  /** Fired after the single-claim API call succeeds. */
  onPlaced?: (result: PlaceOnHoldResult) => void;
  /** Fired after the bulk API call returns; called even when some
   *  per-claim writes failed so the caller can show a mixed summary. */
  onPlacedBulk?: (result: BulkPlaceOnHoldResult) => void;
}

export default function PlaceClaimOnHoldModal({
  claimId,
  claimIds,
  organizationId,
  subtitle,
  defaultCategory = "manual",
  defaultPriority = "normal",
  onClose,
  onPlaced,
  onPlacedBulk,
}: PlaceClaimOnHoldModalProps) {
  const isBulk = Array.isArray(claimIds) && claimIds.length > 0;
  const bulkCount = isBulk ? (claimIds as string[]).length : 0;

  const [category, setCategory] = useState<HoldCategory>(defaultCategory);
  const [reason, setReason] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [priority, setPriority] = useState<HoldPriority>(defaultPriority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Please enter a hold reason.");
      return;
    }
    if (!isBulk && !claimId) {
      setError("Missing claim to place on hold.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isBulk) {
        const res = await fetch(`/api/billing/claims/bulk-hold`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            claimIds,
            holdCategory: category,
            holdReason: trimmed,
            followUpDate: followUpDate || null,
            priority,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.success === false) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        onPlacedBulk?.({
          category,
          reason: trimmed,
          followUpDate: followUpDate || null,
          priority,
          totalRequested: Number(json.totalRequested ?? bulkCount),
          succeeded: Number(json.succeeded ?? 0),
          failed: Number(json.failed ?? 0),
          results: Array.isArray(json.results) ? json.results : [],
        });
        onClose();
        return;
      }
      const res = await fetch(
        `/api/billing/claims/${encodeURIComponent(claimId as string)}/hold`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            action: "place",
            holdCategory: category,
            holdReason: trimmed,
            followUpDate: followUpDate || null,
            priority,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      onPlaced?.({
        claimId: claimId as string,
        category,
        reason: trimmed,
        followUpDate: followUpDate || null,
        priority,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place on hold");
    } finally {
      setSaving(false);
    }
  }

  const title = isBulk
    ? `Place ${bulkCount} claim${bulkCount === 1 ? "" : "s"} on hold`
    : "Place claim on hold";
  const submitLabel = saving
    ? "Placing…"
    : isBulk
      ? `Place ${bulkCount} on hold`
      : "Place on hold";
  const reasonHelp = isBulk
    ? `The same reason will be applied to all ${bulkCount} selected claims.`
    : null;

  return (
    <div
      onClick={() => {
        if (!saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: 520,
          maxWidth: "92vw",
          maxHeight: "88vh",
          overflow: "auto",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              cursor: saving ? "default" : "pointer",
              color: "#6B7280",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {subtitle ? (
          <p style={{ color: "#6B7280", fontSize: 13, margin: "0 0 14px" }}>
            {subtitle}
          </p>
        ) : (
          <div style={{ height: 6 }} />
        )}

        <label style={fieldLabel} htmlFor="poh-category">
          Category
        </label>
        <select
          id="poh-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as HoldCategory)}
          style={fieldInput}
          disabled={saving}
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <label style={{ ...fieldLabel, marginTop: 12 }} htmlFor="poh-reason">
          Reason
        </label>
        <textarea
          id="poh-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder={
            isBulk
              ? "Why are these claims being held?"
              : "Why is this claim being held?"
          }
          style={{ ...fieldInput, resize: "vertical" }}
          disabled={saving}
        />
        {reasonHelp ? (
          <div style={{ color: "#64748B", fontSize: 12, marginTop: 4 }}>
            {reasonHelp}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel} htmlFor="poh-followup">
              Follow-up date (optional)
            </label>
            <input
              id="poh-followup"
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              style={fieldInput}
              disabled={saving}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel} htmlFor="poh-priority">
              Priority
            </label>
            <select
              id="poh-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as HoldPriority)}
              style={fieldInput}
              disabled={saving}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{ color: "#B91C1C", marginTop: 10, fontSize: 13 }}
          >
            {error}
          </div>
        ) : null}

        <div style={buttonRow}>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={submit}
            disabled={saving}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
