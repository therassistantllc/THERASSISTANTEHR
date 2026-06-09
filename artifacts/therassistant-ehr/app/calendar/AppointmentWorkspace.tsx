"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "./AppointmentWorkspace.module.css";
import { DEFAULT_ORG_ID } from "@/lib/config";
import EncounterNoteClient from "../encounters/[encounterId]/EncounterNoteClient";

const ORG_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ORGANIZATION_ID) ||
  DEFAULT_ORG_ID;

// --- Types ----------------------------------------------------------------

type AppointmentDetail = {
  appointment: {
    id: string;
    clientId: string | null;
    clientName: string;
    providerId: string | null;
    providerName: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    status: string;
    appointmentType: string | null;
    serviceLocation: string | null;
    cptCode: string | null;
    memo: string;
  };
  insurance: {
    primaryPolicy: {
      id: string;
      planName: string | null;
      policyNumber: string | null;
      priority: number | null;
      payerId: string | null;
      payerName: string | null;
      payerCode: string | null;
    } | null;
  };
  eligibility: {
    id: string;
    eligibility_status: string;
    checked_at: string;
    copay_amount: number;
    deductible_remaining: number;
    displayStatus: string;
    asOf: string | null;
  } | null;
  balance: { openBalance: number };
  encounter: { id: string; encounter_status: string } | null;
  clientDetails?: {
    dateOfBirth: string | null;
  } | null;
  authorization?: {
    status: string | null;
    authorizationNumber: string | null;
  } | null;
};

