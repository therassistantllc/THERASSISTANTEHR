// Shared mock data + content model for the Billing → Charges "Ready to Generate"
// claim worktable usability exploration. Mirrors the real app component
// (app/billing/ready-to-generate/ReadyToGenerateClient.tsx). All three usability
// variants import from here so they render IDENTICAL data and can be compared
// fairly. This file is prefixed with `_` so the preview plugin ignores it.

export type ReadyStatus = "ready" | "on_hold" | "needs_batch_assignment";

export interface Claim {
  id: string;
  claim_number: string | null;
  ready_status: ReadyStatus;
  client_name: string;
  service_date: string; // DOS, ISO date
  clinician_name: string;
  payer_name: string;
  payer_type: "Commercial" | "Medicaid" | "Medicare" | string;
  payer_id_value: string | null;
  cpt_codes: string[];
  diagnosis_codes: string[];
  modifiers: string[];
  charge_amount: number;
  place_of_service: string | null; // POS code, e.g. "11"
  rendering_provider_npi: string | null;
  billing_provider_name: string | null;
  billing_provider_npi: string | null;
  age_days: number;
  assigned_biller_name: string | null;
  carc_codes: string[];
  rarc_codes: string[];
  follow_up_due_at: string | null;
  hold_reason: string | null;
}

export const HIGH_DOLLAR_THRESHOLD = 1000;

// Realistic mental-health billing rows. A deliberate mix of: clean "ready"
// claims, claims missing 837P-required fields (no rendering NPI / no dx / no
// payer id), high-dollar review rows, aged rows, on-hold rows, and a
// needs-batch row — so the summary tiles, status colors, and the 837P field
// checklist all have meaningful state to show.
export const CLAIMS: Claim[] = [
  {
    id: "c1",
    claim_number: "CLM-100245",
    ready_status: "ready",
    client_name: "Reyes, Marisol",
    service_date: "2026-05-28",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "Aetna Choice POS II",
    payer_type: "Commercial",
    payer_id_value: "60054",
    cpt_codes: ["90837"],
    diagnosis_codes: ["F41.1"],
    modifiers: ["95"],
    charge_amount: 185,
    place_of_service: "10",
    rendering_provider_npi: "1928374650",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 6,
    assigned_biller_name: "A. Okafor",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: null,
    hold_reason: null,
  },
  {
    id: "c2",
    claim_number: "CLM-100246",
    ready_status: "ready",
    client_name: "Chen, David",
    service_date: "2026-05-28",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "BCBS BlueCard PPO",
    payer_type: "Commercial",
    payer_id_value: "00040",
    cpt_codes: ["90834"],
    diagnosis_codes: ["F33.1"],
    modifiers: ["95"],
    charge_amount: 150,
    place_of_service: "10",
    rendering_provider_npi: "1928374650",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 6,
    assigned_biller_name: "A. Okafor",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: null,
    hold_reason: null,
  },
  {
    id: "c3",
    claim_number: "CLM-100231",
    ready_status: "ready",
    client_name: "Okeke, Adaeze",
    service_date: "2026-05-12",
    clinician_name: "Dr. Robert Clark, PhD",
    payer_name: "Texas Medicaid",
    payer_type: "Medicaid",
    payer_id_value: "MCDTX",
    cpt_codes: ["90791"],
    diagnosis_codes: [], // MISSING diagnosis → checklist ✗
    modifiers: ["HJ"],
    charge_amount: 220,
    place_of_service: "11",
    rendering_provider_npi: "1548293041",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 22, // aged > 14 → urgent
    assigned_biller_name: null,
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: "2026-06-12",
    hold_reason: null,
  },
  {
    id: "c4",
    claim_number: "CLM-100258",
    ready_status: "ready",
    client_name: "Johnson, Emily",
    service_date: "2026-05-30",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "Cigna Open Access Plus",
    payer_type: "Commercial",
    payer_id_value: "62308",
    cpt_codes: ["90847"],
    diagnosis_codes: ["F43.10", "Z63.0"],
    modifiers: [],
    charge_amount: 210,
    place_of_service: "10",
    rendering_provider_npi: null, // MISSING rendering NPI → checklist ✗
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 4,
    assigned_biller_name: "A. Okafor",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: null,
    hold_reason: null,
  },
  {
    id: "c5",
    claim_number: "CLM-100190",
    ready_status: "ready",
    client_name: "Williams, Michael",
    service_date: "2026-04-29",
    clinician_name: "Dr. Robert Clark, PhD",
    payer_name: "Medicare Part B",
    payer_type: "Medicare",
    payer_id_value: "MCRB1",
    cpt_codes: ["90853"],
    diagnosis_codes: ["F90.2"],
    modifiers: [],
    charge_amount: 1280, // high dollar → review
    place_of_service: "11",
    rendering_provider_npi: "1548293041",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 41, // aged → urgent
    assigned_biller_name: "M. Patel",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: "2026-06-09",
    hold_reason: null,
  },
  {
    id: "c6",
    claim_number: "CLM-100262",
    ready_status: "ready",
    client_name: "Nguyen, Brian",
    service_date: "2026-05-31",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "UnitedHealthcare Choice Plus",
    payer_type: "Commercial",
    payer_id_value: "87726",
    cpt_codes: ["90837"],
    diagnosis_codes: ["F41.1"],
    modifiers: ["95"],
    charge_amount: 185,
    place_of_service: "10",
    rendering_provider_npi: "1928374650",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 3,
    assigned_biller_name: "M. Patel",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: null,
    hold_reason: null,
  },
  {
    id: "c7",
    claim_number: "CLM-100201",
    ready_status: "needs_batch_assignment",
    client_name: "Garcia, Sofia",
    service_date: "2026-05-08",
    clinician_name: "Dr. Robert Clark, PhD",
    payer_name: "Florida Medicaid",
    payer_type: "Medicaid",
    payer_id_value: null, // MISSING payer id → checklist ✗
    cpt_codes: ["90834"],
    diagnosis_codes: ["F33.0"],
    modifiers: ["HJ"],
    charge_amount: 150,
    place_of_service: "11",
    rendering_provider_npi: "1548293041",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 26,
    assigned_biller_name: null,
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: "2026-06-10",
    hold_reason: null,
  },
  {
    id: "c8",
    claim_number: "CLM-100177",
    ready_status: "on_hold",
    client_name: "Brown, Jessica",
    service_date: "2026-04-21",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "BCBS BlueCard PPO",
    payer_type: "Commercial",
    payer_id_value: "00040",
    cpt_codes: ["90837"],
    diagnosis_codes: ["F43.23"],
    modifiers: ["95"],
    charge_amount: 185,
    place_of_service: "10",
    rendering_provider_npi: "1928374650",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 49,
    assigned_biller_name: "A. Okafor",
    carc_codes: ["16"],
    rarc_codes: ["N290"],
    follow_up_due_at: "2026-06-09",
    hold_reason: "Awaiting credentialing confirmation with payer",
  },
  {
    id: "c9",
    claim_number: "CLM-100268",
    ready_status: "ready",
    client_name: "Patel, Anjali",
    service_date: "2026-06-01",
    clinician_name: "Dr. Robert Clark, PhD",
    payer_name: "Aetna Choice POS II",
    payer_type: "Commercial",
    payer_id_value: "60054",
    cpt_codes: ["90791"],
    diagnosis_codes: ["F41.0"],
    modifiers: [],
    charge_amount: 220,
    place_of_service: "11",
    rendering_provider_npi: "1548293041",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 2,
    assigned_biller_name: "M. Patel",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: null,
    hold_reason: null,
  },
  {
    id: "c10",
    claim_number: "CLM-100150",
    ready_status: "ready",
    client_name: "Thompson, Derek",
    service_date: "2026-04-15",
    clinician_name: "Dr. Sarah Jenkins, LCSW",
    payer_name: "Medicare Part B",
    payer_type: "Medicare",
    payer_id_value: "MCRB1",
    cpt_codes: ["90837", "90785"],
    diagnosis_codes: ["F31.81"],
    modifiers: [],
    charge_amount: 1450, // high dollar
    place_of_service: "11",
    rendering_provider_npi: "1548293041",
    billing_provider_name: "Conscious Counseling PLLC",
    billing_provider_npi: "1083920145",
    age_days: 55, // very aged → urgent
    assigned_biller_name: "M. Patel",
    carc_codes: [],
    rarc_codes: [],
    follow_up_due_at: "2026-06-09",
    hold_reason: null,
  },
];

