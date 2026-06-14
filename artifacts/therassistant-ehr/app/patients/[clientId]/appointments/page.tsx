"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CreateAppointmentModal } from "@/app/calendar/MonthCalendarClient";

type Appointment = {
  id: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: string | null;
  type: string | null;
  memo: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  providerId: string | null;
  createdAt: string | null;
  serviceLocation: string | null;
  arrivalStatus: string | null;
  arrivalStatusAt: string | null;
  checkInReviewNeeded: boolean;
  checkInReviewReason: string | null;
  checkInAnswers: Record<string, unknown> | null;
  encounter: { id: string; status: string | null; serviceDate: string | null } | null;
};

type CheckInAnswers = {
  moodRating: string;
  sessionFocus: string;
  goalFocus: string;
  symptomChange: string;
  safetyConcern: string;
  medicationChange: string;
  adminConcern: string;
};

const EMPTY_ANSWERS: CheckInAnswers = {
  moodRating: "",
  sessionFocus: "",
  goalFocus: "",
  symptomChange: "none",
  safetyConcern: "no",
  medicationChange: "no",
  adminConcern: "",
};

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusClass(v: string | null | undefined) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("complet") || s.includes("checked_in") || s.includes("check_in")) return "status status-green";
  if (s.includes("cancel") || s.includes("no_show") || s.includes("noshow")) return "status status-red";
  if (s.includes("schedul") || s.includes("confirm") || s.includes("scheduled")) return "status status-yellow";
  return "status";
}

function isTelehealth(appt: Appointment): boolean {
  return /telehealth|video|virtual|remote/i.test(String(appt.serviceLocation ?? ""));
}

function arrivalLabel(v: string | null | undefined): string {
  switch (v) {
    case "on_my_way":
      return "On my way";
    case "arrived":
      return "I'm here";
    default:
      return "—";
  }
}

