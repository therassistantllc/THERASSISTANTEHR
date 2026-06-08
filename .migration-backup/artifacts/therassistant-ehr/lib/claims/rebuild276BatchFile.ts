import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanX12(v: unknown, max = 80): string {
  const out = text(v).replace(/[*~:\n\r]/g, " ").replace(/\s+/g, " ").trim();
  return max > 0 ? out.slice(0, max) : out;
}

function onlyDigits(v: unknown): string {
  return text(v).replace(/\D/g, "");
}

function yymmdd(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "0000";
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function yyyymmdd(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function yyyymmddOrEmpty(value?: string | null): string {
  const raw = text(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function seg(name: string, ...parts: Array<string | number | null | undefined>): string {
  return [name, ...parts.map((p) => String(p ?? ""))].join("*") + "~";
}

function fileSafe(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "unknown";
}

function makeControlNumber(seed: string): string {
  const digits = onlyDigits(seed) || String(Date.now());
  return digits.slice(-9).padStart(9, "0");
}

function normalizedSex(v: unknown): string | null {
  const s = text(v).toUpperCase();
  if (s.startsWith("M")) return "M";
  if (s.startsWith("F")) return "F";
  if (s.startsWith("U")) return "U";
  return null;
}

function claimTrace(batchNumber: string, claimId: string): string {
  return cleanX12(`${batchNumber}-${claimId}`.slice(0, 50), 50);
}

export interface Claim276ValidationError {
  claimId: string;
  claimNumber: string;
  reasons: string[];
}

export interface Rebuild276BatchResult {
  ok: boolean;
  batchId: string;
  fileName?: string;
  claimCount?: number;
  excludedClaims?: Claim276ValidationError[];
  error?: string;
}

interface ClaimData {
  id: string;
  claimNumber: string;
  patientAccountNumber: string;
  claimStatus: string;
  totalCharge: number;
  serviceDate: string | null;
  payerClaimControlNumber: string | null;
  parties: Row | null;
}

const ELIGIBLE_CLAIM_STATUSES = new Set([
  "batched",
  "submitted",
  "accepted_oa",
  "accepted_payer",
  "adjudicated",
  "partial",
  "denied",
]);

function buildClaimData(rows: Row[], partiesByClaim: Map<string, Row>, encounterById: Map<string, Row>): ClaimData[] {
  return rows.map((row) => {
    const claimId = text(row.id);
    const encounter = encounterById.get(text(row.encounter_id));
    return {
      id: claimId,
      claimNumber: text(row.claim_number) || claimId.slice(0, 8),
      patientAccountNumber: text(row.patient_account_number) || text(row.claim_number) || claimId.slice(0, 20),
      claimStatus: text(row.claim_status).toLowerCase(),
      totalCharge: Number(row.total_charge ?? 0) || 0,
      serviceDate: text(encounter?.service_date) || null,
      payerClaimControlNumber: text(row.original_payer_claim_control_number) || null,
      parties: partiesByClaim.get(claimId) ?? null,
    };
  });
}

function validateClaim(c: ClaimData): string[] {
  const reasons: string[] = [];
  if (!ELIGIBLE_CLAIM_STATUSES.has(c.claimStatus)) {
    reasons.push(`Claim status ${c.claimStatus || "unknown"} is not eligible for 276 batching`);
  }
  if (!c.parties) {
    reasons.push("Claim is missing party snapshot");
    return reasons;
  }
  const p = c.parties;
  if (!text(p.payer_id)) reasons.push("Missing payer ID");
  if (!text(p.billing_provider_npi) || onlyDigits(p.billing_provider_npi).length !== 10) {
    reasons.push("Missing or invalid billing provider NPI");
  }
  if (!text(p.billing_provider_tax_id) || onlyDigits(p.billing_provider_tax_id).length < 9) {
    reasons.push("Missing or invalid billing provider tax ID");
  }
  if (!text(p.subscriber_last_name)) reasons.push("Missing subscriber last name");
  if (!text(p.subscriber_first_name)) reasons.push("Missing subscriber first name");
  if (!text(p.subscriber_member_id)) reasons.push("Missing subscriber member ID");
  if (!c.serviceDate) reasons.push("Missing service date");
  if (!(Number(c.totalCharge) > 0)) reasons.push("Missing claim charge amount");
  if (!text(c.patientAccountNumber)) reasons.push("Missing patient account number / claim control number");
  return reasons;
}

function build276Payload(args: {
  batchId: string;
  batchNumber: string;
  orgName: string;
  senderId: string;
  receiverId: string;
  claims: ClaimData[];
}): { content: string; fileName: string } {
  const now = new Date();
  const control = makeControlNumber(`${args.batchNumber}-${args.batchId}-${now.toISOString()}`);
  const stControl = control.slice(-4).padStart(4, "0");

  const sender = cleanX12(args.senderId, 15).padEnd(15, " ");
  const receiver = cleanX12(args.receiverId, 15).padEnd(15, " ");

  const segments: string[] = [];
  const isa = [
    "ISA", "00", "          ", "00", "          ", "ZZ", sender,
    "ZZ", receiver, yymmdd(now.toISOString()), hhmm(now.toISOString()), "^", "00501", control, "0", "P", ":",
  ].join("*") + "~";
  segments.push(isa);
  segments.push(seg("GS", "HR", cleanX12(args.senderId, 15), cleanX12(args.receiverId, 15), yyyymmdd(now.toISOString()), hhmm(now.toISOString()), String(Number(control)), "X", "005010X212"));
  segments.push(seg("ST", "276", stControl, "005010X212"));
  segments.push(seg("BHT", "0010", "13", cleanX12(args.batchNumber, 30), yyyymmdd(now.toISOString()), hhmm(now.toISOString())));

  const first = args.claims[0];
  const firstParties = first.parties ?? {};

  segments.push(seg("HL", "1", "", "20", "1"));
  segments.push(seg("NM1", "PR", "2", cleanX12(firstParties.payer_name || "PAYER", 60), "", "", "", "", "PI", cleanX12(firstParties.payer_id, 80)));

  segments.push(seg("HL", "2", "1", "21", "1"));
  segments.push(seg("NM1", "1P", "2", cleanX12(args.orgName, 60), "", "", "", "", "XX", cleanX12(firstParties.billing_provider_npi, 10)));
  segments.push(seg("REF", "EI", onlyDigits(firstParties.billing_provider_tax_id).slice(0, 15)));

  segments.push(seg("HL", "3", "2", "19", "1"));
  segments.push(seg("NM1", "1P", "2", cleanX12(firstParties.billing_provider_name || args.orgName, 60), "", "", "", "", "XX", cleanX12(firstParties.billing_provider_npi, 10)));
  segments.push(seg("REF", "EI", onlyDigits(firstParties.billing_provider_tax_id).slice(0, 15)));

  let hlCounter = 4;
  for (const claim of args.claims) {
    const p = claim.parties ?? {};
    const isPatientSubscriber = Boolean(p.patient_is_subscriber);
    const subscriberTrace = claimTrace(args.batchNumber, claim.id);

    segments.push(seg("HL", String(hlCounter), "3", "22", isPatientSubscriber ? "0" : "1"));
    segments.push(seg("TRN", "1", subscriberTrace, cleanX12(args.senderId, 30)));
    segments.push(seg("NM1", "IL", "1", cleanX12(p.subscriber_last_name, 60), cleanX12(p.subscriber_first_name, 35), "", "", "", "MI", cleanX12(p.subscriber_member_id, 80)));

    const subSex = normalizedSex(p.subscriber_gender);
    const subscriberDob = yyyymmddOrEmpty(text(p.subscriber_dob));
    if (subscriberDob || subSex) {
      segments.push(seg("DMG", "D8", subscriberDob, subSex ?? "U"));
    }

    segments.push(seg("TRN", "1", subscriberTrace, cleanX12(args.batchNumber, 30)));
    if (claim.payerClaimControlNumber) segments.push(seg("REF", "1K", cleanX12(claim.payerClaimControlNumber, 50)));
    segments.push(seg("REF", "EJ", cleanX12(claim.patientAccountNumber, 50)));
    segments.push(seg("DTP", "472", "D8", yyyymmdd(claim.serviceDate)));
    segments.push(seg("AMT", "T3", claim.totalCharge.toFixed(2)));

    if (!isPatientSubscriber) {
      hlCounter += 1;
      const patientTrace = `${subscriberTrace}P`;
      segments.push(seg("HL", String(hlCounter), String(hlCounter - 1), "23", "0"));
      segments.push(seg("NM1", "QC", "1", cleanX12(p.patient_last_name, 60), cleanX12(p.patient_first_name, 35), "", "", "", "MI", cleanX12(claim.patientAccountNumber, 50)));
      const patSex = normalizedSex(p.patient_gender);
      const patientDob = yyyymmddOrEmpty(text(p.patient_dob));
      if (patientDob || patSex) {
        segments.push(seg("DMG", "D8", patientDob, patSex ?? "U"));
      }
      segments.push(seg("TRN", "1", patientTrace, cleanX12(args.batchNumber, 30)));
      if (claim.payerClaimControlNumber) segments.push(seg("REF", "1K", cleanX12(claim.payerClaimControlNumber, 50)));
      segments.push(seg("REF", "EJ", cleanX12(claim.patientAccountNumber, 50)));
      segments.push(seg("DTP", "472", "D8", yyyymmdd(claim.serviceDate)));
      segments.push(seg("AMT", "T3", claim.totalCharge.toFixed(2)));
    }
    hlCounter += 1;
  }

  const seCount = segments.length - 2 + 1;
  segments.push(seg("SE", String(seCount), stControl));
  segments.push(seg("GE", "1", String(Number(control))));
  segments.push(seg("IEA", "1", control));

  const payer = cleanX12(firstParties.payer_id || "payer", 40);
  const fileName = `276_${fileSafe(args.orgName)}_${fileSafe(payer)}_${yyyymmdd(now.toISOString())}_${fileSafe(args.batchNumber)}.edi`;
  return { content: segments.join(""), fileName };
}

export async function rebuild276BatchFile(args: { batchId: string; organizationId: string }): Promise<Rebuild276BatchResult> {
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return { ok: false, batchId: args.batchId, error: "Database connection not available" };

  const sb = supabase as any;

  const { data: batchRow, error: batchErr } = await sb
    .from("claim_276_batches")
    .select("id, batch_number, organization_id")
    .eq("id", args.batchId)
    .eq("organization_id", args.organizationId)
    .is("archived_at", null)
    .maybeSingle();
  if (batchErr) return { ok: false, batchId: args.batchId, error: batchErr.message };
  if (!batchRow) return { ok: false, batchId: args.batchId, error: "Batch not found" };

  const { data: links, error: linkErr } = await sb
    .from("claim_276_batch_claims")
    .select("professional_claim_id")
    .eq("organization_id", args.organizationId)
    .eq("batch_id", args.batchId)
    .is("archived_at", null);
  if (linkErr) return { ok: false, batchId: args.batchId, error: linkErr.message };

  const claimIds = ((links ?? []) as Row[]).map((r) => text(r.professional_claim_id)).filter(Boolean);
  if (claimIds.length === 0) {
    return { ok: false, batchId: args.batchId, error: "Batch has no linked claims" };
  }

  const { data: claimRows, error: claimErr } = await sb
    .from("professional_claims")
    .select("id, claim_number, claim_status, total_charge, patient_account_number, encounter_id, original_payer_claim_control_number")
    .eq("organization_id", args.organizationId)
    .in("id", claimIds)
    .is("archived_at", null);
  if (claimErr) return { ok: false, batchId: args.batchId, error: claimErr.message };

  const encounterIds = [...new Set(((claimRows ?? []) as Row[]).map((r) => text(r.encounter_id)).filter(Boolean))];

  const [{ data: encounterRows, error: encounterErr }, { data: partyRows, error: partyErr }] = await Promise.all([
    encounterIds.length
      ? sb
          .from("encounters")
          .select("id, service_date")
          .eq("organization_id", args.organizationId)
          .in("id", encounterIds)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("claim_parties_snapshot")
      .select("*")
      .in("claim_id", claimIds),
  ]);

  if (encounterErr) return { ok: false, batchId: args.batchId, error: encounterErr.message };
  if (partyErr) return { ok: false, batchId: args.batchId, error: partyErr.message };

  const encounterById = new Map<string, Row>(((encounterRows ?? []) as Row[]).map((r) => [text(r.id), r]));
  const partiesByClaim = new Map<string, Row>(((partyRows ?? []) as Row[]).map((r) => [text(r.claim_id), r]));

  const claims = buildClaimData((claimRows ?? []) as Row[], partiesByClaim, encounterById);

  const excludedClaims: Claim276ValidationError[] = [];
  const validClaims: ClaimData[] = [];
  for (const c of claims) {
    const reasons = validateClaim(c);
    if (reasons.length > 0) {
      excludedClaims.push({ claimId: c.id, claimNumber: c.claimNumber, reasons });
    } else {
      validClaims.push(c);
    }
  }

  if (validClaims.length === 0) {
    const msg = "No eligible claims available to generate 276 file";
    await sb
      .from("claim_276_batches")
      .update({ batch_status: "failed", last_generation_error: msg, updated_at: new Date().toISOString() })
      .eq("id", args.batchId)
      .eq("organization_id", args.organizationId);
    return { ok: false, batchId: args.batchId, error: msg, excludedClaims };
  }

  const { data: connRow, error: connErr } = await sb
    .from("clearinghouse_connections")
    .select("id, submitter_id, receiver_id, gs_receiver_code")
    .eq("organization_id", args.organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connErr) return { ok: false, batchId: args.batchId, error: connErr.message };

  const { data: orgRow } = await sb.from("organizations").select("name").eq("id", args.organizationId).maybeSingle();
  const orgName = text((orgRow as Row | null)?.name) || "practice";

  const senderId = text((connRow as Row | null)?.submitter_id) || process.env.AVAILITY_REALTIME_SENDER_ID || "THERASSISTANT";
  const receiverId = text((connRow as Row | null)?.receiver_id) || text((connRow as Row | null)?.gs_receiver_code) || process.env.AVAILITY_REALTIME_RECEIVER_ID || "030240928";

  const payload = build276Payload({
    batchId: args.batchId,
    batchNumber: text(batchRow.batch_number) || args.batchId.slice(0, 8),
    orgName,
    senderId,
    receiverId,
    claims: validClaims,
  });

  for (const claim of validClaims) {
    await sb
      .from("claim_276_batch_claims")
      .update({
        trace_number: claimTrace(text(batchRow.batch_number) || args.batchId.slice(0, 8), claim.id),
        payer_claim_control_number: claim.payerClaimControlNumber,
        patient_account_number: claim.patientAccountNumber,
        service_date: claim.serviceDate,
        claim_amount: claim.totalCharge,
      })
      .eq("organization_id", args.organizationId)
      .eq("batch_id", args.batchId)
      .eq("professional_claim_id", claim.id);
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("claim_276_batches")
    .update({
      batch_status: "generated",
      claim_count: validClaims.length,
      generated_file_content: payload.content,
      generated_file_name: payload.fileName,
      generated_at: now,
      last_generation_error: null,
      updated_at: now,
    })
    .eq("id", args.batchId)
    .eq("organization_id", args.organizationId);
  if (updateErr) return { ok: false, batchId: args.batchId, error: updateErr.message };

  return {
    ok: true,
    batchId: args.batchId,
    claimCount: validClaims.length,
    fileName: payload.fileName,
    excludedClaims,
  };
}
