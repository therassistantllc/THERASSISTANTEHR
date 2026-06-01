import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { build270BatchFile } from "@/lib/eligibility/build270BatchFile";

type DbRow = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeMonth(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) return null;
  return `${raw.slice(0, 7)}-01`;
}

function nextMonth(monthStart: string) {
  const d = new Date(`${monthStart}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function makeBatchNumber() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `ELG-${stamp}`;
}

function makeTrace(row: DbRow, index: number) {
  const appointmentPart = text(row.appointment_id).replace(/-/g, "").slice(0, 12);
  return `TR${Date.now().toString().slice(-8)}${String(index + 1).padStart(4, "0")}${appointmentPart}`.slice(0, 50);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });

    if (guard instanceof NextResponse) return guard;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data, error } = await supabase
      .from("eligibility_270_batches")
      .select(
        "id,batch_number,batch_month,batch_status,service_type_code,request_count,generated_file_name,generated_at,downloaded_at,submitted_at,imported_at,last_generation_error,last_import_error,created_at",
      )
      .eq("organization_id", guard.organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      batches: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load eligibility batches",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      organizationId?: string;
      month?: string;
      appointmentIds?: unknown;
      senderId?: string;
      receiverId?: string;
      billingProviderName?: string;
      billingProviderNpi?: string;
    };

    const guard = await requireBillingAccess({
      requestedOrganizationId: body.organizationId ?? null,
    });

    if (guard instanceof NextResponse) return guard;

    const month = normalizeMonth(body.month);
    if (!month) {
      return NextResponse.json(
        { success: false, error: "month is required in YYYY-MM or YYYY-MM-DD format" },
        { status: 400 },
      );
    }

    const selectedAppointmentIds = Array.isArray(body.appointmentIds)
      ? [...new Set(body.appointmentIds.map((id) => text(id)).filter(Boolean))]
      : [];

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: candidatesRaw, error: candidatesError } = await supabase.rpc(
      "eligibility_270_candidates_for_month",
      {
        p_organization_id: guard.organizationId,
        p_month_start: month,
        p_month_end: nextMonth(month),
      },
    );

    if (candidatesError) throw candidatesError;

    let candidates = ((candidatesRaw ?? []) as DbRow[]).filter(
      (r) => text(r.electronic_payer_id) && text(r.subscriber_member_id),
    );

    if (selectedAppointmentIds.length > 0) {
      const selected = new Set(selectedAppointmentIds);
      candidates = candidates.filter((r) => selected.has(text(r.appointment_id)));
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        { success: false, error: "No eligible scheduled clients were found for this month." },
        { status: 422 },
      );
    }

    const now = new Date().toISOString();
    const batchNumber = makeBatchNumber();

    const { data: batch, error: batchError } = await supabase
      .from("eligibility_270_batches")
      .insert({
        organization_id: guard.organizationId,
        batch_number: batchNumber,
        batch_month: month,
        batch_status: "ready_to_generate",
        service_type_code: "98",
        request_count: candidates.length,
      })
      .select("id,batch_number")
      .single();

    if (batchError || !batch) {
      throw batchError ?? new Error("Failed to create eligibility batch");
    }

    const requestRows = candidates.map((row, index) => ({
      organization_id: guard.organizationId,
      batch_id: batch.id,
      appointment_id: text(row.appointment_id) || null,
      client_id: text(row.client_id),
      insurance_policy_id: text(row.insurance_policy_id),
      payer_id: text(row.payer_id) || null,
      trace_number: makeTrace(row, index),
      service_date: text(row.service_date),
      service_type_code: "98",
      request_status: "included",
    }));

    const { data: insertedRequests, error: requestError } = await supabase
      .from("eligibility_270_batch_requests")
      .insert(requestRows)
      .select("id,appointment_id,client_id,insurance_policy_id,trace_number,service_date");

    if (requestError) throw requestError;

    const checkRows = requestRows.map((row) => ({
      organization_id: guard.organizationId,
      client_id: row.client_id,
      appointment_id: row.appointment_id,
      insurance_policy_id: row.insurance_policy_id,
      eligibility_status: "not_checked",
      response_summary: {
        source: "monthly_270_batch",
        batch_number: batchNumber,
        service_type_code: "98",
      },
      created_at: now,
      updated_at: now,
    }));

    const { data: checks, error: checksError } = await supabase
      .from("eligibility_checks")
      .insert(checkRows)
      .select("id,appointment_id,client_id,insurance_policy_id");

    if (checksError) throw checksError;

    for (const req of (insertedRequests ?? []) as DbRow[]) {
      const matchingCheck = ((checks ?? []) as DbRow[]).find(
        (c) =>
          text(c.appointment_id) === text(req.appointment_id) &&
          text(c.insurance_policy_id) === text(req.insurance_policy_id),
      );

      if (!matchingCheck) continue;

      await supabase
        .from("eligibility_270_batch_requests")
        .update({
          eligibility_check_id: text(matchingCheck.id),
          request_status: "generated",
          updated_at: now,
        })
        .eq("id", text(req.id));
    }

    const traceByAppointment = new Map<string, string>();
    for (const req of (insertedRequests ?? []) as DbRow[]) {
      traceByAppointment.set(text(req.appointment_id), text(req.trace_number));
    }

    const fileContent = build270BatchFile({
      batchNumber,
      senderId: body.senderId || "THERASSISTANT",
      receiverId: body.receiverId || "AVAILITY",
      billingProviderName: body.billingProviderName || "BILLING PROVIDER",
      billingProviderNpi: body.billingProviderNpi || "0000000000",
      usageIndicator: "T",
      candidates: candidates.map((row) => ({
        appointmentId: text(row.appointment_id) || null,
        clientId: text(row.client_id),
        insurancePolicyId: text(row.insurance_policy_id),
        payerId: text(row.payer_id) || null,
        payerName: text(row.payer_name) || "PAYER",
        electronicPayerId: text(row.electronic_payer_id),
        serviceDate: text(row.service_date),
        clientFirstName: text(row.client_first_name),
        clientLastName: text(row.client_last_name),
        clientDob: text(row.client_dob),
        subscriberFirstName: text(row.subscriber_first_name),
        subscriberLastName: text(row.subscriber_last_name),
        subscriberDob: text(row.subscriber_dob),
        subscriberMemberId: text(row.subscriber_member_id),
        relationshipToClient: text(row.relationship_to_client) || null,
        traceNumber:
          traceByAppointment.get(text(row.appointment_id)) || makeTrace(row, 0),
      })),
    });

    const fileName = `${batchNumber}.270`;

    const { error: updateError } = await supabase
      .from("eligibility_270_batches")
      .update({
        batch_status: "generated",
        generated_file_name: fileName,
        generated_file_content: fileContent,
        generated_at: now,
        updated_at: now,
      })
      .eq("organization_id", guard.organizationId)
      .eq("id", batch.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      batchNumber,
      requestCount: candidates.length,
      generatedFileName: fileName,
      message: `Generated 270 eligibility batch for ${candidates.length} scheduled client${
        candidates.length === 1 ? "" : "s"
      }.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create eligibility batch",
      },
      { status: 500 },
    );
  }
}
