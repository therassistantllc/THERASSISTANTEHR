"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_ORG_ID } from "@/lib/config";

type OrgFields = {
  name: string;
  legal_name: string;
  slug: string;
  default_state: string;
  timezone: string;
  tax_id_last4: string;
  is_active: boolean;
};

type BillingProfile = {
  billing_provider_name: string;
  billing_provider_npi: string;
  billing_tax_id: string;
  billing_tax_id_type: string;
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  billing_phone: string;
  default_pos_office: string;
  default_pos_telehealth: string;
  default_service_location_id: string;
};

type BillingErrors = Partial<Record<keyof BillingProfile, string>>;

const EMPTY_ORG: OrgFields = {
  name: "",
  legal_name: "",
  slug: "",
  default_state: "",
  timezone: "America/New_York",
  tax_id_last4: "",
  is_active: true,
};

const EMPTY_BILLING: BillingProfile = {
  billing_provider_name: "",
  billing_provider_npi: "",
  billing_tax_id: "",
  billing_tax_id_type: "EIN",
  billing_address_line1: "",
  billing_address_line2: "",
  billing_city: "",
  billing_state: "",
  billing_zip: "",
  billing_phone: "",
  default_pos_office: "11",
  default_pos_telehealth: "10",
  default_service_location_id: "",
};

/* ── Validation rules ── */
const DIGITS_ONLY = (v: string) => v.replace(/\D/g, "");

function validateField(field: keyof BillingProfile, value: string): string {
  const v = value.trim();
  if (!v) return ""; // empty is allowed; required enforcement is server-side

  switch (field) {
    case "billing_provider_npi": {
      const digits = DIGITS_ONLY(v);
      if (digits.length !== 10) return "NPI must be exactly 10 digits.";
      return "";
    }
    case "billing_tax_id": {
      const digits = DIGITS_ONLY(v);
      if (digits.length !== 9) return "Tax ID / EIN must be exactly 9 digits.";
      return "";
    }
    case "billing_zip": {
      if (!/^\d{5}(-\d{4})?$|^\d{9}$/.test(v)) return "ZIP must be 5 digits, 9 digits, or ZIP+4 (e.g. 80202, 802021234, or 80202-1234).";
      return "";
    }
    case "billing_phone": {
      const digits = DIGITS_ONLY(v);
      if (digits.length !== 10) return "Phone must be a 10-digit US number.";
      return "";
    }
    default:
      return "";
  }
}

function validateAll(billing: BillingProfile): BillingErrors {
  const checked: Array<keyof BillingProfile> = [
    "billing_provider_npi",
    "billing_tax_id",
    "billing_zip",
    "billing_phone",
  ];
  const errs: BillingErrors = {};
  for (const field of checked) {
    const msg = validateField(field, billing[field]);
    if (msg) errs[field] = msg;
  }
  return errs;
}

function hasErrors(errors: BillingErrors): boolean {
  return Object.values(errors).some(Boolean);
}

function getOrganizationId() {
  if (typeof window === "undefined") return DEFAULT_ORG_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("organizationId") || process.env.NEXT_PUBLIC_ORGANIZATION_ID || DEFAULT_ORG_ID;
}

