"use client";

import { useEffect, useMemo, useState } from "react";

type Candidate = {
  appointment_id: string;
  client_id: string;
  insurance_policy_id: string;
  payer_id: string | null;
  payer_name: string | null;
  electronic_payer_id: string | null;
  service_date: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_dob: string | null;
  subscriber_first_name: string | null;
  subscriber_last_name: string | null;
  subscriber_dob: string | null;
  subscriber_member_id: string | null;
  relationship_to_client: string | null;
  provider_name: string | null;
};

type Batch = {
  id: string;
  batch_number: string;
  batch_month: string;
  batch_status: string;
  service_type_code: string;
  request_count: number;
  generated_file_name: string | null;
  generated_at: string | null;
  downloaded_at: string | null;
  submitted_at: string | null;
  imported_at: string | null;
  last_generation_error: string | null;
  last_import_error: string | null;
  created_at: string;
};

type Diagnostics = {
  totalAppointmentsInMonth: number;
  appointmentPolicyMissing: number;
  clientPolicyFound: number;
  clientPolicyMissing: number;
  clientPolicyRejectedMissingPayer: number;
  clientPolicyRejectedMissingSubscriber: number;
  multiplePoliciesNeedSelection: number;
  excludedNoPolicyId: number;
  excludedCanceledOrNoShow: number;
  excludedAlreadyCheckedThisMonth: number;
  includedCandidates: number;
  usedClientPolicyFallback: number;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function displayDate(value: string | null | undefined) {
  if (!value) return "-";
  return value.slice(0, 10);
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return [first, last].filter(Boolean).join(" ") || "-";
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export default function EligibilityBatchCenterClient() {
  const [month, setMonth] = useState(currentMonth());
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [raw271, setRaw271] = useState("");
  const [importBatchId, setImportBatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id),
    [selected],
  );

  async function loadBatches() {
    const response = await fetch("/api/billing/eligibility-batches", {
      cache: "no-store",
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || "Failed to load eligibility batches");
    }
    setBatches(payload.batches || []);
  }

  async function loadCandidates() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/billing/eligibility-batches/candidates?month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      const payload = await readJson(response);
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to load candidates");
      }

      const rows = payload.candidates || [];
      setCandidates(rows);
      setDiagnostics(payload.diagnostics ?? null);

      const nextSelected: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.appointment_id) nextSelected[row.appointment_id] = true;
      }
      setSelected(nextSelected);

      setMessage(
        `Found ${rows.length} scheduled client/policy record${rows.length === 1 ? "" : "s"} missing eligibility for the month.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }

  async function generateBatch() {
    setLoading(true);
    setMessage("");
    let generationMessage = "";

    try {
      const response = await fetch("/api/billing/eligibility-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, appointmentIds: selectedIds }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to generate eligibility batch");
      }

      generationMessage = payload.message || "Eligibility batch generated.";
      setMessage(generationMessage);
    } catch (error) {
      generationMessage = error instanceof Error ? error.message : "Failed to generate batch";
      setMessage(generationMessage);
    } finally {
      try {
        await loadBatches();
      } catch (loadError) {
        const loadMessage = loadError instanceof Error ? loadError.message : "Failed to reload batches";
        setMessage(generationMessage ? `${generationMessage} Batch list refresh failed: ${loadMessage}` : loadMessage);
      }
      setLoading(false);
    }
  }

  async function import271() {
    if (!importBatchId) {
      setMessage("Select a batch before importing a 271 response.");
      return;
    }

    if (!raw271.trim()) {
      setMessage("Paste the raw 271 content before importing.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/billing/eligibility-batches/${importBatchId}/import-271`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw271 }),
        },
      );
      const payload = await readJson(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.message || "Failed to import 271 response");
      }

      setMessage(payload.message || "271 response imported.");
      setRaw271("");
      await loadBatches();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to import 271");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches().catch((error) => {
      setMessage(error instanceof Error ? error.message : "Failed to load batches");
    });
  }, []);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Eligibility Batch Center</h1>
            <p className="mt-1 text-sm text-gray-600">
              Generate monthly 270 eligibility batches for scheduled clients without a current monthly verification.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-sm font-medium">Month</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="mt-1 rounded-md border px-3 py-2"
              />
            </label>

            <button
              type="button"
              onClick={loadCandidates}
              disabled={loading}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Find Missing Eligibility
            </button>

            <button
              type="button"
              onClick={generateBatch}
              disabled={loading || selectedIds.length === 0}
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Generate 270 Batch
            </button>
          </div>
        </div>

        {message ? (
          <div className="mt-4 rounded-md border bg-gray-50 p-3 text-sm text-gray-800">
            {message}
          </div>
        ) : null}

        {diagnostics ? (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Appointment Breakdown — {month}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span><strong>{diagnostics.totalAppointmentsInMonth}</strong> total appointments in month</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-amber-600">{diagnostics.appointmentPolicyMissing}</strong> appointment policy missing</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-green-700">{diagnostics.includedCandidates}</strong> eligible candidates</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-blue-700">{diagnostics.usedClientPolicyFallback}</strong> client policy fallback used</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-amber-600">{diagnostics.excludedAlreadyCheckedThisMonth}</strong> already verified this month</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-amber-600">{diagnostics.excludedNoPolicyId}</strong> no client policy found</span>
              <span className="text-gray-400">·</span>
              <span><strong className="text-amber-600">{diagnostics.excludedCanceledOrNoShow}</strong> canceled / no-show</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scheduled Clients Missing Monthly Eligibility</h2>
          <button
            type="button"
            onClick={() => {
              const allSelected: Record<string, boolean> = {};
              for (const row of candidates) {
                if (row.appointment_id) allSelected[row.appointment_id] = true;
              }
              setSelected(allSelected);
            }}
            className="text-sm font-medium text-blue-700"
          >
            Select all
          </button>
        </div>

        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Select</th>
                <th className="p-2">Service Date</th>
                <th className="p-2">Client</th>
                <th className="p-2">DOB</th>
                <th className="p-2">Payer</th>
                <th className="p-2">Member ID</th>
                <th className="p-2">Subscriber</th>
                <th className="p-2">Provider</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={8}>
                    No candidates loaded.
                  </td>
                </tr>
              ) : (
                candidates.map((row) => (
                  <tr key={`${row.appointment_id}-${row.insurance_policy_id}`} className="border-b">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[row.appointment_id])}
                        onChange={(event) =>
                          setSelected((prev) => ({
                            ...prev,
                            [row.appointment_id]: event.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td className="p-2">{displayDate(row.service_date)}</td>
                    <td className="p-2">{fullName(row.client_first_name, row.client_last_name)}</td>
                    <td className="p-2">{displayDate(row.client_dob)}</td>
                    <td className="p-2">
                      <div>{row.payer_name || "-"}</div>
                      <div className="text-xs text-gray-500">{row.electronic_payer_id || "No payer ID"}</div>
                    </td>
                    <td className="p-2">{row.subscriber_member_id || "-"}</td>
                    <td className="p-2">{fullName(row.subscriber_first_name, row.subscriber_last_name)}</td>
                    <td className="p-2">{row.provider_name || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">270 Batches</h2>

        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Batch</th>
                <th className="p-2">Month</th>
                <th className="p-2">Status</th>
                <th className="p-2">Requests</th>
                <th className="p-2">Generated</th>
                <th className="p-2">Downloaded</th>
                <th className="p-2">Imported</th>
                <th className="p-2">Download</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td className="p-4 text-gray-500" colSpan={8}>
                    No batches yet.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => {
                  const canDownload = Boolean(batch.generated_file_name || batch.generated_at);
                  return (
                    <tr key={batch.id} className="border-b">
                      <td className="p-2 font-medium">{batch.batch_number}</td>
                      <td className="p-2">{displayDate(batch.batch_month)}</td>
                      <td className="p-2">{batch.batch_status}</td>
                      <td className="p-2">{batch.request_count}</td>
                      <td className="p-2">{displayDate(batch.generated_at)}</td>
                      <td className="p-2">{displayDate(batch.downloaded_at)}</td>
                      <td className="p-2">{displayDate(batch.imported_at)}</td>
                      <td className="p-2">
                        {canDownload ? (
                          <a
                            href={`/api/billing/eligibility-batches/${batch.id}/download`}
                            className="font-medium text-blue-700"
                          >
                            Download 270
                          </a>
                        ) : (
                          <span className="text-gray-500">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Import 271 Response</h2>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Batch</span>
            <select
              value={importBatchId}
              onChange={(event) => setImportBatchId(event.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              <option value="">Select batch</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batch_number} - {batch.batch_status}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={import271}
              disabled={loading}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Import 271
            </button>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="text-sm font-medium">Paste raw 271 response</span>
          <textarea
            value={raw271}
            onChange={(event) => setRaw271(event.target.value)}
            rows={8}
            className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
            placeholder="ISA*00*..."
          />
        </label>
      </section>
    </main>
  );
}