// --- Helpers --------------------------------------------------------------

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function apptTypeLabel(appt: { appointmentType: string | null; cptCode: string | null }): string | null {
  if (appt.cptCode) return appt.cptCode;
  const type = appt.appointmentType ?? "";
  if (/^9\d{4}$/.test(type)) return type;
  return type || null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function chipClassForStatus(status: string): string {
  switch (status) {
    case "completed":
      return styles.statusCompleted;
    case "cancelled":
      return styles.statusCancelled;
    case "no_show":
      return styles.statusNoShow;
    case "in_progress":
    case "checked_in":
      return styles.statusInProgress;
    default:
      return "";
  }
}

// --- Component ------------------------------------------------------------

export default function AppointmentWorkspace({
  appointmentId,
  onClose,
  onRefresh,
  onCollect,
  onCancel,
  onOpenNext,
}: {
  appointmentId: string;
  onClose: () => void;
  onRefresh?: () => void;
  onCollect?: (data: {
    appointmentId: string;
    clientId: string | null;
    providerId: string | null;
    openBalance: number;
    clientName: string;
  }) => void;
  onCancel?: (data: {
    appointmentId: string;
    alreadyCancelled: boolean;
  }) => void;
  onOpenNext?: () => void;
}) {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [mode, setMode] = useState<"preview" | "encounter">("preview");
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const checkingInRef = useRef(false);

  type WorkspaceCtx = {
    currentSessionNote: {
      encounterId: string;
      date: string | null;
      noteId: string | null;
      noteStatus: string | null;
      subjective: string | null;
      objective: string | null;
      assessment: string | null;
      plan: string | null;
      status: string | null;
    } | null;
    goals: Array<{ id: string; description: string; status: string }>;
    telehealth: { isVirtual: boolean; existingUrl: string | null };
  };
  const [workspaceCtx, setWorkspaceCtx] = useState<WorkspaceCtx | null>(null);
  const [chargeResult, setChargeResult] = useState<{ chargeStatus: string | null; claimId: string | null } | null>(null);
  const [telehealthLoading, setTelehealthLoading] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);

  // Load appointment details
  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setBanner(null);
    try {
      const params = new URLSearchParams({ organizationId: ORG_ID });
      const res = await fetch(`/api/scheduling/appointments/${id}/detail?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load appointment");
      }
      setDetail(json as AppointmentDetail);
      if (json.encounter?.id) {
        setEncounterId(json.encounter.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appointmentId) loadDetail(appointmentId);
  }, [appointmentId, loadDetail]);

  // Load workspace context (prior session, goals, telehealth)
  const loadWorkspaceCtx = useCallback(async (id: string) => {
    try {
      const params = new URLSearchParams({ organizationId: ORG_ID });
      const res = await fetch(`/api/scheduling/appointments/${id}/workspace-context?${params}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) setWorkspaceCtx(json as WorkspaceCtx);
      }
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    if (appointmentId) loadWorkspaceCtx(appointmentId);
  }, [appointmentId, loadWorkspaceCtx]);

  // Reset chargeResult when appointment changes
  useEffect(() => {
    setChargeResult(null);
    setJoinUrl(null);
  }, [appointmentId]);

  // Focus management
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const t = setTimeout(() => {
      const el = workspaceRef.current;
      if (el) {
        const focusable = focusableElements(el);
        if (focusable[0]) focusable[0].focus();
      }
    }, 50);
    return () => {
      clearTimeout(t);
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
    };
  }, []);

  // Focus trap
  useEffect(() => {
    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab" || !workspaceRef.current) return;
      const focusable = focusableElements(workspaceRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, []);

  // ESC close
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Check in / Start encounter
  const handleCheckIn = useCallback(async () => {
    if (!detail) return;
    if (checkingInRef.current) return;
    checkingInRef.current = true;
    setCheckingIn(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/encounters/create-from-appointment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: ORG_ID,
          appointmentId: detail.appointment.id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Could not start encounter");
      }
      if (json.encounterId) {
        setEncounterId(json.encounterId);
        setMode("encounter");
        setBanner({ kind: "success", text: "Encounter opened." });
        onRefresh?.();
      } else {
        setBanner({ kind: "error", text: "No encounter returned." });
      }
    } catch (e) {
      setBanner({
        kind: "error",
        text: e instanceof Error ? e.message : "Could not start encounter",
      });
    } finally {
      checkingInRef.current = false;
      setCheckingIn(false);
    }
  }, [detail, onRefresh]);

  // Open existing encounter
  const handleOpenEncounter = useCallback(() => {
    if (detail?.encounter?.id) {
      setEncounterId(detail.encounter.id);
      setMode("encounter");
    }
  }, [detail]);

  // Telehealth — generate/open join link
  const handleTelehealth = useCallback(async () => {
    if (!detail) return;
    if (joinUrl) {
      window.open(joinUrl, "_blank");
      return;
    }
    setTelehealthLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/telehealth/appointments/${detail.appointment.id}/join`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const url: string | null = json.hostUrl || json.joinUrl || null;
        if (url) {
          setJoinUrl(url);
          window.open(url, "_blank");
          try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
          setBanner({ kind: "success", text: "Telehealth session started — link copied to clipboard." });
        } else {
          setBanner({ kind: "error", text: "Session created but no link returned." });
        }
      } else {
        setBanner({ kind: "error", text: json.error ?? "Could not start telehealth session" });
      }
    } catch (e) {
      setBanner({ kind: "error", text: e instanceof Error ? e.message : "Telehealth unavailable" });
    } finally {
      setTelehealthLoading(false);
    }
  }, [detail, joinUrl]);

  // Action availability
  const actionMeta = useMemo(() => {
    if (!detail) return null;
    const { status, providerId } = detail.appointment;
    const alreadyCheckedIn = status === "checked_in" || status === "in_progress" || status === "completed";
    const isCancelled = status === "cancelled";
    const isNoShow = status === "no_show";
    const hasProvider = !!providerId;
    const hasEncounter = !!detail.encounter;
    const eligible = detail.eligibility;
    const eligibilityWarning = eligible?.displayStatus === "stale" || eligible?.displayStatus === "not_checked" || eligible?.displayStatus === "unknown";
    const authWarning = !detail.authorization?.status || detail.authorization?.status === "not_checked";
    return {
      alreadyCheckedIn,
      isCancelled,
      isNoShow,
      hasProvider,
      hasEncounter,
      eligibilityWarning,
      authWarning,
      canCheckIn: !alreadyCheckedIn && !isCancelled && !isNoShow && hasProvider,
      canCancel: !isCancelled && !alreadyCheckedIn,
      canReschedule: !isCancelled && !alreadyCheckedIn,
    };
  }, [detail]);

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-title"
    >
      <div
        ref={workspaceRef}
        className={styles.workspace}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 id="workspace-title" className={styles.title}>
            {mode === "preview" ? "Appointment" : "Visit Workspace"}
          </h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close workspace"
            type="button"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {loading ? <div className={styles.loading}>Loading…</div> : null}
          {error ? (
            <div className={`${styles.banner} ${styles.bannerError}`}>
              {error}
            </div>
          ) : null}
          {banner ? (
            <div
              className={`${styles.banner} ${
                banner.kind === "success" ? styles.bannerSuccess : styles.bannerError
              }`}
            >
              {banner.text}
            </div>
          ) : null}

          {/* Charge capture result after signing */}
          {chargeResult && mode === "preview" ? (
            <div className={styles.chargeResultPanel}>
              <div className={styles.chargeResultHeader}>
                {chargeResult.chargeStatus === "patient_responsibility" ? (
                  <span className={styles.chargeResultBadge} data-status="pr">💳 Patient Responsibility</span>
                ) : chargeResult.chargeStatus === "blocked" ? (
                  <span className={styles.chargeResultBadge} data-status="blocked">⚠️ Charge Blocked</span>
                ) : chargeResult.chargeStatus === "ready_for_claim" || chargeResult.claimId ? (
                  <span className={styles.chargeResultBadge} data-status="ready">✓ Claim Ready</span>
                ) : (
                  <span className={styles.chargeResultBadge} data-status="ready">✓ Note Signed</span>
                )}
                <span className={styles.chargeResultNote}>Visit documentation complete.</span>
              </div>
              <div className={styles.chargeResultActions}>
                {chargeResult.claimId ? (
                  <a
                    href={`/billing/claims/${chargeResult.claimId}?organizationId=${encodeURIComponent(ORG_ID)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.chargeResultLink}
                  >
                    View Claim →
                  </a>
                ) : null}
                {onOpenNext ? (
                  <button
                    type="button"
                    className={styles.openNextBtn}
                    onClick={onOpenNext}
                  >
                    Open Next Appointment →
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {detail && actionMeta ? (
            <>
              {/* Status badge */}
              <div className={styles.statusRow}>
                <span className={`${styles.statusBadge} ${chipClassForStatus(detail.appointment.status)}`}>
                  {detail.appointment.status.replace(/_/g, " ")}
                </span>
                {detail.encounter ? (
                  <span className={styles.statusBadge}>
                    Note: {detail.encounter.encounter_status}
                  </span>
                ) : null}
              </div>

              {/* Preview content */}
              <div className={styles.contentGrid}>
                <section className={styles.panel}>
                  <h3 className={styles.panelTitle}>Details</h3>
                  <div className={styles.detailList}>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Client</span>
                      <span className={styles.detailValue}>
                        {detail.appointment.clientId ? (
                          <Link href={`/clients/${detail.appointment.clientId}`} className={styles.link}>
                            {detail.appointment.clientName}
                          </Link>
                        ) : (
                          detail.appointment.clientName
                        )}
                        {detail.clientDetails?.dateOfBirth ? (
                          <span className={styles.detailMuted}>DOB: {new Date(detail.clientDetails.dateOfBirth).toLocaleDateString()}</span>
                        ) : null}
                      </span>
                    </div>

                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Time</span>
                      <span className={styles.detailValue}>
                        {fmtDateTime(detail.appointment.scheduledStartAt)} — {fmtTime(detail.appointment.scheduledEndAt)}
                        {(() => {
                          const ms =
                            new Date(detail.appointment.scheduledEndAt).getTime() -
                            new Date(detail.appointment.scheduledStartAt).getTime();
                          const mins = Math.max(0, Math.round(ms / 60000));
                          const h = Math.floor(mins / 60);
                          const m = mins % 60;
                          return (
                            <span className={styles.detailMuted}>
                              Duration: {h > 0 ? `${h}h ${m}m` : `${m} min`}
                            </span>
                          );
                        })()}
                      </span>
                    </div>

                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Clinician</span>
                      <span className={styles.detailValue}>
                        {detail.appointment.providerName || "—"}
                        {detail.appointment.serviceLocation ? (
                          <span className={styles.detailMuted}>{detail.appointment.serviceLocation}</span>
                        ) : null}
                      </span>
                    </div>

                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Type</span>
                      <span className={styles.detailValue}>
                        {apptTypeLabel(detail.appointment) ?? "—"}
                      </span>
                    </div>

                    {detail.insurance.primaryPolicy ? (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Insurance</span>
                        <span className={styles.detailValue}>
                          {detail.insurance.primaryPolicy.payerName ?? "Unknown payer"}
                          {detail.insurance.primaryPolicy.planName ? (
                            <span className={styles.detailMuted}>Plan: {detail.insurance.primaryPolicy.planName}</span>
                          ) : null}
                          <span className={styles.detailMuted}>
                            Member ID: {detail.insurance.primaryPolicy.policyNumber ?? "—"}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Insurance</span>
                        <span className={styles.detailMuted}>No primary policy on file.</span>
                      </div>
                    )}

                    {detail.eligibility ? (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Eligibility</span>
                        <span className={styles.detailValue}>
                          <span className={`${styles.elBadge} ${
                            detail.eligibility.displayStatus === "active"
                              ? styles.elBadgeActive
                              : detail.eligibility.displayStatus === "inactive"
                                ? styles.elBadgeInactive
                                : styles.elBadgeWarning
                          }`}>
                            {detail.eligibility.displayStatus === "active"
                              ? "Active"
                              : detail.eligibility.displayStatus === "inactive"
                                ? "Inactive"
                                : detail.eligibility.displayStatus === "stale"
                                  ? "Stale"
                                  : detail.eligibility.displayStatus === "unknown"
                                    ? "Unknown"
                                    : "Not checked"}
                          </span>
                          {detail.eligibility.asOf ? (
                            <span className={styles.detailMuted}>
                              As of {new Date(detail.eligibility.asOf).toLocaleDateString()}
                              {detail.eligibility.copay_amount != null
                                ? ` · copay ${money(Number(detail.eligibility.copay_amount))}`
                                : ""}
                            </span>
                          ) : (
                            <span className={styles.detailMuted}>No eligibility check on file.</span>
                          )}
                        </span>
                      </div>
                    ) : null}

                    {detail.authorization ? (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Authorization</span>
                        <span className={styles.detailValue}>
                          <span className={`${styles.elBadge} ${
                            detail.authorization.status === "approved"
                              ? styles.elBadgeActive
                              : detail.authorization.status === "denied"
                                ? styles.elBadgeInactive
                                : styles.elBadgeWarning
                          }`}>
                            {detail.authorization.status ?? "Not checked"}
                          </span>
                          {detail.authorization.authorizationNumber ? (
                            <span className={styles.detailMuted}>Ref: {detail.authorization.authorizationNumber}</span>
                          ) : null}
                        </span>
                      </div>
                    ) : null}

                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Balance</span>
                      <span className={styles.detailValue}>
                        {money(detail.balance.openBalance)} open
                      </span>
                    </div>

                    {detail.appointment.memo ? (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Memo</span>
                        <span className={styles.detailMuted}>{detail.appointment.memo}</span>
                      </div>
                    ) : null}
                  </div>
                </section>

                {/* Actions */}
                <section className={styles.panel}>
                  <h3 className={styles.panelTitle}>Actions</h3>
                  <div className={styles.actionsList}>
                    {/* Warnings */}
                    {actionMeta.eligibilityWarning ? (
                      <div className={`${styles.banner} ${styles.bannerWarning}`}>
                        Eligibility is {detail.eligibility?.displayStatus ?? "not checked"}. Check-in allowed.
                      </div>
                    ) : null}
                    {actionMeta.authWarning ? (
                      <div className={`${styles.banner} ${styles.bannerWarning}`}>
                        No authorization on file. Check-in allowed.
                      </div>
                    ) : null}
                    {!actionMeta.hasProvider && detail.appointment.cptCode ? (
                      <div className={`${styles.banner} ${styles.bannerWarning}`}>
                        No provider assigned — check-in disabled for billable appointment.
                      </div>
                    ) : null}

                    {/* Primary action */}
                    {actionMeta.alreadyCheckedIn || actionMeta.hasEncounter ? (
                      <button
                        className={styles.primaryBtn}
                        type="button"
                        onClick={handleOpenEncounter}
                        disabled={checkingIn}
                      >
                        {actionMeta.hasEncounter ? "Open Encounter" : "Open Note"}
                      </button>
                    ) : (
                      <button
                        className={styles.primaryBtn}
                        type="button"
                        onClick={handleCheckIn}
                        disabled={checkingIn || !actionMeta.canCheckIn}
                        aria-busy={checkingIn || undefined}
                        title={
                          !actionMeta.hasProvider && detail.appointment.cptCode
                            ? "Assign a provider before checking in"
                            : actionMeta.isCancelled || actionMeta.isNoShow
                              ? "Cannot check in cancelled/no-show appointment"
                              : undefined
                        }
                      >
                        {checkingIn ? (
                          <>
                            <span className={styles.spinner} aria-hidden="true" />
                            Checking in…
                          </>
                        ) : (
                          "Check In / Start Encounter"
                        )}
                      </button>
                    )}

                    {/* Telehealth */}
                    {workspaceCtx?.telehealth?.isVirtual ? (
                      <button
                        className={styles.telehealthBtn}
                        type="button"
                        onClick={handleTelehealth}
                        disabled={telehealthLoading}
                      >
                        {telehealthLoading ? (
                          <>
                            <span className={styles.spinner} aria-hidden="true" />
                            Starting…
                          </>
                        ) : joinUrl ? (
                          "▶ Rejoin Telehealth"
                        ) : (
                          "▶ Start Telehealth"
                        )}
                      </button>
                    ) : null}

                    {/* Open full chart */}
                    {detail.appointment.clientId ? (
                      <Link
                        href={`/clients/${detail.appointment.clientId}`}
                        className={styles.secondaryBtn}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Full Client Chart
                      </Link>
                    ) : null}

                    {/* Cancel */}
                    {actionMeta.canCancel && onCancel ? (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() => {
                          onCancel({
                            appointmentId: detail.appointment.id,
                            alreadyCancelled: detail.appointment.status === "cancelled",
                          });
                        }}
                      >
                        Cancel
                      </button>
                    ) : null}

                    {/* Reschedule */}
                    {actionMeta.canReschedule ? (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() => {
                          setBanner({ kind: "error", text: "Reschedule flow via schedule page — not yet wired" });
                        }}
                      >
                        Reschedule
                      </button>
                    ) : null}

                    {/* No-show */}
                    {actionMeta.canCheckIn && !actionMeta.alreadyCheckedIn ? (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() => {
                          setBanner({ kind: "error", text: "No-show flow via schedule page — not yet wired" });
                        }}
                      >
                        Mark No-Show
                      </button>
                    ) : null}

                    {/* Collect */}
                    {detail.appointment.clientId && onCollect ? (
                      <button
                        className={styles.secondaryBtn}
                        type="button"
                        onClick={() => {
                          onCollect({
                            appointmentId: detail.appointment.id,
                            clientId: detail.appointment.clientId,
                            providerId: detail.appointment.providerId,
                            openBalance: detail.balance.openBalance,
                            clientName: detail.appointment.clientName,
                          });
                        }}
                      >
                        Collect
                      </button>
                    ) : null}
                  </div>
                </section>
              </div>

              {/* Encounter clinical note */}
              {workspaceCtx?.currentSessionNote ? (
                <section className={styles.panelFull}>
                  <h3 className={styles.panelTitle}>Current Session Note</h3>
                  <div className={styles.priorSessionMeta}>
                    {workspaceCtx.currentSessionNote.date
                      ? `Visit: ${new Date(workspaceCtx.currentSessionNote.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                      : "Clinical note"}
                    {workspaceCtx.currentSessionNote.noteStatus
                      ? ` · ${workspaceCtx.currentSessionNote.noteStatus}`
                      : ""}
                  </div>
                  {workspaceCtx.currentSessionNote.subjective ? (
                    <div className={styles.priorSessionSection}>
                      <span className={styles.priorSessionSectionLabel}>Subjective</span>
                      <p className={styles.priorSessionText}>{workspaceCtx.currentSessionNote.subjective}</p>
                    </div>
                  ) : null}
                  {workspaceCtx.currentSessionNote.objective ? (
                    <div className={styles.priorSessionSection}>
                      <span className={styles.priorSessionSectionLabel}>Objective</span>
                      <p className={styles.priorSessionText}>{workspaceCtx.currentSessionNote.objective}</p>
                    </div>
                  ) : null}
                  {workspaceCtx.currentSessionNote.assessment ? (
                    <div className={styles.priorSessionSection}>
                      <span className={styles.priorSessionSectionLabel}>Assessment</span>
                      <p className={styles.priorSessionText}>{workspaceCtx.currentSessionNote.assessment}</p>
                    </div>
                  ) : null}
                  {workspaceCtx.currentSessionNote.plan ? (
                    <div className={styles.priorSessionSection}>
                      <span className={styles.priorSessionSectionLabel}>Plan</span>
                      <p className={styles.priorSessionText}>{workspaceCtx.currentSessionNote.plan}</p>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {/* Active treatment plan goals */}
              {workspaceCtx?.goals && workspaceCtx.goals.length > 0 ? (
                <section className={styles.panelFull}>
                  <h3 className={styles.panelTitle}>Active Goals</h3>
                  <ul className={styles.goalsList}>
                    {workspaceCtx.goals.map((g) => (
                      <li key={g.id} className={styles.goalItem}>
                        <span className={styles.goalDot} aria-hidden="true" />
                        <span className={styles.goalText}>{g.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* Encounter mode */}
              {mode === "encounter" && encounterId ? (
                <div className={styles.encounterWrapper}>
                  <EncounterNoteClient
                    encounterId={encounterId}
                    inlineMode
                    onInlineNavigate={(path) => {
                      if (path.startsWith("/billing/")) {
                        window.open(path, "_blank");
                      }
                    }}
                    onSigned={(data) => {
                      setChargeResult(data);
                      setMode("preview");
                      loadDetail(appointmentId);
                      onRefresh?.();
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