export default function OrganizationSettingsClient() {
  const organizationId = useMemo(() => getOrganizationId(), []);
  const [org, setOrg] = useState<OrgFields>(EMPTY_ORG);
  const [billing, setBilling] = useState<BillingProfile>(EMPTY_BILLING);
  const [errors, setErrors] = useState<BillingErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof BillingProfile, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!organizationId) { setLoading(false); return; }
    fetch(`/api/settings/organization?organizationId=${encodeURIComponent(organizationId)}`)
      .then((r) => r.json())
      .then((json: { organization?: Partial<OrgFields>; billing_profile?: Partial<BillingProfile> }) => {
        if (json.organization) setOrg((prev) => ({ ...prev, ...json.organization }));
        if (json.billing_profile) setBilling((prev) => ({ ...prev, ...json.billing_profile }));
      })
      .catch(() => setStatusMsg("Failed to load settings."))
      .finally(() => setLoading(false));
  }, [organizationId]);

  const handleSave = useCallback(async () => {
    // Mark all validated fields as touched so errors become visible
    setTouched({
      billing_provider_npi: true,
      billing_tax_id: true,
      billing_zip: true,
      billing_phone: true,
    });

    const errs = validateAll(billing);
    setErrors(errs);
    if (hasErrors(errs)) return; // block save

    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch(
        `/api/settings/organization?organizationId=${encodeURIComponent(organizationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...org, billing_profile: billing }),
        },
      );
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Save failed");
      setStatus("saved");
      setStatusMsg("Settings saved.");
    } catch (err) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [organizationId, org, billing]);

  /* Update a billing field, re-validate it immediately if it's been touched */
  function updateBilling<K extends keyof BillingProfile>(field: K, value: string) {
    setBilling((prev) => {
      const next = { ...prev, [field]: value };
      if (touched[field]) {
        const msg = validateField(field, value);
        setErrors((e) => ({ ...e, [field]: msg }));
      }
      return next;
    });
  }

  function markTouched(field: keyof BillingProfile) {
    if (touched[field]) return;
    setTouched((t) => ({ ...t, [field]: true }));
    const msg = validateField(field, billing[field]);
    setErrors((e) => ({ ...e, [field]: msg }));
  }

  /* Org field helper */
  function tf(field: keyof OrgFields, label: string, type = "text") {
    return (
      <label className="field-label">
        {label}
        <input
          type={type}
          value={String(org[field] ?? "")}
          onChange={(e) => setOrg((prev) => ({ ...prev, [field]: e.target.value }))}
        />
      </label>
    );
  }

  /* Billing field helper — shows inline error when touched */
  function bf(field: keyof BillingProfile, label: string, type = "text") {
    const errMsg = errors[field];
    const hasErr = Boolean(errMsg);
    return (
      <label className="field-label">
        {label}
        <input
          type={type}
          value={String(billing[field] ?? "")}
          style={hasErr ? { borderColor: "var(--danger, #b02020)", boxShadow: "0 0 0 2px rgba(176,32,32,0.12)" } : undefined}
          onChange={(e) => updateBilling(field, e.target.value)}
          onBlur={() => markTouched(field)}
          aria-invalid={hasErr}
          aria-describedby={hasErr ? `err-${field}` : undefined}
        />
        {hasErr && (
          <span
            id={`err-${field}`}
            role="alert"
            style={{
              display: "block",
              marginTop: 4,
              fontSize: "var(--text-xs, 11px)",
              color: "var(--danger, #b02020)",
              fontWeight: 500,
            }}
          >
            {errMsg}
          </span>
        )}
      </label>
    );
  }

  const saveBlocked = hasErrors(validateAll(billing)) || saving || !organizationId;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Organization Settings</h1>
          <p className="hero-copy">Practice identity, billing provider details, and transmission defaults.</p>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" href="/settings">← Settings</Link>
        </div>
      </section>

      {!organizationId && (
        <div className="alert-panel">
          No organization context. Add <code>?organizationId=…</code> or set <code>NEXT_PUBLIC_ORGANIZATION_ID</code>.
        </div>
      )}

      {loading ? (
        <div className="panel"><div className="empty-state">Loading…</div></div>
      ) : (
        <>
          <section className="panel form-panel">
            <h2>Practice Identity</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              {tf("name", "Display / Practice Name")}
              {tf("legal_name", "Legal Name")}
              {tf("slug", "Slug")}
              {tf("default_state", "Default State (2-letter)")}
              {tf("timezone", "Timezone")}
              {tf("tax_id_last4", "Tax ID Last 4 Digits")}
            </div>
            <label className="checkbox-label" style={{ marginTop: "var(--space-3)" }}>
              <input
                type="checkbox"
                checked={org.is_active}
                onChange={(e) => setOrg((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              Organization is active
            </label>
          </section>

          <section className="panel form-panel">
            <h2>Billing Provider Profile</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
              These values populate claim headers. Stored in system settings under{" "}
              <code>organization.billing_profile</code>.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              {bf("billing_provider_name", "Billing Provider Name")}
              {bf("billing_provider_npi", "Billing Provider NPI (10 digits)")}
              {bf("billing_tax_id", "Tax ID / EIN (9 digits)")}
              <label className="field-label">
                Tax ID Type
                <select
                  value={billing.billing_tax_id_type}
                  onChange={(e) => setBilling((prev) => ({ ...prev, billing_tax_id_type: e.target.value }))}
                >
                  <option value="EIN">EIN</option>
                  <option value="SSN">SSN</option>
                </select>
              </label>
              {bf("billing_phone", "Billing Phone")}
              <label className="field-label">
                Default POS – Office
                <select
                  value={billing.default_pos_office}
                  onChange={(e) => setBilling((prev) => ({ ...prev, default_pos_office: e.target.value }))}
                >
                  <option value="11">11 – Office</option>
                  <option value="12">12 – Home</option>
                  <option value="49">49 – Independent Clinic</option>
                  <option value="02">02 – Telehealth</option>
                  <option value="10">10 – Telehealth (patient home)</option>
                </select>
              </label>
              <label className="field-label">
                Default POS – Telehealth
                <select
                  value={billing.default_pos_telehealth}
                  onChange={(e) => setBilling((prev) => ({ ...prev, default_pos_telehealth: e.target.value }))}
                >
                  <option value="10">10 – Telehealth (patient home)</option>
                  <option value="02">02 – Telehealth</option>
                  <option value="11">11 – Office</option>
                  <option value="12">12 – Home</option>
                  <option value="49">49 – Independent Clinic</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel form-panel">
            <h2>Billing Address</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
              {bf("billing_address_line1", "Address Line 1")}
              {bf("billing_address_line2", "Address Line 2")}
              {bf("billing_city", "City")}
              {bf("billing_state", "State (2-letter)")}
              {bf("billing_zip", "ZIP Code")}
            </div>
          </section>

          {status !== "idle" && (
            <div className={status === "saved" ? "alert-panel alert-panel-success" : "alert-panel"}>
              {statusMsg}
            </div>
          )}

          <div style={{ padding: "0 var(--space-6) var(--space-6)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <button
              className="button button-primary"
              onClick={handleSave}
              disabled={saveBlocked}
              title={hasErrors(errors) ? "Fix validation errors before saving" : undefined}
            >
              {saving ? "Saving…" : "Save Organization Settings"}
            </button>
            {hasErrors(errors) && (
              <span style={{ fontSize: "var(--text-sm, 13px)", color: "var(--danger, #b02020)", fontWeight: 500 }}>
                Fix the errors above before saving.
              </span>
            )}
          </div>
        </>
      )}
    </main>
  );
}
