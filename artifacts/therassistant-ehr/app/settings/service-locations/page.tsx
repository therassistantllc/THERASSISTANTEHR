"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { ORGANIZATION_ID } from "@/lib/config";

/**
 * Live admin form for service location settings. This page lets users
 * manage the physical and virtual service locations used on claims and
 * superbills. The form loads all service_locations for the current
 * organization, allows adding/editing rows, validates basic fields
 * (name and place of service code), and persists changes to the
 * `service_locations` table. An audit log entry records the before
 * and after state. Only one location can be marked as the default.
 */
interface ServiceLocation {
  id?: string;
  name: string;
  location_type: string;
  place_of_service_code: string;
  npi: string;
  is_active: boolean;
  is_default: boolean;
}

export default function ServiceLocationsSettingsPage() {
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchLocations() {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("service_locations")
        .select(
          "id, name, location_type, place_of_service_code, npi, is_active, is_default",
        )
        .eq("organization_id", ORGANIZATION_ID);
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setLocations(
          data.map((row) => ({
            id: row.id,
            name: row.name ?? "",
            location_type: row.location_type ?? "",
            place_of_service_code: row.place_of_service_code ?? "",
            npi: row.npi ?? "",
            is_active: row.is_active ?? true,
            is_default: row.is_default ?? false,
          })) as ServiceLocation[],
        );
      }
      setLoading(false);
    }
    fetchLocations().catch((err) => {
      setError(String(err));
      setLoading(false);
    });
  }, []);

  const handleFieldChange = (
    index: number,
    field: keyof ServiceLocation,
    value: string | boolean,
  ) => {
    setLocations((prev) =>
      prev.map((loc, i) => (i === index ? { ...loc, [field]: value } : loc)),
    );
  };

  // Add a new location row
  const addLocation = () => {
    setLocations((prev) => [
      ...prev,
      {
        name: "",
        location_type: "",
        place_of_service_code: "",
        npi: "",
        is_active: true,
        is_default: false,
      },
    ]);
  };

  const handleSave = async () => {
    // Validate: each location must have a name and POS code
    for (const loc of locations) {
      if (!loc.name || !loc.name.trim()) {
        setError("Each service location must have a name.");
        return;
      }
      if (!loc.place_of_service_code || !loc.place_of_service_code.trim()) {
        setError("Each service location must have a place of service code.");
        return;
      }
    }
    // Ensure only one default
    const defaultCount = locations.filter((l) => l.is_default).length;
    if (defaultCount > 1) {
      setError("Only one service location can be marked as the default.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { data: beforeData } = await supabase
        .from("service_locations")
        .select(
          "id, name, location_type, place_of_service_code, npi, is_active, is_default",
        )
        .eq("organization_id", ORGANIZATION_ID);

      const upsertPayload = locations.map((loc) => ({
        id: loc.id || undefined,
        organization_id: ORGANIZATION_ID,
        name: loc.name,
        location_type: loc.location_type || null,
        place_of_service_code: loc.place_of_service_code,
        npi: loc.npi || null,
        is_active: loc.is_active,
        is_default: loc.is_default,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from("service_locations")
        .upsert(upsertPayload, { onConflict: "id" });

      if (upsertError) {
        setError(upsertError.message);
        setSaving(false);
        return;
      }

      await supabase.from("audit_logs").insert({
        organization_id: ORGANIZATION_ID,
        event_type: "settings.update",
        event_summary: "Updated service locations",
        event_metadata: { before: beforeData, after: upsertPayload },
        object_type: "service_location",
        object_id: null,
        action: "update",
      });

      setMessage("Service locations saved successfully.");
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
      <h1 className="text-2xl font-semibold text-gray-900">
        Service Locations
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        Define the service locations used on claims and superbills. Each
        location includes a type, place-of-service code and optional NPI.
        Changes here apply to future claims and do not modify past submissions.
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
        {locations.map((loc, index) => (
          <div
            key={index}
            className="rounded-md border border-gray-200 p-4 space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Location Name
              </label>
              <input
                type="text"
                value={loc.name}
                onChange={(e) => handleFieldChange(index, "name", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Location Type
              </label>
              <input
                type="text"
                value={loc.location_type}
                onChange={(e) => handleFieldChange(index, "location_type", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Place of Service Code
              </label>
              <input
                type="text"
                value={loc.place_of_service_code}
                onChange={(e) => handleFieldChange(index, "place_of_service_code", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Location NPI
              </label>
              <input
                type="text"
                value={loc.npi}
                onChange={(e) => handleFieldChange(index, "npi", e.target.value)}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={loc.is_active}
                onChange={(e) => handleFieldChange(index, "is_active", e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
              />
              <label className="ml-2 block text-sm text-gray-700">Active</label>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                checked={loc.is_default}
                onChange={(e) => handleFieldChange(index, "is_default", e.target.checked)}
                className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
              />
              <label className="ml-2 block text-sm text-gray-700">Default</label>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addLocation}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700"
          >
            Add Location
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
