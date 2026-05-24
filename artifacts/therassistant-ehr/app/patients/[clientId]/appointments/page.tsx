"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
  encounter: { id: string; status: string | null; serviceDate: string | null } | null;
};

type ProviderLite = { id: string; provider_name: string };

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

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function VisitsAppointmentsPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = params?.clientId ?? "";
  const searchParams = useSearchParams();
  const orgId = searchParams.get("organizationId") ?? process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedulerOpen, setSchedulerOpen] = useState(false);

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
                <th>Memo</th>
                <th>Status</th>
                <th>Check-in</th>
                <th>Encounter</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <tr key={appt.id}>
                  <td>{formatDate(appt.scheduledStart)}</td>
                  <td>{appt.type ?? "—"}</td>
                  <td>
                    {appt.memo ? (
                      <span
                        title={appt.memo}
                        style={{
                          display: "inline-block",
                          maxWidth: "260px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          verticalAlign: "bottom",
                        }}
                      >
                        {appt.memo}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td><span className={statusClass(appt.status)}>{appt.status ?? "—"}</span></td>
                  <td>{appt.checkedInAt ? formatDate(appt.checkedInAt) : "—"}</td>
                  <td>
                    {appt.encounter
                      ? <Link className="inline-link" href={`/encounters/${appt.encounter.id}${orgQ}`}>{appt.encounter.status ?? "open"}</Link>
                      : <span className="muted">No encounter</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {appt.encounter && (
                        <Link className="button button-secondary" href={`/encounters/${appt.encounter.id}${orgQ}`}>
                          Open Note
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {schedulerOpen ? (
        <ScheduleAppointmentModal
          organizationId={orgId}
          clientId={clientId}
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

function ScheduleAppointmentModal({
  organizationId,
  clientId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  clientId: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [providers, setProviders] = useState<ProviderLite[]>([]);
  const [providerId, setProviderId] = useState("");
  const [startAt, setStartAt] = useState<string>(defaultStart);
  const [duration, setDuration] = useState<number>(60);
  const [memo, setMemo] = useState("");
  const [serviceLocation, setServiceLocation] = useState<"office" | "telehealth">("office");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/providers?organizationId=${encodeURIComponent(organizationId)}`);
        const json = await res.json();
        const rows: ProviderLite[] = (json.providers ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          provider_name: String(r.provider_name ?? "Provider"),
        }));
        setProviders(rows);
        if (rows[0]) setProviderId(rows[0].id);
      } catch {
        setError("Could not load providers");
      }
    })();
  }, [organizationId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduling/appointments/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          clientId,
          providerId,
          scheduledStartAt: new Date(startAt).toISOString(),
          durationMinutes: Number(duration),
          appointmentType: "Therapy",
          memo,
          serviceLocation,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Could not create appointment");
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, padding: 20, minWidth: 420, maxWidth: 520,
          boxShadow: "0 20px 40px rgba(15,23,42,0.2)",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Schedule appointment</h3>
        {error ? <div className="alert-panel" style={{ marginBottom: 10 }}>{error}</div> : null}

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Provider</span>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.provider_name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Start time</span>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Duration (minutes)</span>
            <input
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
            />
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Location</span>
            <select
              value={serviceLocation}
              onChange={(e) => setServiceLocation(e.target.value as "office" | "telehealth")}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
            >
              <option value="office">Office</option>
              <option value="telehealth">Telehealth</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <span>Memo</span>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void submit()}
            disabled={busy || !providerId || !startAt}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