export default function VisitsAppointmentsPage() {
  const params = useParams<{ clientId?: string; id?: string }>();
  const clientId = params?.clientId ?? params?.id ?? "";
  const searchParams = useSearchParams();
  const orgId = searchParams.get("organizationId") ?? process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [checkInOpenId, setCheckInOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<CheckInAnswers>(EMPTY_ANSWERS);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId || !orgId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/patients/${clientId}/appointments?organizationId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const json = (await r.json()) as { success: boolean; appointments?: Appointment[]; error?: string };
      if (!json.success) throw new Error(json.error ?? "Failed");
      setAppointments(json.appointments ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [clientId, orgId]);

  useEffect(() => { void load(); }, [load]);

  async function postCheckIn(appt: Appointment, action: "on_my_way" | "arrived" | "complete_check_in") {
    setBusyId(appt.id);
    setError(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (action === "complete_check_in") payload.answers = answers;
      const r = await fetch(
        `/api/patients/${encodeURIComponent(clientId)}/appointments/${encodeURIComponent(appt.id)}/check-in?organizationId=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await r.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!r.ok || !json?.success) throw new Error(json?.error ?? "Check-in update failed");
      setCheckInOpenId(null);
      setAnswers(EMPTY_ANSWERS);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check-in update failed");
    } finally {
      setBusyId(null);
    }
  }

  const orgQ = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";

  return (
    <main className="app-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">Client Chart</p>
          <h2>Visits &amp; Appointments</h2>
        </div>
        <div className="hero-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => setSchedulerOpen(true)}
            disabled={!orgId || !clientId}
          >
            Schedule Appointment
          </button>
        </div>
      </section>

      {loading && <div className="empty-state">Loading appointments…</div>}
      {error && <div className="alert-panel">{error}</div>}

      {!loading && appointments.length === 0 && !error && (
        <div className="empty-state">No appointments found for this client.</div>
      )}

      {appointments.length > 0 && (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Type</th>
                <th>Location</th>
                <th>Status</th>
                <th>Arrival</th>
                <th>Check-in</th>
                <th>Encounter</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => {
                const telehealth = isTelehealth(appt);
                const checkInOpen = checkInOpenId === appt.id;
                const busy = busyId === appt.id;
                return (
                  <tr key={appt.id}>
                    <td>{formatDate(appt.scheduledStart)}</td>
                    <td>{appt.type ?? "—"}</td>
                    <td>{appt.serviceLocation ?? "—"}</td>
                    <td><span className={statusClass(appt.status)}>{appt.status ?? "—"}</span></td>
                    <td>
                      <div>{telehealth ? "Not used" : arrivalLabel(appt.arrivalStatus)}</div>
                      {appt.arrivalStatusAt ? <div className="muted">{formatDate(appt.arrivalStatusAt)}</div> : null}
                    </td>
                    <td>
                      {appt.checkedInAt ? (
                        <>
                          <div>{formatDate(appt.checkedInAt)}</div>
                          {appt.checkInReviewNeeded ? (
                            <div className="status status-red" title={appt.checkInReviewReason ?? undefined}>Review needed</div>
                          ) : null}
                        </>
                      ) : "—"}
                    </td>
                    <td>
                      {appt.encounter
                        ? <Link className="inline-link" href={`/encounters/${appt.encounter.id}${orgQ}`}>{appt.encounter.status ?? "open"}</Link>
                        : <span className="muted">No encounter</span>}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {!telehealth ? (
                          <>
                            <button className="button button-secondary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "on_my_way")}>On my way</button>
                            <button className="button button-secondary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "arrived")}>I'm here</button>
                          </>
                        ) : null}
                        <button
                          className="button button-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setCheckInOpenId(checkInOpen ? null : appt.id);
                            setAnswers(EMPTY_ANSWERS);
                          }}
                        >
                          {appt.checkedInAt ? "Update Check-In" : "Start Check-In"}
                        </button>
                        {appt.encounter && (
                          <Link className="button button-secondary" href={`/encounters/${appt.encounter.id}${orgQ}`}>
                            Open Note
                          </Link>
                        )}
                      </div>
                      {checkInOpen ? (
                        <div style={{ marginTop: 10, padding: 10, border: "1px solid #e5e7eb", borderRadius: 8, minWidth: 280 }}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <label>
                              <span className="muted">Mood 1-10</span>
                              <input className="input" value={answers.moodRating} onChange={(e) => setAnswers({ ...answers, moodRating: e.target.value })} inputMode="numeric" />
                            </label>
                            <label>
                              <span className="muted">What do you want to focus on today?</span>
                              <textarea className="input" value={answers.sessionFocus} onChange={(e) => setAnswers({ ...answers, sessionFocus: e.target.value })} />
                            </label>
                            <label>
                              <span className="muted">Goal you want to work on</span>
                              <input className="input" value={answers.goalFocus} onChange={(e) => setAnswers({ ...answers, goalFocus: e.target.value })} />
                            </label>
                            <label>
                              <span className="muted">Symptom change</span>
                              <select className="input" value={answers.symptomChange} onChange={(e) => setAnswers({ ...answers, symptomChange: e.target.value })}>
                                <option value="none">No major change</option>
                                <option value="minor">Minor change</option>
                                <option value="major">Major change</option>
                              </select>
                            </label>
                            <label>
                              <span className="muted">Safety concern?</span>
                              <select className="input" value={answers.safetyConcern} onChange={(e) => setAnswers({ ...answers, safetyConcern: e.target.value })}>
                                <option value="no">No</option>
                                <option value="yes">Yes</option>
                              </select>
                            </label>
                            <label>
                              <span className="muted">Medication change?</span>
                              <select className="input" value={answers.medicationChange} onChange={(e) => setAnswers({ ...answers, medicationChange: e.target.value })}>
                                <option value="no">No</option>
                                <option value="yes">Yes</option>
                              </select>
                            </label>
                            <label>
                              <span className="muted">Admin or billing concern</span>
                              <input className="input" value={answers.adminConcern} onChange={(e) => setAnswers({ ...answers, adminConcern: e.target.value })} />
                            </label>
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button className="button button-primary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "complete_check_in")}>
                              {busy ? "Saving…" : "Complete Check-In"}
                            </button>
                            <button className="button button-secondary" type="button" disabled={busy} onClick={() => setCheckInOpenId(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {schedulerOpen && orgId && clientId ? (
        <CreateAppointmentModal
          organizationId={orgId}
          lockedClientId={clientId}
          onClose={() => setSchedulerOpen(false)}
          onCreated={async () => {
            setSchedulerOpen(false);
            await load();
          }}
        />
      ) : null}
    </main>
  );
}
