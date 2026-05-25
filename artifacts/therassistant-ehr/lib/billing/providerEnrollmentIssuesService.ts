import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Client-safe types + tab metadata live in a sibling module so that client
// components can import them without pulling in this server-only file.
export {
  PROVIDER_ENROLLMENT_ISSUE_TABS,
  type ProviderEnrollmentIssueType,
  type ProviderEnrollmentIssueRow,
} from "./providerEnrollmentIssuesTypes";

import type { ProviderEnrollmentIssueType, ProviderEnrollmentIssueRow } from "./providerEnrollmentIssuesTypes";

export interface ProviderEnrollmentIssueFilters {
  practice?: string;
  clinician?: string;
  client?: string;
  payer?: string;
  dosFrom?: string;
  dosTo?: string;
  status?: string;
  priority?: string;
  minAmount?: string;
  maxAmount?: string;
  agingBucket?: string;
  assignedBiller?: string;
  carcRarc?: string;
  followUpDue?: string;
}

type DbRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}
function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
}

function isValidNpi(npi: string | null | undefined): boolean {
  if (!npi) return false;
  const v = npi.replace(/\D/g, "");
  return v.length === 10;
}

function carcRarcFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/\b(?:CO|PR|OA|CR|PI)-?\d{1,3}\b|\bCARC\s*\d{1,3}\b|\bRARC\s*[A-Z]?\d{1,4}\b/i);
  return m ? m[0].toUpperCase() : null;
}

interface ClassifyArgs {
  payerEnrollmentStatus: string | null;
  billingNpi: string | null;
  renderingNpi: string | null;
  providerProfileNpi: string | null;
  taxonomyCode: string | null;
  serviceFacilitySame: boolean;
  serviceFacilityName: string | null;
  serviceFacilityNpi: string | null;
  placeOfService: string | null;
  renderingSameAsBilling: boolean;
  billingProviderEntityType: string | null;
  notesText: string | null;
}

function classify(a: ClassifyArgs): { type: ProviderEnrollmentIssueType; label: string } | null {
  // 1. Provider not enrolled — payer enrollment for 837P is missing/not-approved.
  if (a.payerEnrollmentStatus !== "approved") {
    const display = a.payerEnrollmentStatus ?? "not_enrolled";
    return {
      type: "provider_not_enrolled",
      label: `No approved 837P enrollment (${display})`,
    };
  }
  // 2. Billing NPI Issue
  if (!isValidNpi(a.billingNpi)) {
    return {
      type: "billing_npi_issue",
      label: a.billingNpi ? "Billing NPI is invalid (must be 10 digits)" : "Billing NPI is missing",
    };
  }
  // 3. Rendering NPI Issue
  if (!a.renderingSameAsBilling) {
    if (!isValidNpi(a.renderingNpi)) {
      return {
        type: "rendering_npi_issue",
        label: a.renderingNpi
          ? "Rendering NPI on claim is invalid"
          : "Rendering NPI on claim is missing",
      };
    }
  }
  if (!isValidNpi(a.providerProfileNpi)) {
    return {
      type: "rendering_npi_issue",
      label: a.providerProfileNpi
        ? "Rendering provider profile NPI is invalid"
        : "Rendering provider profile NPI is missing",
    };
  }
  // 4. Taxonomy issue — provider profile has no taxonomy/provider_type/specialty.
  if (!a.taxonomyCode) {
    return {
      type: "taxonomy_issue",
      label: "Provider taxonomy/specialty is missing",
    };
  }
  // 5. Location Issue
  if (!a.serviceFacilitySame) {
    if (!a.serviceFacilityName || !isValidNpi(a.serviceFacilityNpi)) {
      return {
        type: "location_issue",
        label: "Service facility name or NPI is missing/invalid",
      };
    }
  }
  if (!a.placeOfService) {
    return {
      type: "location_issue",
      label: "Place of service is missing on claim",
    };
  }
  // 6. Group Linkage Issue — billing entity is an organization (type=2) but
  // rendering NPI matches billing NPI (no group→provider linkage on the claim).
  if (
    a.billingProviderEntityType === "2" &&
    isValidNpi(a.billingNpi) &&
    isValidNpi(a.renderingNpi) &&
    a.billingNpi === a.renderingNpi
  ) {
    return {
      type: "group_linkage_issue",
      label: "Group billing NPI equals rendering NPI — provider not linked to group",
    };
  }
  if (
    a.notesText &&
    /group linkage|not linked to group|loop 2010aa|loop 2310b/i.test(a.notesText)
  ) {
    return {
      type: "group_linkage_issue",
      label: "Payer flagged group/rendering linkage on this claim",
    };
  }
  return null;
}

