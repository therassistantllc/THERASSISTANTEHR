"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";
import styles from "./monthCalendar.module.css";

const ORG_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ORGANIZATION_ID) ||
  DEFAULT_ORG_ID;

type AppointmentDetail = {
  success?: boolean;
  error?: string;
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
    memo: string | null;
  };
  insurance: {
    primaryPolicy: {
      payerName: string | null;
      planName: string | null;
      policyNumber: string | null;
    } | null;
  };
  eligibility: {
    displayStatus: string | null;
    copay_amount: number | null;
  } | null;
  balance: { openBalance: number };
  encounter: { id: string; encounter_status: string | null } | null;
  clientDetails?: { dateOfBirth: string | null } | null;
  authorization?: { status: string | null; authorizationNumber: string | null } | null;
};

type Props = {
  appointmentId: string;
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
  onCollect?: (data: {
    appointmentId: string;
    clientId: string | null;
    providerId: string | null;
    openBalance: number;
    clientName: string;
  }) => void;
  onCancel?: (data: { appointmentId: string; alreadyCancelled: boolean }) => void;
  onOpenNext?: () => void;
};

function fmtDateTime(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "—";
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${s.toLocaleDateString()} ${s.toLocaleTimeString(undefined, timeOpts)} – ${e.toLocaleTimeString(undefined, timeOpts)}`;
}

function money(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "$0.00";
}

function label(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ") : "—";
}

function encounterIdFrom(value: Record<string, unknown>): string | null {
  if (typeof value.encounterId === "string" && value.encounterId) return value.encounterId;
  const encounter = value.encounter;
  if (encounter && typeof encounter === "object") {
    const id = (encounter as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

export default function AppointmentWorkspace({
  appointmentId,
  onClose,
  onRefresh,
  onCollect,
  onCancel,
  onOpenNext,
}: Props) {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedEncounterId, setStartedEncounterId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ organizationId: ORG_ID });
        const response = await fetch(
          `/api/scheduling/appointments/${appointmentId}/detail?${params}`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as AppointmentDetail;
        if (!response.ok || json.success === false) {
          throw new Error(json.error ?? "Failed to load appointment");
        }
        if (!cancelled) setDetail(json);
      } catch (loadError) {
        if (!cancelled) {
          setDetail(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load appointment");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const appt = detail?.appointment ?? null;
  const encounterId = startedEncounterId ?? detail?.encounter?.id ?? null;
  const status = appt?.status ?? "scheduled";
  const blockedStatus = status === "cancelled" || status === "no_show";
  const checkedIn = status === "checked_in" || status === "in_progress" || status === "completed";
  const canStartEncounter = Boolean(appt?.providerId) && !blockedStatus && !checkedIn;

  async function startEncounter() {
    if (!appt || busy || !canStartEncounter) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/encounters/create-from-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: ORG_ID, appointmentId: appt.id }),
      });
      const json = (await response.json()) as Record<string, unknown> & {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || json.success === false) {
        throw new Error(json.error ?? "Could not start encounter");
      }
      const nextEncounterId = encounterIdFrom(json);
      if (!nextEncounterId) throw new Error("Encounter started, but no encounter id was returned");
      setStartedEncounterId(nextEncounterId);
      await onRefresh?.();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start encounter");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.drawerOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Appointment details"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>{appt?.clientName ?? "Appointment"}</h2>
            <span className={`${styles.badge} ${blockedStatus ? styles.badgeInactive : styles.badgeUnknown}`}>
              {label(status)}
            </span>
          </div>
          <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.drawerBody}>
          {loading ? <div className={styles.sectionMuted}>Loading appointment…</div> : null}
          {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}

          {appt && detail ? (
            <>
              <div className={styles.section}>
                <span className={styles.sectionLabel}>Date / Time</span>
                <span className={styles.sectionValue}>{fmtDateTime(appt.scheduledStartAt, appt.scheduledEndAt)}</span>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Client</span>
                <span className={styles.sectionValue}>{appt.clientName}</span>
                <span className={styles.sectionMuted}>
                  DOB: {detail.clientDetails?.dateOfBirth ? new Date(detail.clientDetails.dateOfBirth).toLocaleDateString() : "—"}
                </span>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Provider</span>
                <span className={styles.sectionValue}>{appt.providerName || "—"}</span>
              </div>

              <div className={styles.row}>
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Type</span>
                  <span className={styles.sectionValue}>{appt.appointmentType || "—"}</span>
                </div>
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>CPT</span>
                  <span className={styles.sectionValue}>{appt.cptCode || "—"}</span>
                </div>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Insurance</span>
                <span className={styles.sectionValue}>{detail.insurance.primaryPolicy?.payerName ?? "No primary payer"}</span>
                <span className={styles.sectionMuted}>
                  {[detail.insurance.primaryPolicy?.planName, detail.insurance.primaryPolicy?.policyNumber].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>

              <div className={styles.row}>
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Eligibility</span>
                  <span className={styles.sectionValue}>{label(detail.eligibility?.displayStatus)}</span>
                  <span className={styles.sectionMuted}>Copay {money(detail.eligibility?.copay_amount)}</span>
                </div>
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Authorization</span>
                  <span className={styles.sectionValue}>{label(detail.authorization?.status)}</span>
                  <span className={styles.sectionMuted}>{detail.authorization?.authorizationNumber ?? "No auth number"}</span>
                </div>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Balance</span>
                <span className={styles.sectionValue}>{money(detail.balance.openBalance)} open</span>
              </div>

              <div className={styles.section}>
                <span className={styles.sectionLabel}>Encounter</span>
                <span className={styles.sectionValue}>{encounterId ? "Encounter exists" : "No encounter started"}</span>
                <span className={styles.sectionMuted}>{label(detail.encounter?.encounter_status)}</span>
              </div>

              {appt.memo ? (
                <div className={styles.section}>
                  <span className={styles.sectionLabel}>Memo</span>
                  <span className={styles.sectionMuted}>{appt.memo}</span>
                </div>
              ) : null}

              {!appt.providerId && appt.cptCode ? (
                <div className={`${styles.banner} ${styles.bannerError}`}>
                  Provider is required before a billable appointment can be started.
                </div>
              ) : null}

              <div className={styles.actions}>
                {encounterId ? (
                  <a className={styles.primaryBtn} href={`/encounters/${encounterId}`}>
                    Open encounter
                  </a>
                ) : (
                  <button className={styles.primaryBtn} type="button" onClick={startEncounter} disabled={busy || !canStartEncounter}>
                    {busy ? "Starting…" : "Start encounter"}
                  </button>
                )}

                {appt.clientId ? (
                  <a className={styles.secondaryBtn} href={`/clients/${appt.clientId}`} target="_blank" rel="noopener noreferrer">
                    Open chart
                  </a>
                ) : null}

                {appt.clientId && onCollect ? (
                  <button
                    className={styles.secondaryBtn}
                    type="button"
                    onClick={() => onCollect({
                      appointmentId: appt.id,
                      clientId: appt.clientId,
                      providerId: appt.providerId,
                      openBalance: detail.balance.openBalance,
                      clientName: appt.clientName,
                    })}
                  >
                    Collect
                  </button>
                ) : null}

                {onCancel ? (
                  <button
                    className={styles.secondaryBtn}
                    type="button"
                    disabled={blockedStatus || checkedIn}
                    onClick={() => onCancel({ appointmentId: appt.id, alreadyCancelled: status === "cancelled" })}
                  >
                    Cancel
                  </button>
                ) : null}

                {onOpenNext ? (
                  <button className={styles.secondaryBtn} type="button" onClick={onOpenNext}>
                    Open next
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
