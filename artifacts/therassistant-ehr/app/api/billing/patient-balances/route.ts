/**
 * GET /api/billing/patient-balances
 * Returns professional_claims with patient_responsibility_amount > 0,
 * joined with client, payer, and appointment/provider data.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

function str(v: unknown): string {
  return String(v ?? "").trim();
}
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isRecoverableQueryError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  // PostgREST missing relation/function/schema-cache drift.
  return typeof code === "string" && (code === "PGRST200" || code === "PGRST202");
}

function isMissingColumn(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = str((error as { code?: unknown }).code);
  const message = str((error as { message?: unknown }).message).toLowerCase();
  return code === "42703" && message.includes(columnName.toLowerCase());
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object") return "Failed";
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const code = str(e.code);
  const message = str(e.message);
  const details = str(e.details);
  const hint = str(e.hint);
  return [code, message, details, hint].filter(Boolean).join(" | ") || "Failed";
}

function toIsoDateOrNull(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

async function queryClaims(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  organizationId: string;
  selectClause: string;
  includeWriteOffFilter: boolean;
}) {
  const { supabase, organizationId, selectClause, includeWriteOffFilter } = params;
  let query = supabase
    .from("professional_claims")
    .select(selectClause)
    .eq("organization_id", organizationId)
    .gt("patient_responsibility_amount", 0)
    .is("archived_at", null)
    .not("claim_status", "in", '("draft","archived")')
    .order("created_at", { ascending: false });

  if (includeWriteOffFilter) {
    query = query.is("write_off_at", null);
  }

  return query;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const { organizationId } = guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase)
      return NextResponse.json({ success: false, error: "Database not available" }, { status: 500 });

    const richSelect = `id, claim_number, claim_status, total_charge, patient_responsibility_amount,
         payer_responsibility_amount, denial_reason_code, first_billed_date, billing_notes,
         diagnosis_codes, place_of_service, prior_authorization_number, client_id,
         payer_profile_id, appointment_id, created_at, updated_at,
         clients(id, first_name, last_name, email, phone,
                 stripe_payment_method_id, stripe_customer_id,
                 stripe_payment_method_brand, stripe_payment_method_last4,
                 stripe_payment_method_exp_month, stripe_payment_method_exp_year,
                 autopay_enabled),
         payer_profiles!professional_claims_payer_profile_id_fkey(payer_name),
         appointments(id, scheduled_start_at, provider_id)`;

    let { data, error } = await queryClaims({
      supabase,
      organizationId,
      selectClause: richSelect,
      includeWriteOffFilter: true,
    });
    if (error && isMissingColumn(error, "write_off_at")) {
      ({ data, error } = await queryClaims({
        supabase,
        organizationId,
        selectClause: richSelect,
        includeWriteOffFilter: false,
      }));
    }

    let claimRows = data;
    if (error) {
      if (!isRecoverableQueryError(error)) throw error;

      console.warn("patient-balances rich query unavailable; using fallback query path");
      let fallback = await queryClaims({
        supabase,
        organizationId,
        selectClause:
          "id, claim_number, claim_status, total_charge, patient_responsibility_amount, payer_responsibility_amount, billing_notes, diagnosis_codes, client_id, payer_profile_id, first_billed_date, created_at",
        includeWriteOffFilter: true,
      });
      if (fallback.error && isMissingColumn(fallback.error, "write_off_at")) {
        fallback = await queryClaims({
          supabase,
          organizationId,
          selectClause:
            "id, claim_number, claim_status, total_charge, patient_responsibility_amount, payer_responsibility_amount, billing_notes, diagnosis_codes, client_id, payer_profile_id, first_billed_date, created_at",
          includeWriteOffFilter: false,
        });
      }
      if (fallback.error) throw fallback.error;
      claimRows = (fallback.data ?? []).map((r: any) => ({
        ...r,
        clients: null,
        payer_profiles: null,
        appointments: null,
      }));
    }

    const appointmentProviderIds = Array.from(
      new Set(
        (claimRows ?? [])
          .map((r) => {
            const appt = r.appointments as Record<string, unknown> | null;
            return str(appt?.provider_id);
          })
          .filter(Boolean),
      ),
    );

    const providerById = new Map<string, Record<string, unknown>>();
    if (appointmentProviderIds.length > 0) {
      const { data: providerRows, error: providerError } = await supabase
        .from("providers")
        .select("id, first_name, last_name, display_name, npi")
        .eq("organization_id", organizationId)
        .in("id", appointmentProviderIds)
        .is("archived_at", null);
      if (!providerError) {
        for (const row of providerRows ?? []) {
          providerById.set(str((row as Record<string, unknown>).id), row as Record<string, unknown>);
        }
      }
    }

    const rows = (claimRows ?? []).map((r) => {

      const client = r.clients as unknown as Record<string, unknown> | null;
      const payer = r.payer_profiles as unknown as Record<string, unknown> | null;
      const appt = r.appointments as unknown as Record<string, unknown> | null;
      const provider = providerById.get(str(appt?.provider_id)) ?? null;

      const hasCard = Boolean(client?.stripe_payment_method_id);
      const cardBrand = str(client?.stripe_payment_method_brand) || null;
      const cardLast4 = str(client?.stripe_payment_method_last4) || null;
      const autopay = Boolean(client?.autopay_enabled);
      const providerName =
        str(provider?.display_name) ||
        [str(provider?.first_name), str(provider?.last_name)].filter(Boolean).join(" ") ||
        null;

      return {
        id: str(r.id),
        claimId: str(r.id),
        claimNumber: str(r.claim_number),
        claimStatus: str(r.claim_status),
        clientId: str(client?.id ?? r.client_id),
        clientName: client
          ? [str(client.first_name), str(client.last_name)].filter(Boolean).join(" ")
          : "—",
        clientEmail: str(client?.email) || null,
        clientPhone: str(client?.phone) || null,
        payerName: str(payer?.payer_name) || "—",
        providerName,
        providerId: str(provider?.id) || null,
        dateOfService: appt?.scheduled_start_at
          ? toIsoDateOrNull(appt.scheduled_start_at)
          : toIsoDateOrNull(r.first_billed_date),
        totalCharge: num(r.total_charge),
        patientResponsibility: num(r.patient_responsibility_amount),
        payerPaid: num(r.payer_responsibility_amount),
        amountPaid: 0, // placeholder — client payments not yet tracked separately
        adjustmentAmount: num(r.total_charge) - num(r.patient_responsibility_amount) - num(r.payer_responsibility_amount),
        diagnosisCodes: Array.isArray(r.diagnosis_codes) ? (r.diagnosis_codes as string[]) : [],
        placeOfService: str(r.place_of_service),
        priorAuthNumber: str(r.prior_authorization_number) || null,
        billingNotes: str(r.billing_notes) || null,
        hasCardOnFile: hasCard,
        cardSummary: hasCard && cardLast4 ? `${cardBrand ?? "Card"} ••••${cardLast4}` : null,
        autopayEnabled: autopay,
        createdAt: str(r.created_at),
      };
    });

    return NextResponse.json({ success: true, rows });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: toErrorMessage(e) },
      { status: 500 },
    );
  }
}