function applyFilters(
  rows: ProviderEnrollmentIssueRow[],
  f: ProviderEnrollmentIssueFilters | undefined,
  nowMs: number,
): ProviderEnrollmentIssueRow[] {
  if (!f) return rows;
  let out = rows;
  if (f.practice) out = out.filter((r) => r.practiceId === f.practice);
  if (f.clinician) out = out.filter((r) => r.providerId === f.clinician);
  if (f.client) {
    const q = f.client.toLowerCase();
    out = out.filter((r) => r.clientName.toLowerCase().includes(q));
  }
  if (f.payer) out = out.filter((r) => r.payerName === f.payer);
  if (f.dosFrom) out = out.filter((r) => (r.dateOfService ?? "") >= f.dosFrom!);
  if (f.dosTo) out = out.filter((r) => (r.dateOfService ?? "") <= f.dosTo! + "T23:59:59");
  if (f.status) out = out.filter((r) => (r.enrollmentStatus ?? "").toLowerCase() === f.status);
  if (f.priority === "urgent") {
    out = out.filter((r) => {
      const age = daysBetween(r.dateOfService);
      return age !== null && age >= 60;
    });
  }
  if (f.minAmount) {
    const min = Number(f.minAmount);
    if (Number.isFinite(min)) out = out.filter((r) => r.chargeAmount >= min);
  }
  if (f.maxAmount) {
    const max = Number(f.maxAmount);
    if (Number.isFinite(max)) out = out.filter((r) => r.chargeAmount <= max);
  }
  if (f.agingBucket) {
    out = out.filter((r) => {
      const a = daysBetween(r.dateOfService);
      if (a == null) return f.agingBucket === "never";
      switch (f.agingBucket) {
        case "0-30": return a <= 30;
        case "31-60": return a > 30 && a <= 60;
        case "61-90": return a > 60 && a <= 90;
        case "90+": return a > 90;
        default: return true;
      }
    });
  }
  if (f.assignedBiller) {
    const q = f.assignedBiller.toLowerCase();
    out = out.filter((r) => (r.assignedBillerId ?? "").toLowerCase().includes(q));
  }
  if (f.carcRarc) {
    const q = f.carcRarc.toUpperCase();
    out = out.filter((r) => (r.denialCode ?? "").toUpperCase().includes(q));
  }
  if (f.followUpDue) {
    const cutoff = f.followUpDue + "T23:59:59";
    out = out.filter((r) => r.followUpDueAt != null && r.followUpDueAt <= cutoff);
  }
  // nowMs is reserved for future urgency rules; current rules don't need it.
  void nowMs;
  return out;
}

export interface LoadProviderEnrollmentIssuesInput {
  supabase: SupabaseClient;
  organizationId: string;
  limit?: number;
  filters?: ProviderEnrollmentIssueFilters;
}

