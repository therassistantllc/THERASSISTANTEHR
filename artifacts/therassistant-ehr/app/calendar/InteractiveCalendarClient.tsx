"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./monthCalendar.module.css";
import TodayVisitsSidebar from "./TodayVisitsSidebar";
import { CreateAppointmentModal } from "./MonthCalendarClient";
import { DEFAULT_ORG_ID } from "@/lib/config";

const ORG_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ORGANIZATION_ID) ||
  DEFAULT_ORG_ID;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type ListAppointment = {
  id: string;
  clientId: string | null;
  encounterId?: string | null;
  clientName: string;
  providerId: string | null;
  providerName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: string;
  appointmentType: string | null;
  serviceLocation: string | null;
  cptCode: string | null;
  checkInAt?: string | null;
  arrivalStatus?: string | null;
  arrivalStatusAt?: string | null;
  checkInReviewNeeded?: boolean;
  checkInReviewReason?: string | null;
};

type AppointmentDetail = {
  appointment?: {
    id: string;
    clientId: string | null;
    clientName: string;
    providerName: string;
    status: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    appointmentType: string | null;
    serviceLocation: string | null;
    cptCode: string | null;
    memo: string | null;
  };
  eligibility?: { displayStatus?: string | null; asOf?: string | null };
  balance?: { openBalance?: number | null };
  encounter?: { id?: string; encounter_status?: string | null; status?: string | null } | null;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtMonth(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: number | null | undefined) {
  const amount = Number(n ?? 0);
  return `$${amount.toFixed(2)}`;
}

function apptTypeLabel(appt: { appointmentType: string | null; cptCode: string | null }): string | null {
  const raw = (appt.appointmentType ?? "").trim();
  if (!raw) return null;
  if (/^9\d{4}$/.test(raw)) return null;
  if (appt.cptCode && raw === appt.cptCode) return null;
  return raw;
}

function chipClassFor(appt: ListAppointment): string {
  if (appt.checkInReviewNeeded) return styles.chipCancelled;
  switch (appt.status) {
    case "completed":
      return styles.chipCompleted;
    case "cancelled":
      return styles.chipCancelled;
    case "no_show":
      return styles.chipNoShow;
    case "in_progress":
    case "checked_in":
      return styles.chipInProgress;
    default:
      if (appt.arrivalStatus === "arrived") return styles.chipInProgress;
      return "";
  }
}

function arrivalLabel(v: string | null | undefined) {
  switch (v) {
    case "on_my_way":
      return "On my way";
    case "arrived":
      return "I'm here";
    default:
      return "Not marked";
  }
}

function statusLabel(appt: ListAppointment) {
  if (appt.checkInReviewNeeded) return "Review needed";
  if (appt.checkInAt) return "Checked in";
  if (appt.arrivalStatus === "arrived") return "I'm here";
  if (appt.arrivalStatus === "on_my_way") return "On my way";
  return appt.status.replace(/_/g, " ");
}

export default function InteractiveCalendarClient() {
  const [cursor, setCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [appointments, setAppointments] = useState<ListAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [today, setToday] = useState<Date | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialDate, setCreateInitialDate] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => setToday(new Date()), []);

  const gridStart = useMemo(() => startOfWeek(startOfMonth(cursor)), [cursor]);
  const gridDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [gridStart]);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const from = gridDays[0].toISOString();
      const lastEnd = new Date(gridDays[41]);
      lastEnd.setDate(lastEnd.getDate() + 1);
      const params = new URLSearchParams({ organizationId: ORG_ID, from, to: lastEnd.toISOString() });
      const res = await fetch(`/api/scheduling/appointments?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load appointments");
      setAppointments(json.appointments ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load appointments");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [gridDays]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  const selected = useMemo(
    () => appointments.find((appt) => appt.id === selectedId) ?? null,
    [appointments, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    if (!selectedId) return;
    (async () => {
      try {
        const res = await fetch(`/api/scheduling/appointments/${selectedId}/detail?organizationId=${encodeURIComponent(ORG_ID)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load appointment detail");
        if (!cancelled) setDetail(json as AppointmentDetail);
      } catch (error) {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : "Failed to load appointment detail");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const dayBuckets = useMemo(() => {
    const map = new Map<string, ListAppointment[]>();
    for (const appt of appointments) {
      const d = new Date(appt.scheduledStartAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(appt);
      map.set(key, list);
    }
    return map;
  }, [appointments]);

  function openCreateForDate(day: Date) {
    const y = day.getFullYear();
    const m = String(day.getMonth() + 1).padStart(2, "0");
    const d = String(day.getDate()).padStart(2, "0");
    setCreateInitialDate(`${y}-${m}-${d}`);
    setCreateOpen(true);
  }

  function closeDrawer() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.navBtn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
          <button className={styles.navBtn} onClick={() => {
            const t = today ?? new Date();
            setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
          }}>Today</button>
          <button className={styles.navBtn} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">›</button>
          <div>
            <h1 className={styles.title}>{fmtMonth(cursor)}</h1>
            <div className={styles.subtitle}>{loading ? "Loading…" : `${appointments.length} appointment${appointments.length === 1 ? "" : "s"} in view`}</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.primaryBtn} onClick={() => setCreateOpen(true)}>+ New appointment</button>
        </div>
      </header>

      <div className={styles.body}>
        <TodayVisitsSidebar appointments={appointments} selectedId={selectedId} onSelect={setSelectedId} today={today} />
        <div className={styles.calendarArea}>
          {loadError ? <div className={`${styles.banner} ${styles.bannerError}`}>{loadError}</div> : null}
          <div className={styles.weekHeader}>{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className={styles.grid}>
            {gridDays.map((day) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = today ? isSameDay(day, today) : false;
              const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
              const dayAppointments = (dayBuckets.get(key) ?? []).sort((a, b) => a.scheduledStartAt.localeCompare(b.scheduledStartAt));
              const visible = dayAppointments.slice(0, 4);
              const overflow = dayAppointments.length - visible.length;
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add appointment on ${day.toLocaleDateString()}`}
                  className={`${styles.cell} ${inMonth ? "" : styles.cellOther} ${isToday ? styles.cellToday : ""}`}
                  onClick={() => openCreateForDate(day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openCreateForDate(day);
                    }
                  }}
                >
                  <span className={styles.dayNum}>{day.getDate()}</span>
                  {visible.map((appt) => {
                    const typeLabel = apptTypeLabel(appt);
                    const cpt = appt.cptCode;
                    return (
                      <button
                        key={appt.id}
                        type="button"
                        className={`${styles.chip} ${chipClassFor(appt)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(appt.id);
                        }}
                        title="Open appointment"
                        style={{ display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer" }}
                      >
                        <strong>{fmtTime(appt.scheduledStartAt)}</strong> {appt.clientName}
                        <div className={styles.chipMeta}>
                          <span className={styles.chipMetaPrimary}>{statusLabel(appt)}</span>
                          {typeLabel || cpt ? <span className={styles.chipCpt}>{typeLabel ?? cpt}</span> : null}
                        </div>
                      </button>
                    );
                  })}
                  {overflow > 0 ? <div className={styles.overflow}>+{overflow} more</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected ? (
        <AppointmentDrawer
          appointment={selected}
          detail={detail}
          detailError={detailError}
          organizationId={ORG_ID}
          onClose={closeDrawer}
        />
      ) : null}

      {createOpen ? (
        <CreateAppointmentModal
          organizationId={ORG_ID}
          initialDate={createInitialDate}
          onClose={() => {
            setCreateOpen(false);
            setCreateInitialDate(null);
          }}
          onCreated={async () => {
            setCreateOpen(false);
            setCreateInitialDate(null);
            await loadAppointments();
          }}
        />
      ) : null}
    </div>
  );
}

