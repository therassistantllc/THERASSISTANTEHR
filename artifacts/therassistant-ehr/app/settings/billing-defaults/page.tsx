"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for billing defaults. This page replaces the
 * placeholder with a form that reads and writes the organization's
 * billing provider profile stored in the `system_settings` table under
 * the key `organization.billing_profile`. The form captures billing
 * provider identity and contact details used in claim boxes 33 and
 * envelopes. Changes here apply prospectively and do not rewrite
 * historical claims.
 */
interface BillingProfile {
  billingProviderName: string;
  billingProviderNpi: string;
  billingProviderTaxId: string;
  billingProviderAddress: string;
  billingProviderCity: string;
  billingProviderState: string;
  billingProviderZip: string;
  authorizedRepName: string;
  authorizedRepTitle: string;
  authorizedRepPhone: string;
}

export default function BillingDefaultsSettingsPage() {
  const [profile, setProfile] = useState<BillingProfile>({
    billingProviderName: "",
    billingProviderNpi: "",
    billingProviderTaxId: "",
    billingProviderAddress: "",
    billingProviderCity: "",
    billingProviderState: "",
    billingProviderZip: "",
    authorizedRepName: "",
    authorizedRepTitle: "",
    authorizedRepPhone: "",
  });
  const [recordId, setRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.billing_profile")
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setRecordId(data.id);
        try {
          const parsed = JSON.parse(data.value ?? '{}');
          setProfile({
            billingProviderName: parsed.billingProviderName ?? "",
            billingProviderNpi: parsed.billingProviderNpi ?? "",
            billingProviderTaxId: parsed.billingProviderTaxId ?? "",
            billingProviderAddress: parsed.billingProviderAddress ?? "",
            billingProviderCity: parsed.billingProviderCity ?? "",
            billingProviderState: parsed.billingProviderState ?? "",
            billingProviderZip: parsed.billingProviderZip ?? "",
            authorizedRepName: parsed.authorizedRepName ?? "",
            authorizedRepTitle: parsed.authorizedRepTitle ?? "",
            authorizedRepPhone: parsed.authorizedRepPhone ?? "",
          });
        } catch {
          // ignore JSON parse errors
        }
      }
      setLoading(false);
    }
    fetchProfile().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  const handleChange = (field: keyof BillingProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    // Validate required fields
    if (!profile.billingProviderName.trim()) {
      setError("Billing provider name is required.");
      return;
    }
    if (!profile.billingProviderNpi.trim()) {
      setError("Billing provider NPI is required.");
      return;
    }
    if (!profile.billingProviderTaxId.trim()) {
      setError("Billing provider Tax ID is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data: beforeData } = await supabase
        .from("system_settings")
        .select("id, value")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("key", "organization.billing_profile")
        .maybeSingle();

      const payload = {
        id: recordId || undefined,
        organization_id: ORGANIZATION_ID,
        key: "organization.billing_profile",
        value: JSON.stringify(profile),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("system_settings")
        .upsert([payload], { onConflict: "id" });
      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
        return;
      }
      setRecordId(payload.id || recordId);

      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated billing defaults",
        event_metadata: { before: beforeData, after: payload },
        object_type: "billing_profile",
        object_id: payload.id || null,
        action: "update",
      });

      setMessage("Billing defaults saved successfully.");
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
      <h1 className="text-2xl font-semibold text-gray-900">Billing Defaults</h1>
      <p className="mt-2 text-sm text-gray-600">
        Configure your billing provider identity and authorized representative.
        These values populate claim box 33 and EDI loops. Changes apply to new
        claims and do not modify historical submissions.
      </p>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-4 text-sm text-green-600">{message}</p>}
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Billing Provider Name
          </label>
          <input
            type="text"
            value={profile.billingProviderName}
            onChange={(e) => handleChange("billingProviderName", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Billing Provider NPI
          </label>
          <input
            type="text"
            value={profile.billingProviderNpi}
            onChange={(e) => handleChange("billingProviderNpi", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Billing Provider Tax ID
          </label>
          <input
            type="text"
            value={profile.billingProviderTaxId}
            onChange={(e) => handleChange("billingProviderTaxId", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Billing Provider Address
          </label>
          <input
            type="text"
            value={profile.billingProviderAddress}
            onChange={(e) => handleChange("billingProviderAddress", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            City
          </label>
          <input
            type="text"
            value={profile.billingProviderCity}
            onChange={(e) => handleChange("billingProviderCity", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            State
          </label>
          <input
            type="text"
            value={profile.billingProviderState}
            onChange={(e) => handleChange("billingProviderState", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={2}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            ZIP Code
          </label>
          <input
            type="text"
            value={profile.billingProviderZip}
            onChange={(e) => handleChange("billingProviderZip", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            maxLength={10}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Authorized Rep Name
          </label>
          <input
            type="text"
            value={profile.authorizedRepName}
            onChange={(e) => handleChange("authorizedRepName", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Authorized Rep Title
          </label>
          <input
            type="text"
            value={profile.authorizedRepTitle}
            onChange={(e) => handleChange("authorizedRepTitle", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Authorized Rep Phone
          </label>
          <input
            type="text"
            value={profile.authorizedRepPhone}
            onChange={(e) => handleChange("authorizedRepPhone", e.target.value)}
            className="mt-1 block w-full rounded border-gray-300 shadow-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </form>
      <div className="mt-4 text-sm">
        <a href="/settings" className="font-medium text-blue-700 hover:text-blue-800">
          Back to Settings index
        </a>
      </div>
    </main>
  );
}