export const TABS = [
  { id: "ready", label: "Ready" },
  { id: "needs_batch_assignment", label: "Needs Batch Assignment" },
  { id: "high_dollar_review", label: "High Dollar Review" },
  { id: "medicaid_claims", label: "Medicaid Claims" },
  { id: "commercial_claims", label: "Commercial Claims" },
] as const;

// The 22-field universal filter rail from the real component.
export const FILTERS: Array<{ id: string; label: string; kind: "text" | "select" | "date" | "number"; placeholder?: string; options?: string[] }> = [
  { id: "practice", label: "Practice", kind: "select", options: ["All practices", "Conscious Counseling PLLC"] },
  { id: "client", label: "Client", kind: "text", placeholder: "Client or claim #" },
  { id: "clinician", label: "Clinician", kind: "select", options: ["All clinicians", "Dr. Sarah Jenkins, LCSW", "Dr. Robert Clark, PhD"] },
  { id: "payer", label: "Payer", kind: "select", options: ["All payers", "Aetna Choice POS II", "BCBS BlueCard PPO", "Cigna Open Access Plus", "Medicare Part B", "Texas Medicaid"] },
  { id: "assignedBiller", label: "Assigned biller", kind: "select", options: ["Anyone", "A. Okafor", "M. Patel", "Unassigned"] },
  { id: "carcRarc", label: "CARC/RARC", kind: "text", placeholder: "Code" },
  { id: "followUpDueFrom", label: "Follow-up from", kind: "date" },
  { id: "followUpDueTo", label: "Follow-up to", kind: "date" },
  { id: "dosFrom", label: "DOS from", kind: "date" },
  { id: "dosTo", label: "DOS to", kind: "date" },
  { id: "status", label: "Status", kind: "select", options: ["Any status", "Ready", "On Hold", "Needs Batch"] },
  { id: "minAmount", label: "Min $", kind: "number", placeholder: "0" },
  { id: "maxAmount", label: "Max $", kind: "number", placeholder: "0" },
  { id: "agingBucket", label: "Aging", kind: "select", options: ["Any age", "0–7 days", "8–14 days", "15–30 days", "30+ days"] },
  { id: "priority", label: "Priority", kind: "select", options: ["Any", "High Dollar", "Aged > 14d"] },
  { id: "cpt", label: "CPT/HCPCS", kind: "text", placeholder: "e.g. 90834" },
  { id: "dx", label: "Diagnosis", kind: "text", placeholder: "e.g. F33.1" },
  { id: "modifier", label: "Modifier", kind: "text", placeholder: "e.g. 95" },
  { id: "pos", label: "POS", kind: "text", placeholder: "e.g. 11" },
  { id: "billingProvider", label: "Billing provider", kind: "text", placeholder: "Name or NPI" },
  { id: "renderingProvider", label: "Rendering NPI", kind: "text", placeholder: "NPI" },
];

