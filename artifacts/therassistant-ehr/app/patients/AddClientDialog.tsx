"use client";

import { useEffect, useState } from "react";
import styles from "./clientImportDialog.module.css";
import {
  GENDER_IDENTITY_OPTIONS,
  SEX_AT_BIRTH_OPTIONS,
  US_STATE_OPTIONS,
} from "@/lib/demographics/options";

type Props = {
  open: boolean;
  organizationId: string;
  onClose: () => void;
  onCreated: (clientId?: string) => void;
  initialValues?: Partial<FormState>;
};

type CreateResponse = {
  success: boolean;
  error?: string;
  client?: { id?: string };
};

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  preferredName: "",
  dateOfBirth: "",
  phone: "",
  email: "",
  sexAtBirth: "",
  genderIdentity: "",
  mrn: "",
  sourceClientId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

type FormState = typeof EMPTY_FORM;

export default function AddClientDialog({ open, organizationId, onClose, onCreated, initialValues }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY_FORM,
      ...initialValues,
    });
    setError(null);
  }, [open, initialValues]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const canSubmit =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.dateOfBirth.trim().length > 0 &&
    !busy;

  function trimmedOrUndefined(v: string) {
    const t = v.trim();
    return t ? t : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth.trim(),
          phone: trimmedOrUndefined(form.phone),
          email: trimmedOrUndefined(form.email),
          preferredName: trimmedOrUndefined(form.preferredName),
          sexAtBirth: trimmedOrUndefined(form.sexAtBirth),
          genderIdentity: trimmedOrUndefined(form.genderIdentity),
          mrn: trimmedOrUndefined(form.mrn),
          sourceClientId: trimmedOrUndefined(form.sourceClientId),
          addressLine1: trimmedOrUndefined(form.addressLine1),
          addressLine2: trimmedOrUndefined(form.addressLine2),
          city: trimmedOrUndefined(form.city),
          state: trimmedOrUndefined(form.state),
          postalCode: trimmedOrUndefined(form.postalCode),
          emergencyContactName: trimmedOrUndefined(form.emergencyContactName),
          emergencyContactPhone: trimmedOrUndefined(form.emergencyContactPhone),
        }),
      });
      const json = (await res.json()) as CreateResponse;
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to create client");
      }
      onCreated(json.client?.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Add new client"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form className={styles.modal} onSubmit={handleSubmit} style={{ width: "min(640px, 100%)" }}>
        <header className={styles.header}>
          <h2 className={styles.title}>Add new client</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.stage} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Section title="Basics" subtitle="Required to create the client">
              <Grid>
                <Field label="First name" required>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setField("firstName", e.target.value)}
                    required
                    autoFocus
                    style={inputStyle}
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setField("lastName", e.target.value)}
                    required
                    style={inputStyle}
                  />
                </Field>
                <Field label="Preferred name">
                  <input
                    type="text"
                    value={form.preferredName}
                    onChange={(e) => setField("preferredName", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Date of birth" required>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setField("dateOfBirth", e.target.value)}
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Primary phone">
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </Grid>
            </Section>

            <Section title="Demographics" subtitle="Optional — helps with intake & eligibility">
              <Grid>
                <Field label="Sex at birth">
                  <select
                    value={form.sexAtBirth}
                    onChange={(e) => setField("sexAtBirth", e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">—</option>
                    {SEX_AT_BIRTH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Gender identity">
                  <select
                    value={form.genderIdentity}
                    onChange={(e) => setField("genderIdentity", e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">—</option>
                    {GENDER_IDENTITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="MRN">
                  <input
                    type="text"
                    value={form.mrn}
                    onChange={(e) => setField("mrn", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Source client ID">
                  <input
                    type="text"
                    value={form.sourceClientId}
                    onChange={(e) => setField("sourceClientId", e.target.value)}
                    placeholder="External system ID"
                    style={inputStyle}
                  />
                </Field>
              </Grid>
            </Section>

            <Section title="Address" subtitle="Optional">
              <Grid>
                <FullField label="Address line 1">
                  <input
                    type="text"
                    value={form.addressLine1}
                    onChange={(e) => setField("addressLine1", e.target.value)}
                    style={inputStyle}
                  />
                </FullField>
                <FullField label="Address line 2">
                  <input
                    type="text"
                    value={form.addressLine2}
                    onChange={(e) => setField("addressLine2", e.target.value)}
                    style={inputStyle}
                  />
                </FullField>
                <Field label="City">
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setField("city", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="State">
                  <select
                    value={form.state}
                    onChange={(e) => setField("state", e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">—</option>
                    {US_STATE_OPTIONS.map((s) => (
                      <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Postal code">
                  <input
                    type="text"
                    value={form.postalCode}
                    onChange={(e) => setField("postalCode", e.target.value)}
                    placeholder="12345 or 12345-6789"
                    style={inputStyle}
                  />
                </Field>
              </Grid>
            </Section>

            <Section title="Emergency contact" subtitle="Optional">
              <Grid>
                <Field label="Contact name">
                  <input
                    type="text"
                    value={form.emergencyContactName}
                    onChange={(e) => setField("emergencyContactName", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Contact phone">
                  <input
                    type="tel"
                    value={form.emergencyContactPhone}
                    onChange={(e) => setField("emergencyContactPhone", e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </Grid>
            </Section>
          </div>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={!canSubmit}
          >
            {busy ? "Saving…" : "Save client"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{title}</h3>
        {subtitle ? (
          <span style={{ fontSize: 11, color: "#64748B" }}>{subtitle}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>
        {label} {required ? <span style={{ color: "#B91C1C" }}>*</span> : null}
      </span>
      {children}
    </label>
  );
}

function FullField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "#475569", fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36,
  border: "1px solid #CBD5E1",
  borderRadius: 6,
  padding: "0 10px",
  fontSize: 13,
  color: "#0F172A",
  background: "#ffffff",
  outline: "none",
};
