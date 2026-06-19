"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ClientSummary = {
  id: string;
  firstName?: string | null;
  first_name?: string | null;
  preferredName?: string | null;
  preferred_name?: string | null;
  lastName?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type Appointment = {
  id: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: string | null;
  type: string | null;
  serviceLocation: string | null;
  checkedInAt: string | null;
  arrivalStatus: string | null;
  arrivalStatusAt: string | null;
  checkInReviewNeeded: boolean;
  checkInReviewReason: string | null;
};

type Answers = {
  moodRating: string;
  sessionFocus: string;
  goalFocus: string;
  symptomChange: string;
  safetyConcern: string;
  medicationChange: string;
  adminConcern: string;
};

const EMPTY_ANSWERS: Answers = {
  moodRating: "",
  sessionFocus: "",
  goalFocus: "",
  symptomChange: "none",
  safetyConcern: "no",
  medicationChange: "no",
  adminConcern: "",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function isTelehealth(appt: Appointment): boolean {
  return /telehealth|video|virtual|remote/i.test(String(appt.serviceLocation ?? ""));
}

function arrivalLabel(value: string | null | undefined): string {
  switch (value) {
    case "on_my_way":
      return "On my way";
    case "arrived":
      return "I'm here";
    default:
      return "Not marked";
  }
}

function clientDisplayName(client: ClientSummary | null): string {
  if (!client) return "Client";
  const first = client.preferredName ?? client.preferred_name ?? client.firstName ?? client.first_name ?? "";
  const last = client.lastName ?? client.last_name ?? "";
  return [first, last].filter(Boolean).join(" ").trim() || "Client";
}

export default function PortalPreviewClient({ clientId }: { clientId: string }) {
  const orgId = process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";
  const [client, setClient] = useState<ClientSummary | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const orgQ = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
      const [summaryRes, appointmentsRes] = await Promise.all([
        fetch(`/api/patients/${encodeURIComponent(clientId)}/summary`, { cache: "no-store" }),
        fetch(`/api/patients/${encodeURIComponent(clientId)}/appointments${orgQ}`, { cache: "no-store" }),
      ]);

      const summaryJson = await summaryRes.json().catch(() => null);
      const apptsJson = await appointmentsRes.json().catch(() => null);
      const p = summaryJson?.client ?? summaryJson?.data?.client ?? null;
      if (summaryRes.ok && p) setClient(p as ClientSummary);
      if (!appointmentsRes.ok || !apptsJson?.success) {
        throw new Error(apptsJson?.error ?? "Failed to load appointments");
      }
      setAppointments(apptsJson.appointments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load patient portal preview");
    } finally {
      setLoading(false);
    }
  }, [clientId, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(() => {
    const now = Date.now() - 12 * 60 * 60 * 1000;
    return appointments
      .filter((appt) => !appt.scheduledStart || new Date(appt.scheduledStart).getTime() >= now)
      .sort((a, b) => String(a.scheduledStart ?? "").localeCompare(String(b.scheduledStart ?? "")))
      .slice(0, 5);
  }, [appointments]);

  async function postCheckIn(appt: Appointment, action: "on_my_way" | "arrived" | "complete_check_in") {
    setBusyId(appt.id);
    setMessage(null);
    setError(null);
    try {
      const orgQ = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
      const payload: Record<string, unknown> = { action };
      if (action === "complete_check_in") payload.answers = answers;
      const res = await fetch(
        `/api/patients/${encodeURIComponent(clientId)}/appointments/${encodeURIComponent(appt.id)}/check-in${orgQ}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error ?? "Check-in failed");
      setMessage(action === "complete_check_in" ? "Check-in completed in preview." : "Arrival status updated in preview.");
      setExpandedId(null);
      setAnswers(EMPTY_ANSWERS);
      await load();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Check-in failed");
    } finally {
      setBusyId(null);
    }
  }

  const name = clientDisplayName(client);

  return (
    <section className="summary-block" style={{ maxWidth: 980 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>Staff testing</p>
          <h2 style={{ margin: "4px 0 0" }}>Patient portal preview</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Preview what {name} sees on a cellphone before sending or testing a real portal invite.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/patients/${clientId}/portal`} className="summary-rail-action">Portal access</Link>
          <Link href={`/clients/${clientId}`} className="summary-rail-action">Back to chart</Link>
        </div>
      </header>

      {message ? <div className="alert-panel" style={{ marginTop: 12 }}>{message}</div> : null}
      {error ? <div className="alert-panel" style={{ marginTop: 12, color: "#b91c1c" }}>{error}</div> : null}

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(280px, 390px) 1fr", gap: 18, alignItems: "start" }}>
        <div
          style={{
            border: "12px solid #111827",
            borderRadius: 36,
            overflow: "hidden",
            boxShadow: "0 18px 45px rgba(15, 23, 42, .22)",
            background: "#f8fafc",
            minHeight: 620,
          }}
        >
          <div style={{ padding: "14px 16px", background: "#0f172a", color: "#fff", textAlign: "center", fontSize: 13 }}>
            THERASSISTANT EHR App Preview
          </div>
          <div style={{ padding: 18 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Welcome</p>
            <h3 style={{ margin: "4px 0 4px", fontSize: 24 }}>Hi, {name.split(" ")[0] || "there"}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Check in for your appointment and let your clinician know what you want to focus on.
            </p>

            {loading ? <p className="muted">Loading portal preview…</p> : null}
            {!loading && upcoming.length === 0 ? <p className="muted">No upcoming appointments to display.</p> : null}

            <div style={{ display: "grid", gap: 12 }}>
              {upcoming.map((appt) => {
                const telehealth = isTelehealth(appt);
                const expanded = expandedId === appt.id;
                const busy = busyId === appt.id;
                return (
                  <article key={appt.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <strong>{appt.type ?? "Appointment"}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>{formatDateTime(appt.scheduledStart)}</div>
                        <div className="muted" style={{ fontSize: 13 }}>{telehealth ? "Telehealth" : "In person"}</div>
                      </div>
                      <span className={appt.checkedInAt ? "status status-green" : "status status-yellow"}>
                        {appt.checkedInAt ? "Checked in" : "Not checked in"}
                      </span>
                    </div>

                    {!telehealth ? (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="button button-secondary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "on_my_way")}>On my way</button>
                        <button className="button button-secondary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "arrived")}>I&apos;m here</button>
                      </div>
                    ) : null}

                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                      Arrival: {telehealth ? "Not used for telehealth" : arrivalLabel(appt.arrivalStatus)}
                    </div>

                    <button
                      className="button button-primary"
                      type="button"
                      style={{ width: "100%", marginTop: 12 }}
                      disabled={busy}
                      onClick={() => {
                        setExpandedId(expanded ? null : appt.id);
                        setAnswers(EMPTY_ANSWERS);
                      }}
                    >
                      {appt.checkedInAt ? "Update Check-In" : "Start Check-In"}
                    </button>

                    {expanded ? (
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
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
                        <button className="button button-primary" type="button" disabled={busy} onClick={() => postCheckIn(appt, "complete_check_in")}>{busy ? "Saving…" : "Complete Check-In"}</button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <aside style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Testing notes</h3>
          <p className="muted">
            This is a staff preview, not the actual client session. It uses the authenticated app APIs so you can test the check-in flow without emailing a portal invite.
          </p>
          <p className="muted">
            For in-person visits, test On my way, I&apos;m here, and Complete Check-In. For telehealth, only test Complete Check-In.
          </p>
          <p className="muted">
            After completing check-in, return to the calendar. The appointment should display as checked in and open the appointment drawer when clicked.
          </p>
        </aside>
      </div>
    </section>
  );
}