export async function loadProviderEnrollmentIssues({
  supabase,
  organizationId,
  limit = 500,
  filters,
}: LoadProviderEnrollmentIssuesInput): Promise<ProviderEnrollmentIssueRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  // Pull non-finalized claims (anything still in the active billing pipeline).
  const { data: claims, error: claimsErr } = await sb
    .from("professional_claims")
    .select(
      "id, organization_id, patient_id, appointment_id, payer_profile_id, claim_number, claim_status, total_charge, place_of_service, billing_notes",
    )
    .eq("organization_id", organizationId)
    .in("claim_status", [
      "draft",
      "ready_for_validation",
      "validation_failed",
      "ready_for_batch",
      "batched",
      "submitted",
      "accepted_oa",
      "rejected_oa",
      "rejected_payer",
      "denied",
    ])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (claimsErr) throw new Error(claimsErr.message ?? "Failed to load claims");
  const claimRows: DbRow[] = (claims as DbRow[]) ?? [];
  if (claimRows.length === 0) return [];

  const claimIds = claimRows.map((c) => text(c.id)).filter(Boolean);
  const clientIds = [...new Set(claimRows.map((c) => text(c.patient_id)).filter(Boolean))];
  const apptIds = [...new Set(claimRows.map((c) => text(c.appointment_id)).filter(Boolean))];
  const payerProfileIds = [
    ...new Set(claimRows.map((c) => text(c.payer_profile_id)).filter(Boolean)),
  ];

  const [
    { data: parties },
    { data: clients },
    { data: appts },
    { data: payerProfiles },
    { data: enrollments },
    { data: providerProfiles },
  ] = await Promise.all([
    claimIds.length
      ? sb
          .from("claim_parties_snapshot")
          .select(
            "claim_id, billing_provider_entity_type, billing_provider_npi, billing_provider_name, billing_provider_tax_id, rendering_same_as_billing, rendering_provider_npi, rendering_provider_first_name, rendering_provider_last_name_or_org, service_facility_same_as_billing, service_facility_name, service_facility_npi, service_facility_city, service_facility_state",
          )
          .in("claim_id", claimIds)
      : { data: [] as DbRow[] },
    clientIds.length
      ? sb.from("clients").select("id, first_name, last_name").in("id", clientIds)
      : { data: [] as DbRow[] },
    apptIds.length
      ? sb
          .from("appointments")
          .select("id, provider_id, provider_location_id, scheduled_start_at")
          .in("id", apptIds)
      : { data: [] as DbRow[] },
    payerProfileIds.length
      ? sb
          .from("payer_profiles")
          .select("id, payer_name, availity_payer_id")
          .in("id", payerProfileIds)
      : { data: [] as DbRow[] },
    payerProfileIds.length
      ? sb
          .from("payer_enrollments")
          .select(
            "id, payer_profile_id, transaction_type, environment, status, oa_enrollment_reference, approved_at, expires_at, notes",
          )
          .eq("organization_id", organizationId)
          .eq("transaction_type", "837P")
          .in("payer_profile_id", payerProfileIds)
      : { data: [] as DbRow[] },
    sb
      .from("provider_profiles")
      .select(
        "id, organization_id, staff_id, provider_npi, provider_type, specialty, taxonomy_code, credentials, is_billing_provider, is_rendering_provider",
      )
      .eq("organization_id", organizationId)
      .is("archived_at", null),
  ]);

  const partiesByClaim = new Map<string, DbRow>(
    ((parties as DbRow[]) ?? []).map((p) => [text(p.claim_id), p]),
  );
  const clientById = new Map<string, DbRow>(
    ((clients as DbRow[]) ?? []).map((c) => [text(c.id), c]),
  );
  const apptById = new Map<string, DbRow>(
    ((appts as DbRow[]) ?? []).map((a) => [text(a.id), a]),
  );
  const payerById = new Map<string, DbRow>(
    ((payerProfiles as DbRow[]) ?? []).map((p) => [text(p.id), p]),
  );
  const providerById = new Map<string, DbRow>(
    ((providerProfiles as DbRow[]) ?? []).map((p) => [text(p.id), p]),
  );

  // Prefer production enrollment; otherwise fall back to most-recent sandbox.
  // Terminated rows are ignored entirely (history only).
  const enrollmentByPayer = new Map<string, DbRow>();
  for (const e of ((enrollments as DbRow[]) ?? [])) {
    if (text(e.status) === "terminated") continue;
    const key = text(e.payer_profile_id);
    if (!key) continue;
    const prior = enrollmentByPayer.get(key);
    if (!prior) {
      enrollmentByPayer.set(key, e);
      continue;
    }
    const isProd = text(e.environment) === "production";
    const priorIsProd = text(prior.environment) === "production";
    if (isProd && !priorIsProd) enrollmentByPayer.set(key, e);
  }

  // Pull routing / hold / follow-up audit history for the claims in view.
  type Assignment = { kind: "credentialing" | "biller"; display: string; userId: string | null };
  const holdMap = new Map<string, string>();
  const assignedMap = new Map<string, Assignment>();
  const assignedBillerMap = new Map<string, string>();
  const followUpMap = new Map<string, string>();
  const credentialingNoteMap = new Map<string, string>();
  if (claimIds.length) {
    const { data: auditRows } = await sb
      .from("audit_logs")
      .select("claim_id, action, event_summary, event_metadata, user_id, created_at")
      .eq("organization_id", organizationId)
      .in("claim_id", claimIds)
      .in("action", [
        "enrollment_claim_held",
        "enrollment_claim_released",
        "enrollment_routed_credentialing",
        "enrollment_assigned_biller",
        "enrollment_follow_up_set",
        "enrollment_credentialing_note",
        "enrollment_appeal_started",
        "enrollment_claim_resubmitted",
      ])
      .order("created_at", { ascending: false });
    for (const r of ((auditRows as DbRow[]) ?? [])) {
      const k = text(r.claim_id);
      if (!k) continue;
      const action = text(r.action);
      const meta = (r.event_metadata as Record<string, unknown> | null) ?? {};
      if (action === "enrollment_claim_held" && !holdMap.has(k)) {
        holdMap.set(k, text(r.event_summary));
      }
      if (action === "enrollment_claim_released" && holdMap.has(k)) {
        holdMap.delete(k);
      }
      if (action === "enrollment_routed_credentialing" && !assignedMap.has(k)) {
        assignedMap.set(k, { kind: "credentialing", display: "Credentialing", userId: null });
      }
      if (action === "enrollment_assigned_biller" && !assignedBillerMap.has(k)) {
        const billerId = text(meta.billerId) || text(r.user_id);
        if (billerId) assignedBillerMap.set(k, billerId);
      }
      if (action === "enrollment_follow_up_set" && !followUpMap.has(k)) {
        const due = text(meta.dueAt);
        if (due) followUpMap.set(k, due);
      }
      if (action === "enrollment_credentialing_note" && !credentialingNoteMap.has(k)) {
        credentialingNoteMap.set(k, text(r.event_summary));
      }
    }
  }

  const rows: ProviderEnrollmentIssueRow[] = [];
  for (const c of claimRows) {
    const claimId = text(c.id);
    const party = partiesByClaim.get(claimId);
    const appt = apptById.get(text(c.appointment_id));
    const payer = payerById.get(text(c.payer_profile_id));
    const enrollment = enrollmentByPayer.get(text(c.payer_profile_id));
    const providerId = appt ? text(appt.provider_id) || null : null;
    const provider = providerId ? providerById.get(providerId) : undefined;
    const client = clientById.get(text(c.patient_id));

    const billingNpi = party ? text(party.billing_provider_npi) || null : null;
    const renderingSameAsBilling = party ? Boolean(party.rendering_same_as_billing ?? true) : true;
    const renderingNpi = party ? text(party.rendering_provider_npi) || null : null;
    const serviceFacilitySame = party ? Boolean(party.service_facility_same_as_billing ?? true) : true;
    const serviceFacilityName = party ? text(party.service_facility_name) || null : null;
    const serviceFacilityNpi = party ? text(party.service_facility_npi) || null : null;
    const billingEntityType = party ? text(party.billing_provider_entity_type) || null : null;
    const placeOfService = text(c.place_of_service) || null;

    const providerProfileNpi = provider ? text(provider.provider_npi) || null : null;
    // Read the real NUCC taxonomy column (added 20260610). We no longer
    // fall back to specialty/provider_type — payers reject claims when
    // the taxonomy is not a valid 10-char NUCC code, so a missing
    // taxonomy_code must surface as a real taxonomy_issue instead of
    // being papered over with a free-text specialty label.
    const rawTaxonomy = provider ? text(provider.taxonomy_code) : "";
    const taxonomyCode = /^[A-Z0-9]{9}X$/i.test(rawTaxonomy) ? rawTaxonomy.toUpperCase() : null;

    const billingNotes = text(c.billing_notes) || null;
    const enrollmentStatus = enrollment ? text(enrollment.status) : "not_enrolled";

    const classification = classify({
      payerEnrollmentStatus: enrollmentStatus,
      billingNpi,
      renderingNpi,
      providerProfileNpi,
      taxonomyCode,
      serviceFacilitySame,
      serviceFacilityName,
      serviceFacilityNpi,
      placeOfService,
      renderingSameAsBilling,
      billingProviderEntityType: billingEntityType,
      notesText: billingNotes,
    });
    if (!classification) continue;

    const firstName = text(client?.first_name);
    const lastName = text(client?.last_name);
    const clientName = `${lastName}, ${firstName}`.replace(/^,\s*$/, "") || "Unknown client";

    let clinicianName = "—";
    if (party) {
      const r = `${text(party.rendering_provider_last_name_or_org)}${
        text(party.rendering_provider_first_name) ? `, ${text(party.rendering_provider_first_name)}` : ""
      }`.trim();
      if (r && r !== ",") clinicianName = r;
    }
    if (clinicianName === "—" && providerId) {
      clinicianName = `Clinician ${providerId.slice(0, 8)}`;
    }

    const assignment = assignedMap.get(claimId) ?? null;
    rows.push({
      id: claimId,
      claimId,
      claimNumber: text(c.claim_number) || null,
      claimStatus: text(c.claim_status) || null,
      organizationId,
      appointmentId: text(c.appointment_id) || null,
      clientId: text(c.patient_id) || null,
      clientName,
      payerId: payer ? text(payer.availity_payer_id) || null : null,
      payerProfileId: text(c.payer_profile_id) || null,
      payerName: payer ? text(payer.payer_name) : "(no payer)",
      providerId,
      practiceId: appt ? text(appt.provider_location_id) || null : null,
      clinicianName,
      providerNpi: providerProfileNpi,
      taxonomyCode,
      billingNpi,
      renderingNpi,
      serviceFacilitySameAsBilling: serviceFacilitySame,
      serviceFacilityName,
      serviceFacilityNpi,
      dateOfService: appt ? text(appt.scheduled_start_at) || null : null,
      chargeAmount: money(c.total_charge),
      issueType: classification.type,
      issueLabel: classification.label,
      enrollmentStatus,
      enrollmentReference: enrollment ? text(enrollment.oa_enrollment_reference) || null : null,
      enrollmentApprovedAt: enrollment ? text(enrollment.approved_at) || null : null,
      enrollmentEnvironment: enrollment ? text(enrollment.environment) || null : null,
      enrollmentExpiresAt: enrollment ? text(enrollment.expires_at) || null : null,
      enrollmentNotes: enrollment ? text(enrollment.notes) || null : null,
      holdNote: holdMap.get(claimId) ?? null,
      assignedTo: assignment ? assignment.display : null,
      assignedToKind: assignment ? assignment.kind : null,
      assignedBillerId: assignedBillerMap.get(claimId) ?? null,
      followUpDueAt: followUpMap.get(claimId) ?? null,
      denialCode: carcRarcFromNotes(billingNotes),
      credentialingNote: credentialingNoteMap.get(claimId) ?? null,
    });
  }

  return applyFilters(rows, filters, Date.now());
}
