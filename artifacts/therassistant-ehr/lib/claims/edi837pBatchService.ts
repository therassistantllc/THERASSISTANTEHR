import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export interface Generate837PBatchInput {
  organizationId: string;
  claimIds?: string[];
  mode?: "test" | "production";
  fileName?: string | null;
}

export interface Generate837PBatchResult {
  ok: boolean;
  batchId: string | null;
  fileName: string | null;
  claimCount: number;
  errors: Array<{ field: string; message: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRecord = Record<string, any>;

function nowDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function controlNumber(): string {
  return String(Date.now()).slice(-9).padStart(9, "0");
}

function sanitize(value: unknown): string {
  return String(value ?? "").replace(/[~*:\n\r]/g, " ").trim();
}

async function loadConnection(organizationId: string, mode: "test" | "production") {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data } = await supabase
    .from("clearinghouse_connections")
    .select("id, submitter_id, receiver_id, receiver_name, isa_usage_indicator")
    .eq("organization_id", organizationId)
    .eq("clearinghouse_name", "availity")
    .eq("mode", mode)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return data as DbRecord | null;
}

async function loadReadyClaims(organizationId: string, claimIds?: string[]) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  let query = supabase
    .from("professional_claims")
    .select("id, claim_number, patient_account_number, total_charge, place_of_service, diagnosis_codes")
    .eq("organization_id", organizationId)
    .eq("claim_status", "ready_for_batch")
    .order("created_at", { ascending: true })
    .limit(50);

  if (claimIds?.length) query = query.in("id", claimIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DbRecord[];
}

async function loadClaimDetail(claimId: string) {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) throw new Error("Database connection not available");

  const { data: lines, error: lineError } = await supabase
    .from("professional_claim_service_lines")
    .select("line_number, service_date_from, procedure_code, charge_amount, units, diagnosis_pointers, place_of_service")
    .eq("claim_id", claimId)
    .order("line_number", { ascending: true });
  if (lineError) throw new Error(lineError.message);

  const { data: snapshot, error: snapshotError } = await supabase
    .from("claim_parties_snapshot")
    .select("billing_provider_name, billing_provider_npi, billing_provider_tax_id, subscriber_first_name, subscriber_last_name, subscriber_member_id, payer_name, payer_id")
    .eq("claim_id", claimId)
    .maybeSingle();
  if (snapshotError) throw new Error(snapshotError.message);

  return { lines: (lines ?? []) as DbRecord[], snapshot: snapshot as DbRecord | null };
}

function validateClaim(claim: DbRecord, lines: DbRecord[], snapshot: DbRecord | null) {
  const errors: Array<{ field: string; message: string }> = [];
  if (!lines.length) errors.push({ field: "service_lines", message: `Claim ${claim.id} has no service lines` });
  if (!snapshot) errors.push({ field: "claim_parties_snapshot", message: `Claim ${claim.id} has no party snapshot` });
  if (!Array.isArray(claim.diagnosis_codes) || claim.diagnosis_codes.length === 0) {
    errors.push({ field: "diagnosis_codes", message: `Claim ${claim.id} has no diagnosis codes` });
  }
  if (snapshot && !snapshot.payer_id) errors.push({ field: "payer_id", message: `Claim ${claim.id} is missing payer ID` });
  if (snapshot && !snapshot.subscriber_member_id) {
    errors.push({ field: "subscriber_member_id", message: `Claim ${claim.id} is missing subscriber member ID` });
  }
  return errors;
}

function buildStructured837PPlaceholder(params: {
  connection: DbRecord;
  claims: Array<{ claim: DbRecord; lines: DbRecord[]; snapshot: DbRecord }>;
  isaControlNumber: string;
  gsControlNumber: string;
  stControlNumber: string;
}) {
  const segments: string[] = [];
  segments.push(`ISA*00*          *00*          *ZZ*${sanitize(params.connection.submitter_id).padEnd(15, " ")}*30*${sanitize(params.connection.receiver_id ?? "330897513").padEnd(15, " ")}*${nowDate().slice(2)}*0000*^*00501*${params.isaControlNumber}*0*${sanitize(params.connection.isa_usage_indicator ?? "T")}*:~`);
  segments.push(`GS*HC*${sanitize(params.connection.submitter_id)}*OA*${nowDate()}*0000*${params.gsControlNumber}*X*005010X222A1~`);
  segments.push(`ST*837*${params.stControlNumber}*005010X222A1~`);
  segments.push(`BHT*0019*00*${params.stControlNumber}*${nowDate()}*0000*CH~`);

  for (const entry of params.claims) {
    const claim = entry.claim;
    const snapshot = entry.snapshot;
    segments.push(`CLM*${sanitize(claim.patient_account_number ?? claim.claim_number ?? claim.id)}*${claim.total_charge}***${sanitize(claim.place_of_service ?? "10")}:B:1*Y*A*Y*Y~`);
    segments.push(`NM1*IL*1*${sanitize(snapshot.subscriber_last_name)}*${sanitize(snapshot.subscriber_first_name)}****MI*${sanitize(snapshot.subscriber_member_id)}~`);
    segments.push(`NM1*PR*2*${sanitize(snapshot.payer_name)}*****PI*${sanitize(snapshot.payer_id)}~`);
    for (const line of entry.lines) {
      segments.push(`LX*${line.line_number}~`);
      segments.push(`SV1*HC:${sanitize(line.procedure_code)}*${line.charge_amount}*UN*${line.units ?? 1}*${sanitize(line.place_of_service ?? claim.place_of_service ?? "10")}****Y~`);
      segments.push(`DTP*472*D8*${String(line.service_date_from).replaceAll("-", "")}~`);
    }
  }

  segments.push(`SE*${segments.length + 1}*${params.stControlNumber}~`);
  segments.push(`GE*1*${params.gsControlNumber}~`);
  segments.push(`IEA*1*${params.isaControlNumber}~`);
  return segments.join("\n");
}

export async function generate837PBatch(input: Generate837PBatchInput): Promise<Generate837PBatchResult> {
  // QUARANTINED 2026-05-21 (OA Companion Guide compliance audit).
  //
  // The buildStructured837PPlaceholder generator below is missing required
  // Loops/segments (1000A NM1*41/PER, 1000B NM1*40, 2000A HL/PRV, 2010AA NM1*85/
  // N3/N4/REF, 2010BA SBR, DMG, HI for diagnosis codes) and emits an SE count
  // that includes ISA/GS, which is wrong. Its test-mode filename (TA_837P_*.edi)
  // also does not set ISA15="T" (Availity Batch EDI CG: ISA15 is the test/
  // production routing switch — "P" in QA WILL forward to the payer), so
  // test submissions would route to production. Allowing it to emit X12
  // risks sending malformed and/or misrouted claims to Availity.
  //
  // Use /api/claims/837p/batch/[id]/submit (which reads pre-generated content
  // built by the spec-compliant buildAvaility837P generator) instead.
  // Reference the helpers so the unused-export lint doesn't trip while the
  // historical implementation below is preserved in git history only.
  void buildStructured837PPlaceholder;
  void input;
  void controlNumber;
  void nowDate;
  void createServerSupabaseAdminClient;
  void loadConnection;
  void loadReadyClaims;
  void loadClaimDetail;
  void validateClaim;
  void sanitize;
  return {
    ok: false,
    batchId: null,
    fileName: null,
    claimCount: 0,
    errors: [
      {
        field: "generator",
        message:
          "This 837P generator is non-compliant with the OA Companion Guide and has been disabled. Generate the batch via the spec-compliant pipeline and submit through /api/claims/837p/batch/[id]/submit.",
      },
    ],
  };
}