function AppointmentDrawer({
  appointment,
  detail,
  detailError,
  organizationId,
  onClose,
}: {
  appointment: ListAppointment;
  detail: AppointmentDetail | null;
  detailError: string | null;
  organizationId: string;
  onClose: () => void;
}) {
  const appt = detail?.appointment;
  const clientId = appt?.clientId ?? appointment.clientId;
  const encounterId = detail?.encounter?.id ?? appointment.encounterId ?? null;
  const typeLabel = apptTypeLabel(appointment) ?? appt?.appointmentType ?? appointment.appointmentType ?? "Appointment";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Appointment detail"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(15, 23, 42, .28)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: "min(520px, 100vw)",
          height: "100%",
          background: "#fff",
          boxShadow: "-18px 0 45px rgba(15, 23, 42, .18)",
          padding: 20,
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>Appointment</p>
            <h2 style={{ margin: "4px 0 0" }}>{appt?.clientName ?? appointment.clientName}</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {fmtDateTime(appt?.scheduledStartAt ?? appointment.scheduledStartAt)} · {typeLabel}
            </p>
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>Close</button>
        </div>

        {detailError ? <div className={`${styles.banner} ${styles.bannerError}`} style={{ marginTop: 12 }}>{detailError}</div> : null}

        <section style={{ marginTop: 18, border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
          <h3 style={{ margin: 0 }}>Client check-in</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", rowGap: 8, columnGap: 10, margin: "12px 0 0", fontSize: 14 }}>
            <dt className="muted">Status</dt>
            <dd style={{ margin: 0 }}>{statusLabel(appointment)}</dd>
            <dt className="muted">Check-in complete</dt>
            <dd style={{ margin: 0 }}>{appointment.checkInAt ? fmtDateTime(appointment.checkInAt) : "No"}</dd>
            <dt className="muted">Arrival</dt>
            <dd style={{ margin: 0 }}>{arrivalLabel(appointment.arrivalStatus)}</dd>
            <dt className="muted">Review flag</dt>
            <dd style={{ margin: 0 }}>{appointment.checkInReviewNeeded ? appointment.checkInReviewReason || "Review needed" : "None"}</dd>
          </dl>
        </section>

        <section style={{ marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
          <h3 style={{ margin: 0 }}>Visit context</h3>
          <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", rowGap: 8, columnGap: 10, margin: "12px 0 0", fontSize: 14 }}>
            <dt className="muted">Provider</dt>
            <dd style={{ margin: 0 }}>{appt?.providerName ?? appointment.providerName}</dd>
            <dt className="muted">Location</dt>
            <dd style={{ margin: 0 }}>{appt?.serviceLocation ?? appointment.serviceLocation ?? "—"}</dd>
            <dt className="muted">CPT</dt>
            <dd style={{ margin: 0 }}>{appt?.cptCode ?? appointment.cptCode ?? "—"}</dd>
            <dt className="muted">Eligibility</dt>
            <dd style={{ margin: 0 }}>{detail?.eligibility?.displayStatus ?? "—"}</dd>
            <dt className="muted">Open balance</dt>
            <dd style={{ margin: 0 }}>{money(detail?.balance?.openBalance)}</dd>
          </dl>
        </section>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {encounterId ? (
            <a className={styles.primaryBtn} href={`/encounters/${encounterId}?organizationId=${encodeURIComponent(organizationId)}`}>Open Note</a>
          ) : null}
          {clientId ? (
            <a className={styles.secondaryBtn} href={`/patients/${clientId}/appointments?organizationId=${encodeURIComponent(organizationId)}`}>Open Client Appointments</a>
          ) : null}
          {clientId ? (
            <a className={styles.secondaryBtn} href={`/clients/${clientId}`}>Open Chart</a>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