// Table columns from the real component.
export const COLUMNS = [
  { id: "client", header: "Client", align: "left" },
  { id: "dos", header: "DOS", align: "left" },
  { id: "clinician", header: "Clinician", align: "left" },
  { id: "payer", header: "Payer", align: "left" },
  { id: "cpt", header: "CPT/HCPCS", align: "left" },
  { id: "dx", header: "Diagnosis", align: "left" },
  { id: "modifiers", header: "Modifiers", align: "left" },
  { id: "charge", header: "Charge amount", align: "right" },
  { id: "pos", header: "Place of service", align: "left" },
  { id: "rendering", header: "Rendering provider", align: "left" },
  { id: "billing", header: "Billing provider", align: "left" },
  { id: "ready", header: "Ready status", align: "left" },
] as const;

// Detail-panel tabs from the real component.
export const DETAIL_TABS = [
  { id: "preview", label: "Claim preview" },
  { id: "checklist", label: "837P field checklist" },
  { id: "validation", label: "Provider/payer validation" },
  { id: "dx", label: "Diagnosis pointers" },
] as const;

export function money(value: number): string {
  return Number(value ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export function readyStatusLabel(s: ReadyStatus): string {
  return s === "ready" ? "Ready" : s === "on_hold" ? "On Hold" : "Needs Batch";
}

// The 8 required 837P fields the real component validates per claim.
export function checklistFor(c: Claim): Array<{ id: string; ok: boolean; label: string }> {
  return [
    { id: "ref", ok: !!c.claim_number, label: "CLM01 — Client account / claim ref" },
    { id: "amt", ok: c.charge_amount > 0, label: "CLM02 — Total charge > 0" },
    { id: "pos", ok: !!c.place_of_service, label: "CLM05 — Place of service" },
    { id: "dx", ok: c.diagnosis_codes.length > 0, label: "HI — At least one ICD-10 diagnosis" },
    { id: "lines", ok: c.cpt_codes.length > 0, label: "LX/SV1 — At least one service line w/ procedure code" },
    { id: "billing", ok: !!c.billing_provider_npi, label: "2010AA NM1*85 — Billing provider NPI" },
    { id: "rendering", ok: !!c.rendering_provider_npi, label: "2310B NM1*82 — Rendering provider NPI" },
    { id: "payer", ok: !!c.payer_id_value, label: "2010BB NM1*PR — Payer ID" },
  ];
}

export function isClaimComplete(c: Claim): boolean {
  return checklistFor(c).every((x) => x.ok);
}

// Summary tiles (computed over the visible "ready" rows, like the real component).
export function summaryFor(rows: Claim[], selectedIds: string[] = []) {
  const dollars = rows.reduce((s, r) => s + (r.charge_amount || 0), 0);
  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + (r.charge_amount || 0), 0);
  const oldest = rows.length ? Math.max(...rows.map((r) => r.age_days ?? 0)) : 0;
  const urgent = rows.filter((r) => (r.age_days ?? 0) > 14 || r.charge_amount >= HIGH_DOLLAR_THRESHOLD).length;
  return [
    { id: "count", label: "Claims", value: rows.length.toLocaleString(), tone: "default" as const },
    { id: "dollars", label: "Total $", value: money(dollars), tone: "default" as const },
    { id: "selected", label: "Selected", value: selectedIds.length.toLocaleString(), tone: (selectedIds.length ? "green" : "default") as const },
    { id: "selectedDollars", label: "Selected $", value: money(selectedTotal), tone: (selectedIds.length ? "green" : "default") as const },
    { id: "oldest", label: "Oldest (days)", value: String(oldest), tone: (oldest > 14 ? "red" : oldest > 7 ? "amber" : "default") as const },
    { id: "urgent", label: "Urgent", value: String(urgent), tone: (urgent > 0 ? "amber" : "default") as const },
  ];
}
