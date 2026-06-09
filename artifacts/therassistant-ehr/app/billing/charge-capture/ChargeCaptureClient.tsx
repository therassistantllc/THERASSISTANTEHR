"use client";

/**
 * Charges / Charge Capture
 *
 * Operational charge queue. When a clinician signs a note, the charge is
 * created and routed here for review, correction, hold, or release.
 *
 * Charge Capture should NOT generate 837P files or manage 837P batches.
 * Claim generation and batching belong on the Ready to Generate page.
 *
 * Data sources:
 *   GET   /api/billing/charge-capture          — per-charge queue rows
 *   GET   /api/billing/charge-capture/:id      — full CMS-1500 charge detail
 *   PATCH /api/billing/charge-capture/:id      — edit/status change
 *   POST  /api/billing/charge-capture/release  — release clean charges to Ready to Generate
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import {
  defaultPlaceOfService,
  isAllowedPlaceOfService,
  placeOfServiceWarning,
} from "@/lib/billing/placeOfService";
import styles from "./ChargeCaptureClient.module.css";

// ── Modal focus trap helpers ──────────────────────────────────────────────

function trapFocus(container: HTMLElement, event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;

  const focusable = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
  );

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getOrgId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;

  return (
    new URLSearchParams(window.location.search).get("organizationId") ||
    process.env.NEXT_PUBLIC_ORGANIZATION_ID ||
    DEFAULT_ORG_ID
  );
}

function fmtDate(v: string | null) {
  if (!v) return "—";

  const d = new Date(v + (v.includes("T") ? "" : "T00:00:00"));

  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// ── Types ─────────────────────────────────────────────────────────────────

type ChargeStatus = "Missing DX" | "Unsigned" | "Ready" | "Hold";

interface ChargeRow {
  id: string;
  chargeStatus: string;
  tab: string;
  dateOfService: string | null;
  client: { id: string; name: string; dob: string | null };
  clinician: string;
  providerSelectedCode: string | null;
  systemSuggestedCode: string | null;
  encounter: {
    id: string | null;
    noteSigned: boolean;
    billingFieldsComplete: boolean;
    noteStatus: string;
  };
  codingAlerts: string[];
  blockers: string[];
  chargeAmount: number;
  claimId: string | null;
  payer: { id: string; name: string } | null;
  authorization: { status: string; number: string | null };
}

interface ChargeDetail {
  id: string;
  status: string;
  serviceDate: string | null;
  placeOfService: string | null;
  totalCharge: number;
  claimId: string | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    dateOfBirth: string | null;
    accountNumber: string | null;
  } | null;
  provider: {
    id: string;
    displayName: string;
    credential: string | null;
    npi: string | null;
  } | null;
  payer: { id: string; name: string; payerType: string | null } | null;
  policy: {
    planName: string | null;
    policyNumber: string | null;
    subscriberId: string | null;
  } | null;
  diagnoses: string[];
  serviceLines: Array<{
    lineNumber: number;
    procedureCode: string;
    serviceDateFrom: string | null;
    serviceDateTo: string | null;
    modifiers: string[];
    diagnosisPointers: string[];
    units: number;
    chargeAmount: number;
    placeOfService: string | null;
    renderingProviderNpi: string | null;
    authorizationNumber: string | null;
  }>;
  clientAddress: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  subscriberRelationship: string | null;
  billingProvider: {
    displayName: string;
    npi: string | null;
    taxonomyCode: string | null;
  } | null;
}

interface EditSL {
  procedureCode: string;
  serviceDateFrom: string;
  serviceDateTo: string;
  modifiers: string;
  diagnosisPointers: string;
  units: string;
  chargeAmount: string;
  placeOfService: string;
  renderingProviderNpi: string;
  authorizationNumber: string;
}

// ── Status derivation ─────────────────────────────────────────────────────

function deriveStatus(r: ChargeRow): ChargeStatus {
  if (r.chargeStatus === "ready_for_claim") return "Ready";
  if (r.tab === "held_charges" || r.chargeStatus === "blocked") return "Hold";
  if (!r.encounter.noteSigned) return "Unsigned";

  if (
    r.codingAlerts.length > 0 ||
    r.blockers.some((b) => /diag|dx|cpt|code/i.test(b)) ||
    !r.encounter.billingFieldsComplete
  ) {
    return "Missing DX";
  }

  return "Ready";
}

function statusBadgeClass(status: ChargeStatus): string {
  switch (status) {
    case "Missing DX":
      return "statusBadgeDx";
    case "Unsigned":
      return "statusBadgeUnsigned";
    case "Ready":
      return "statusBadgeReady";
    case "Hold":
      return "statusBadgeHold";
  }
}

// ── Main component ────────────────────────────────────────────────────────

export default function ChargeCaptureClient() {
  const orgId = useMemo(() => getOrgId(), []);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Charge queue
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChargeStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // CMS-1500 Edit modal
  const [editRow, setEditRowRaw] = useState<ChargeRow | null>(null);
  const [editDetail, setEditDetail] = useState<ChargeDetail | null>(null);
  const [editDetailLoading, setEditDetailLoading] = useState(false);
  const [editDiagnoses, setEditDiagnoses] = useState<string[]>([]);
  const [editPlaceOfService, setEditPlaceOfService] = useState("");
  const [editPriorAuth, setEditPriorAuth] = useState("");
  const [editServiceLines, setEditServiceLines] = useState<EditSL[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const setEditRow = useCallback((row: ChargeRow | null) => {
    if (row) {
      lastFocusedRef.current = document.activeElement as HTMLElement;
    }

    setEditRowRaw(row);
  }, []);

  useEffect(() => {
    if (editRow && modalRef.current) {
      const timer = setTimeout(() => modalRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }

    if (!editRow && lastFocusedRef.current) {
      lastFocusedRef.current.focus();
      lastFocusedRef.current = null;
    }
  }, [editRow]);

  function showToast(msg: string) {
    setToast(msg);

    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }

    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadCharges = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);

    try {
      const params = new URLSearchParams({ organizationId: orgId });

      if (typeof window !== "undefined") {
        const current = new URLSearchParams(window.location.search);

        ["chargeCaptureId", "encounterId", "claimId"].forEach((key) => {
          const value = current.get(key);
          if (value) params.set(key, value);
        });
      }

      const res = await fetch(`/api/billing/charge-capture?${params.toString()}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load charges");
      }

      setCharges(json.items ?? []);
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : "Failed to load charges");
    } finally {
      setQueueLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  // ── Charge row actions ───────────────────────────────────────────────────

  async function patchChargeStatus(
    chargeId: string,
    action: "approve" | "hold" | "route_back",
  ) {
    const res = await fetch(`/api/billing/charge-capture/${encodeURIComponent(chargeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, action }),
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.error ?? "Failed to update charge");
    }
  }

  async function releaseChargesToClaims(chargeCaptureIds: string[]) {
    const res = await fetch("/api/billing/charge-capture/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, chargeCaptureIds }),
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.error ?? "Failed to release charges");
    }

    return json as {
      succeeded?: number;
      failed?: number;
      results?: Array<{ errors?: Array<{ message?: string }> }>;
    };
  }

  async function chargeAction(chargeId: string, action: "hold" | "release" | "approve") {
    setActionBusy(chargeId + action);

    try {
      if (action === "release") {
        const json = await releaseChargesToClaims([chargeId]);

        if ((json.succeeded ?? 0) !== 1) {
          const firstError = json.results?.[0]?.errors?.[0]?.message;
          throw new Error(firstError ?? "Charge could not be released");
        }
      } else {
        await patchChargeStatus(chargeId, action === "approve" ? "approve" : "hold");
      }

      showToast(
        action === "hold"
          ? "Charge placed on hold."
          : action === "release"
            ? "Charge released to Ready to Generate."
            : "Charge approved.",
      );

      await loadCharges();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionBusy(null);
    }
  }

  // ── Open edit modal ──────────────────────────────────────────────────────

  async function openEditModal(r: ChargeRow) {
    setEditRow(r);
    setEditDetail(null);
    setEditDetailLoading(true);
    setEditError(null);

    try {
      const res = await fetch(
        `/api/billing/charge-capture/${encodeURIComponent(r.id)}?organizationId=${encodeURIComponent(orgId)}`,
        { cache: "no-store" },
      );

      const json = await res.json();

      if (!res.ok || !json.detail) {
        throw new Error(json.error ?? "Failed to load charge detail");
      }

      const d: ChargeDetail = json.detail;

      setEditDetail(d);

      const MAX_DX = 12;
      const paddedDiagnoses = [
        ...d.diagnoses,
        ...Array(Math.max(0, MAX_DX - d.diagnoses.length)).fill(""),
      ].slice(0, MAX_DX);

      setEditDiagnoses(paddedDiagnoses);
      setEditPlaceOfService(d.placeOfService ?? defaultPlaceOfService(false));
      setEditPriorAuth(d.serviceLines[0]?.authorizationNumber ?? "");

      setEditServiceLines(
        d.serviceLines.length > 0
          ? d.serviceLines.map((sl) => ({
              procedureCode: sl.procedureCode,
              serviceDateFrom: sl.serviceDateFrom ?? d.serviceDate ?? "",
              serviceDateTo: sl.serviceDateTo ?? d.serviceDate ?? "",
              modifiers: sl.modifiers.join(", "),
              diagnosisPointers: sl.diagnosisPointers.join(", "),
              units: String(sl.units),
              chargeAmount: String(sl.chargeAmount),
              placeOfService:
                sl.placeOfService ?? d.placeOfService ?? defaultPlaceOfService(false),
              renderingProviderNpi: sl.renderingProviderNpi ?? d.provider?.npi ?? "",
              authorizationNumber: sl.authorizationNumber ?? "",
            }))
          : [
              {
                procedureCode: r.providerSelectedCode ?? r.systemSuggestedCode ?? "",
                serviceDateFrom: d.serviceDate ?? "",
                serviceDateTo: d.serviceDate ?? "",
                modifiers: "",
                diagnosisPointers: "A",
                units: "1",
                chargeAmount: String(d.totalCharge),
                placeOfService: d.placeOfService ?? defaultPlaceOfService(false),
                renderingProviderNpi: d.provider?.npi ?? "",
                authorizationNumber: "",
              },
            ],
      );
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to load charge");
    } finally {
      setEditDetailLoading(false);
    }
  }

  // ── Edit save ────────────────────────────────────────────────────────────

  async function saveEdit() {
    if (!editRow) return;

    setEditSaving(true);
    setEditError(null);

    try {
      const defaultPos = editPlaceOfService.trim();

      if (defaultPos && !isAllowedPlaceOfService(defaultPos)) {
        throw new Error(
          placeOfServiceWarning(defaultPos) ??
            `POS ${defaultPos} is not allowed. Use 11 (office) or 02 (telehealth).`,
        );
      }

      const diagnoses = editDiagnoses.map((s) => s.trim().toUpperCase()).filter(Boolean);

      const serviceLines = editServiceLines.map((sl) => ({
        procedureCode: sl.procedureCode.trim(),
        serviceDateFrom: sl.serviceDateFrom.trim() || undefined,
        serviceDateTo: sl.serviceDateTo.trim() || undefined,
        modifiers: sl.modifiers.split(",").map((s) => s.trim()).filter(Boolean),
        diagnosisPointers: sl.diagnosisPointers.split(",").map((s) => s.trim()).filter(Boolean),
        units: Number(sl.units) || 1,
        chargeAmount: parseFloat(sl.chargeAmount) || 0,
        placeOfService: sl.placeOfService.trim() || null,
        renderingProviderNpi: sl.renderingProviderNpi.trim() || null,
        authorizationNumber: sl.authorizationNumber.trim() || null,
      }));

      for (const line of serviceLines) {
        const pos = String(line.placeOfService ?? defaultPos ?? "").trim();

        if (pos && !isAllowedPlaceOfService(pos)) {
          throw new Error(
            placeOfServiceWarning(pos) ??
              `POS ${pos} is not allowed. Use 11 (office) or 02 (telehealth).`,
          );
        }
      }

      const res = await fetch(`/api/billing/charge-capture/${encodeURIComponent(editRow.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          diagnoses,
          serviceLines,
          placeOfService: defaultPos || null,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Save failed");
      }

      showToast("Charge updated.");
      setEditRow(null);
      await loadCharges();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setEditSaving(false);
    }
  }

  // ── Filtered charge queue ────────────────────────────────────────────────

  const visibleCharges = useMemo(() => {
    return charges.filter((r) => {
      const status = deriveStatus(r);

      if (statusFilter !== "all" && status !== statusFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();

        if (
          !r.client.name.toLowerCase().includes(q) &&
          !r.clinician.toLowerCase().includes(q) &&
          !(r.providerSelectedCode ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [charges, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<ChargeStatus, number> = {
      "Missing DX": 0,
      Unsigned: 0,
      Ready: 0,
      Hold: 0,
    };

    for (const r of charges) {
      counts[deriveStatus(r)]++;
    }

    return counts;
  }, [charges]);

  const releasableVisibleIds = useMemo(() => {
    return visibleCharges
      .filter((r) => deriveStatus(r) === "Ready" && r.tab !== "released_to_claims")
      .map((r) => r.id);
  }, [visibleCharges]);

  const allReleasableVisibleSelected =
    releasableVisibleIds.length > 0 &&
    releasableVisibleIds.every((id) => selectedReleaseIds.includes(id));

  const selectedReleasableCount = selectedReleaseIds.filter((id) => {
    const row = charges.find((r) => r.id === id);
    return row ? deriveStatus(row) === "Ready" && row.tab !== "released_to_claims" : false;
  }).length;

  useEffect(() => {
    setSelectedReleaseIds((prev) =>
      prev.filter((id) => {
        const row = charges.find((r) => r.id === id);
        return row ? deriveStatus(row) === "Ready" && row.tab !== "released_to_claims" : false;
      }),
    );
  }, [charges]);

  function toggleRowReleaseSelection(chargeId: string, checked: boolean) {
    setSelectedReleaseIds((prev) => {
      if (checked) return prev.includes(chargeId) ? prev : [...prev, chargeId];
      return prev.filter((id) => id !== chargeId);
    });
  }

  function toggleSelectAllReleasableVisible() {
    setSelectedReleaseIds((prev) => {
      if (allReleasableVisibleSelected) {
        const clearSet = new Set(releasableVisibleIds);
        return prev.filter((id) => !clearSet.has(id));
      }

      const next = new Set(prev);

      for (const id of releasableVisibleIds) {
        next.add(id);
      }

      return Array.from(next);
    });
  }

  async function releaseSelectedForBatching() {
    const releasableIds = selectedReleaseIds.filter((id) => {
      const row = charges.find((r) => r.id === id);
      return row ? deriveStatus(row) === "Ready" && row.tab !== "released_to_claims" : false;
    });

    if (releasableIds.length === 0) {
      showToast("No ready charges selected to release.");
      return;
    }

    setActionBusy("bulk-release");

    try {
      const json = await releaseChargesToClaims(releasableIds);
      const succeeded = Number(json.succeeded ?? 0);
      const failed = Number(json.failed ?? Math.max(0, releasableIds.length - succeeded));

      if (succeeded > 0 && failed === 0) {
        showToast(
          `Released ${succeeded} charge${succeeded === 1 ? "" : "s"} to Ready to Generate.`,
        );
      } else if (succeeded > 0 && failed > 0) {
        showToast(`Released ${succeeded} charge${succeeded === 1 ? "" : "s"}; ${failed} failed.`);
      } else {
        showToast("Failed to release selected charges.");
      }

      setSelectedReleaseIds([]);
      await loadCharges();
    } catch {
      showToast("Failed to release selected charges.");
    } finally {
      setActionBusy(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Charge Capture</h1>
          <p>
            Review signed-note charges, edit CMS-1500 claim details, then release clean
            charges to Ready to Generate.
          </p>
        </div>

        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => {
            void loadCharges();
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {toast ? <div className={styles.toast}>{toast}</div> : null}

      <section className={styles.queueSection}>
        <div className={styles.queueHeader}>
          <h2 className={styles.queueTitle}>
            Charge Queue
            {!queueLoading ? (
              <span className={styles.queueCount}>
                {visibleCharges.length} of {charges.length}
              </span>
            ) : null}
          </h2>

          <div className={styles.queueToolbar}>
            {(["all", "Missing DX", "Unsigned", "Ready", "Hold"] as const).map((s) => {
              const isActive = statusFilter === s;
              const count = s === "all" ? charges.length : statusCounts[s] ?? 0;

              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={isActive ? styles.chipActive : styles.chip}
                >
                  {s === "all" ? "All" : s}{" "}
                  <span className={styles.chipCount}>{count}</span>
                </button>
              );
            })}

            <input
              type="search"
              placeholder="Patient, clinician, CPT…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.search}
            />

            <button
              type="button"
              onClick={toggleSelectAllReleasableVisible}
              disabled={releasableVisibleIds.length === 0 || actionBusy === "bulk-release"}
              className={styles.selectBtn}
            >
              {allReleasableVisibleSelected ? "Clear Selected" : "Select All Ready"}
            </button>

            <button
              type="button"
              onClick={() => void releaseSelectedForBatching()}
              disabled={selectedReleasableCount === 0 || actionBusy === "bulk-release"}
              className={styles.releaseBtn}
            >
              {actionBusy === "bulk-release"
                ? "Releasing…"
                : `Release Selected (${selectedReleasableCount})`}
            </button>
          </div>
        </div>

        {queueError ? (
          <div className={styles.queueError}>{queueError}</div>
        ) : queueLoading ? (
          <div className={styles.queueLoading}>Loading charges…</div>
        ) : visibleCharges.length === 0 ? (
          <div className={styles.queueEmpty}>
            {charges.length === 0
              ? "No charges pending. Charges appear here when clinicians sign notes."
              : "No charges match this filter."}
          </div>
        ) : (
          <div className={styles.queueTableWrap}>
            <table className={styles.queueTable}>
              <thead>
                <tr>
                  {["Select", "Patient", "DOS", "CPT", "Provider", "Status", "Actions"].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody>
                {visibleCharges.map((r) => {
                  const status = deriveStatus(r);
                  const cpt = r.providerSelectedCode ?? r.systemSuggestedCode ?? "—";
                  const encounterId = r.encounter.id;
                  const isReleased = r.tab === "released_to_claims";
                  const isReleasable = status === "Ready" && !isReleased;

                  return (
                    <tr key={r.id}>
                      <td>
                        {isReleasable ? (
                          <input
                            type="checkbox"
                            checked={selectedReleaseIds.includes(r.id)}
                            onChange={(e) => toggleRowReleaseSelection(r.id, e.target.checked)}
                            aria-label={`Select ${r.client.name} for release`}
                          />
                        ) : (
                          <span className={styles.mutedDash}>—</span>
                        )}
                      </td>

                      <td>
                        <span className={styles.patientName}>{r.client.name}</span>
                        {r.client.dob ? (
                          <span className={styles.patientDob}>DOB {fmtDate(r.client.dob)}</span>
                        ) : null}
                      </td>

                      <td className={styles.dosCell}>{fmtDate(r.dateOfService)}</td>
                      <td className={styles.cptCode}>{cpt}</td>
                      <td className={styles.providerCell}>{r.clinician}</td>

                      <td>
                        <span className={styles[statusBadgeClass(status)]}>{status}</span>
                      </td>

                      <td>
                        <div className={styles.rowActions}>
                          {!isReleased ? (
                            <button
                              type="button"
                              className={styles.rowBtn}
                              onClick={() => void openEditModal(r)}
                            >
                              Edit
                            </button>
                          ) : null}

                          {status === "Missing DX" || status === "Unsigned" ? (
                            <button
                              type="button"
                              className={styles.rowBtnWarn}
                              onClick={() => void openEditModal(r)}
                            >
                              Attach DX
                            </button>
                          ) : null}

                          {r.authorization?.status === "required" ||
                          r.tab === "eligibility_auth_issue" ? (
                            <a
                              href={
                                encounterId ? `/encounters/${encounterId}` : `/clients/${r.client.id}`
                              }
                              className={styles.rowBtnAuth}
                            >
                              Auth
                            </a>
                          ) : null}

                          {status === "Ready" && !isReleased ? (
                            <button
                              type="button"
                              disabled={actionBusy === r.id + "release"}
                              className={styles.rowBtnPrimary}
                              onClick={() => void chargeAction(r.id, "release")}
                            >
                              {actionBusy === r.id + "release" ? "…" : "Release"}
                            </button>
                          ) : null}

                          {status !== "Hold" && !isReleased ? (
                            <button
                              type="button"
                              disabled={actionBusy === r.id + "hold"}
                              className={styles.rowBtnHold}
                              onClick={() => void chargeAction(r.id, "hold")}
                            >
                              {actionBusy === r.id + "hold" ? "…" : "Hold"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editRow ? (
        <div
          ref={modalRef}
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          onClick={() => setEditRow(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditRow(null);
            } else if (modalRef.current) {
              trapFocus(modalRef.current, e);
            }
          }}
          tabIndex={-1}
        >
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div id="modal-title" className={styles.modalHeaderTitle}>
                  CMS-1500 Health Insurance Claim Form
                </div>
                <div className={styles.modalHeaderSubtitle}>
                  {editRow.client.name} · {editRow.payer?.name ?? "Unknown Payer"}
                </div>
              </div>

              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setEditRow(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {editDetailLoading ? (
              <div className={styles.queueEmpty}>Loading charge details…</div>
            ) : editError && !editDetail ? (
              <div className={styles.queueError}>{editError}</div>
            ) : editDetail ? (
              <div className={styles.modalBody}>
                {editError ? <div className={styles.modalError}>{editError}</div> : null}

                <div className={styles.modalGrid2}>
                  <FieldBox label="2. Patient's Name">
                    <ReadonlyVal>{editDetail.client?.displayName ?? "—"}</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="3. Patient's Date of Birth">
                    <ReadonlyVal>
                      {editDetail.client?.dateOfBirth
                        ? fmtDate(editDetail.client.dateOfBirth)
                        : "—"}
                    </ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="1a. Insured's ID # / Member ID">
                    <ReadonlyVal>
                      {editDetail.policy?.subscriberId ?? editDetail.policy?.policyNumber ?? "—"}
                    </ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="4. Insured's Name">
                    <ReadonlyVal>{editDetail.client?.displayName ?? "—"}</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="11. Insured's Policy / Group #">
                    <ReadonlyVal>{editDetail.policy?.policyNumber ?? "—"}</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="11c. Insurance Plan or Program Name">
                    <ReadonlyVal>
                      {editDetail.payer?.name ?? "—"}
                      {editDetail.policy?.planName ? ` — ${editDetail.policy.planName}` : ""}
                    </ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="26. Patient Account No.">
                    <ReadonlyVal>{editDetail.client?.accountNumber ?? "—"}</ReadonlyVal>
                  </FieldBox>
                </div>

                <div className={styles.modalGrid2}>
                  <FieldBox label="5. Patient's Address">
                    <ReadonlyVal>
                      {editDetail.clientAddress?.line1
                        ? [
                            editDetail.clientAddress.line1,
                            editDetail.clientAddress.line2,
                            editDetail.clientAddress.city &&
                              `${editDetail.clientAddress.city}, ${editDetail.clientAddress.state} ${editDetail.clientAddress.postalCode}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "—"}
                    </ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="6. Patient Relationship to Insured">
                    <ReadonlyVal>{editDetail.subscriberRelationship ?? "self"}</ReadonlyVal>
                  </FieldBox>
                </div>

                <SectionHeader>Physician / Supplier Information</SectionHeader>

                <FieldBox label="21. Diagnosis Codes (ICD-10-CM)" fullWidth>
                  <div className={styles.diagWrap}>
                    {(editDiagnoses.length > 0 ? editDiagnoses : Array(4).fill("")).map(
                      (code, i) => (
                        <div key={i} className={styles.diagRow}>
                          <span className={styles.diagLabel}>
                            {String.fromCharCode(65 + i)}.
                          </span>
                          <input
                            type="text"
                            value={code}
                            onChange={(e) => {
                              const next = [...editDiagnoses];
                              next[i] = e.target.value.toUpperCase();
                              setEditDiagnoses(next);
                            }}
                            placeholder="ICD-10"
                            className={styles.modalInputUpper}
                          />
                        </div>
                      ),
                    )}
                  </div>
                </FieldBox>

                <div className={styles.modalGrid2}>
                  <FieldBox label="23. Prior Authorization #">
                    <input
                      type="text"
                      value={editPriorAuth}
                      onChange={(e) => setEditPriorAuth(e.target.value)}
                      placeholder="Authorization number…"
                      className={styles.modalInputFull}
                    />
                  </FieldBox>

                  <FieldBox label="24B. Default Place of Service">
                    <div className={styles.diagRow}>
                      <select
                        value={editPlaceOfService}
                        onChange={(e) => setEditPlaceOfService(e.target.value)}
                        className={styles.modalSelect}
                      >
                        {!isAllowedPlaceOfService(editPlaceOfService) && editPlaceOfService ? (
                          <option value={editPlaceOfService}>
                            {editPlaceOfService} (invalid)
                          </option>
                        ) : null}
                        <option value="11">11 · Office</option>
                        <option value="02">02 · Telehealth</option>
                      </select>
                      <span className={styles.modalHint}>Select only 11 or 02.</span>
                    </div>
                  </FieldBox>

                  <FieldBox label="33a. Billing Provider NPI">
                    <ReadonlyVal>
                      {editDetail.billingProvider?.npi ?? editDetail.provider?.npi ?? "—"}
                    </ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="33b. Billing Provider Taxonomy">
                    <ReadonlyVal>{editDetail.billingProvider?.taxonomyCode ?? "—"}</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="33. Billing Provider Name">
                    <ReadonlyVal>{editDetail.billingProvider?.displayName ?? "—"}</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="25. Federal Tax ID">
                    <ReadonlyVal>on file</ReadonlyVal>
                  </FieldBox>

                  <FieldBox label="31. Signature of Physician">
                    <ReadonlyVal>
                      {editDetail.provider?.displayName ?? "—"}
                      {editDetail.provider?.credential ? `, ${editDetail.provider.credential}` : ""}
                    </ReadonlyVal>
                  </FieldBox>
                </div>

                <SectionHeader className={styles.sectionHeaderWithMargin}>
                  Box 24 — Service Line Items
                </SectionHeader>

                {placeOfServiceWarning(editPlaceOfService) ||
                editServiceLines.some((sl) => placeOfServiceWarning(sl.placeOfService)) ? (
                  <div className={styles.posWarn}>
                    {placeOfServiceWarning(editPlaceOfService) ??
                      placeOfServiceWarning(
                        editServiceLines.find((sl) => placeOfServiceWarning(sl.placeOfService))
                          ?.placeOfService,
                      ) ??
                      "POS is not allowed. Use 11 (office) or 02 (telehealth)."}
                  </div>
                ) : null}

                <div className={styles.slWrap}>
                  <table className={styles.slTable}>
                    <thead>
                      <tr>
                        {[
                          "#",
                          "24A DOS From",
                          "24A DOS To",
                          "24B POS",
                          "24D CPT / Procedure",
                          "24D Modifiers",
                          "24E Dx Ptr",
                          "24G Units",
                          "24F Charge ($)",
                          "24J Rendering NPI",
                          "Auth #",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                        <th></th>
                      </tr>
                    </thead>

                    <tbody>
                      {editServiceLines.map((sl, idx) => (
                        <tr key={idx} className={styles.slRow}>
                          <td className={styles.slRowNum}>{idx + 1}</td>

                          <td className={styles.slCell}>
                            <input
                              type="date"
                              value={sl.serviceDateFrom}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], serviceDateFrom: e.target.value };
                                setEditServiceLines(n);
                              }}
                              className={`${styles.slInput} ${styles.slWidth120}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="date"
                              value={sl.serviceDateTo}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], serviceDateTo: e.target.value };
                                setEditServiceLines(n);
                              }}
                              className={`${styles.slInput} ${styles.slWidth120}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <select
                              value={sl.placeOfService}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], placeOfService: e.target.value };
                                setEditServiceLines(n);
                              }}
                              className={styles.slSelect}
                            >
                              {!isAllowedPlaceOfService(sl.placeOfService) && sl.placeOfService ? (
                                <option value={sl.placeOfService}>
                                  {sl.placeOfService} (invalid)
                                </option>
                              ) : null}
                              <option value="11">11 · Office</option>
                              <option value="02">02 · Telehealth</option>
                            </select>
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="text"
                              value={sl.procedureCode}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = {
                                  ...n[idx],
                                  procedureCode: e.target.value.toUpperCase(),
                                };
                                setEditServiceLines(n);
                              }}
                              placeholder="90837"
                              className={`${styles.slInput} ${styles.slWidth72}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="text"
                              value={sl.modifiers}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], modifiers: e.target.value };
                                setEditServiceLines(n);
                              }}
                              placeholder="GT, 95"
                              className={`${styles.slInput} ${styles.slWidth80}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="text"
                              value={sl.diagnosisPointers}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], diagnosisPointers: e.target.value };
                                setEditServiceLines(n);
                              }}
                              placeholder="A, B"
                              className={`${styles.slInput} ${styles.slWidth60}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="number"
                              min="1"
                              value={sl.units}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], units: e.target.value };
                                setEditServiceLines(n);
                              }}
                              className={`${styles.slInput} ${styles.slWidth50}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={sl.chargeAmount}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], chargeAmount: e.target.value };
                                setEditServiceLines(n);
                              }}
                              className={`${styles.slInput} ${styles.slWidth88}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="text"
                              value={sl.renderingProviderNpi}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], renderingProviderNpi: e.target.value };
                                setEditServiceLines(n);
                              }}
                              placeholder="NPI"
                              className={`${styles.slInput} ${styles.slWidth100}`}
                            />
                          </td>

                          <td className={styles.slCell}>
                            <input
                              type="text"
                              value={sl.authorizationNumber}
                              onChange={(e) => {
                                const n = [...editServiceLines];
                                n[idx] = { ...n[idx], authorizationNumber: e.target.value };
                                setEditServiceLines(n);
                              }}
                              placeholder="Auth #"
                              className={`${styles.slInput} ${styles.slWidth90}`}
                            />
                          </td>

                          <td className={`${styles.slCell} ${styles.slCellCenter}`}>
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() =>
                                setEditServiceLines((s) => s.filter((_, i) => i !== idx))
                              }
                              title="Remove line"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setEditServiceLines((s) => [
                      ...s,
                      {
                        procedureCode: "",
                        serviceDateFrom: editDetail.serviceDate ?? "",
                        serviceDateTo: editDetail.serviceDate ?? "",
                        modifiers: "",
                        diagnosisPointers: "A",
                        units: "1",
                        chargeAmount: "0",
                        placeOfService: editPlaceOfService,
                        renderingProviderNpi: editDetail.provider?.npi ?? "",
                        authorizationNumber: editPriorAuth,
                      },
                    ])
                  }
                  className={styles.addBtn}
                >
                  + Add Service Line
                </button>

                <div className={styles.totals}>
                  <span>
                    <strong>28. Total Charge:</strong>{" "}
                    {fmtMoney(
                      editServiceLines.reduce(
                        (sum, sl) => sum + (parseFloat(sl.chargeAmount) || 0),
                        0,
                      ),
                    )}
                  </span>
                  <span>
                    <strong>29. Amount Paid:</strong> {fmtMoney(0)}
                  </span>
                  <span>
                    <strong>30. Balance Due:</strong>{" "}
                    {fmtMoney(
                      editServiceLines.reduce(
                        (sum, sl) => sum + (parseFloat(sl.chargeAmount) || 0),
                        0,
                      ),
                    )}
                  </span>
                  <span>
                    <strong>Lines:</strong> {editServiceLines.length}
                  </span>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.modalBtn}
                    onClick={() => setEditRow(null)}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={editSaving}
                    className={styles.modalBtnPrimary}
                    onClick={() => void saveEdit()}
                  >
                    {editSaving ? "Saving…" : "Save Charge"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────

function SectionHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className ?? styles.sectionHeader}>{children}</div>;
}

function FieldBox({
  label,
  children,
  fullWidth,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? `${styles.fieldBox} ${styles.fieldBoxFullWidth}` : styles.fieldBox}>
      <div className={styles.fieldBoxLabel}>{label}</div>
      <div className={styles.fieldBoxValue}>{children}</div>
    </div>
  );
}

function ReadonlyVal({ children }: { children: React.ReactNode }) {
  return <span className={children ? styles.readonlyVal : styles.readonlyValEmpty}>{children || "—"}</span>;
}