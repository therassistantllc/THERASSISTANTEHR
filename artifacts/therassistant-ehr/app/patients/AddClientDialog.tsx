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

function buildInitialForm(initialValues?: Partial<FormState>): FormState {
  return {
    ...EMPTY_FORM,
    ...initialValues,
  };
}

export default function AddClientDialog({ open, organizationId, onClose, onCreated, initialValues }: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(initialValues));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm(buildInitialForm(initialValues));
    setBusy(false);
    setError(null);
  }

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
      resetForm();
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
      </form>
    </div>
  );
}
