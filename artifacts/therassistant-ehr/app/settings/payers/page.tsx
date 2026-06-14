"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for payer profiles. This page replaces the
 * placeholder with a real form that persists to the `payer_profiles`
 * table and writes an audit event on save. Each payer row is editable
 * and new rows can be added. Updates here feed into claim generation,
 * eligibility checks and other workflows but will not retroactively
 * alter past claims.
 */
interface PayerProfile {
  id?: string;
  payer_name: string;
  availity_payer_id: string;
  payer_type: string;
  is_active: boolean;
}

export default function PayersSettingsPage() {
  const [payers, setPayers] = useState<PayerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Load payer profiles on mount
  useEffect(() => {
    async function fetchPayers() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("payer_profiles")
        .select("id, payer_name, availity_payer_id, payer_type, is_active")
        .eq("organization_id", ORGANIZATION_ID);
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setPayers(
          data.map((row) => ({
            id: row.id,
            payer_name: row.payer_name ?? "",
            availity_payer_id: row.availity_payer_id ?? "",
            payer_type: row.payer_type ?? "",
            is_active: row.is_active ?? true,
          })) as PayerProfile[],
        );
      }
      setLoading(false);
    }
    fetchPayers().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  // Update payer field
  const handleFieldChange = (
    index: number,
    field: keyof PayerProfile,
    value: string,
  ) => {
    setPayers((prev) =>
      prev.map((payer, i) => (i === index ? { ...payer, [field]: value } : payer)),
    );
  };

  const handleCheckboxChange = (index: number, checked: boolean) => {
    setPayers((prev) =>
      prev.map((payer, i) => (i === index ? { ...payer, is_active: checked } : payer)),
    );
  };

  // Add a new payer row
  const addPayer = () => {
    setPayers((prev) => [
      ...prev,
      {
        payer_name: "",
        availity_payer_id: "",
        payer_type: "",
        is_active: true,
      },
    ]);
  };

  // Save all payer profiles (upsert) and write audit log
  const handleSave = async () => {
    // Validate: require payer_name for all rows
    for (const p of payers) {
      if (!p.payer_name || !p.payer_name.trim()) {
        setError("Each payer must have a name.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Capture before state for auditing
      const { data: beforeData } = await supabase
        .from("payer_profiles")
        .select("id, payer_name, availity_payer_id, payer_type, is_active")
        .eq("organization_id", ORGANIZATION_ID);

      // Prepare upsert payload
      const upsertPayload = payers.map((p) => ({
        id: p.id || undefined,
        organization_id: ORGANIZATION_ID,
        payer_name: p.payer_name,
        availity_payer_id: p.availity_payer_id || null,
        payer_type: p.payer_type || null,
        is_active: p.is_active,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from("payer_profiles")
        .upsert(upsertPayload, { onConflict: "id" });

      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
        return;
      }

      // Audit log
      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated payer profiles",
        event_metadata: { before: beforeData, after: upsertPayload },
        object_type: "payer_profile",
        object_id: null,
        action: "update",
      });

      setMessage("Payer profiles saved successfully.");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="p-6">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Payer Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Manage payer profiles used for claim submission, eligibility, and remit
        matching. Changes here apply to new claims only and will not
        retroactively change historical submissions.
      </p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-4 text-sm text-green-600">{message}</p>}
      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        {payers.map((payer, index) => (
          <div
            key={index}
            className="rounded-md border border-gray-200 p-4 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Payer Name
              </label>
              <input
                type="text"
                value={payer.payer_name}
                onChange={(e) => handleFieldChange(index, "payer_name", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Availity Payer ID
              </label>
              <input
                type="text"
                value={payer.availity_payer_id}
                onChange={(e) => handleFieldChange(index, "availity_payer_id", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Payer Type
              </label>
              <input
                type="text"
                value={payer.payer_type}
                onChange={(e) => handleFieldChange(index, "payer_type", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={payer.is_active}
                onChange={(e) => handleCheckboxChange(index, e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
              />
              <label className="ml-2 block text-sm text-gray-700">Active</label>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addPayer}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700"
          >
            Add Payer
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
      <div className="mt-4 text-sm">
        <a href="/settings" className="font-medium text-blue-700 hover:text-blue-800">
          Back to Settings index
        </a>
      </div>
    </main>
  );
}
