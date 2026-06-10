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

    // ── Client-policy fallback: include appointments with insurance_policy_id=null ──
    // The RPC only returns rows WHERE insurance_policy_id IS NOT NULL.
    // Mirror the same fallback used in GET /candidates so batch generation
    // works for appointments that were scheduled without a policy attached.
    let fallbackCandidates: DbRow[] = [];
    try {
      const monthEnd = nextMonth(month);
      const { data: nullPolicyAppts } = await (supabase as any)
        .from("appointments")
        .select("id, client_id, provider_id, scheduled_start_at, appointment_status")
        .eq("organization_id", guard.organizationId)
        .is("archived_at", null)
        .is("insurance_policy_id", null)
        .gte("scheduled_start_at", `${month}T00:00:00.000Z`)
        .lt("scheduled_start_at", `${monthEnd}T00:00:00.000Z`);

      if (Array.isArray(nullPolicyAppts) && nullPolicyAppts.length > 0) {
        const actionable = nullPolicyAppts.filter((appt: any) => {
          const status = String(appt.appointment_status ?? "").toLowerCase();
          return status !== "canceled" && status !== "no_show" && status !== "no-show";
        });
        const existingApptIds = new Set<string>((Array.isArray(candidatesRaw) ? candidatesRaw : []).map((c: any) => c.appointment_id));
        const clientIds: string[] = [...new Set<string>(actionable.map((a: any) => a.client_id).filter(Boolean))];
        if (clientIds.length > 0) {
          const { data: policies } = await (supabase as any)
            .from("insurance_policies")
            .select("id, client_id, payer_id, policy_number, subscriber_id, priority, active_flag, effective_date, termination_date, archived_at")
            .eq("organization_id", guard.organizationId)
            .in("client_id", clientIds)
            .is("archived_at", null);

          const policiesByClient = new Map<string, any[]>();
          for (const p of (policies ?? [])) {
            if (p.active_flag === false) continue;
            const list = policiesByClient.get(p.client_id) ?? [];
            list.push(p);
            policiesByClient.set(p.client_id, list);
          }

          const allPolicies = [...policiesByClient.values()].flat();
          const payerIds = [...new Set<string>(allPolicies.map((p: any) => p.payer_id).filter(Boolean))];
          const subscriberIds = [...new Set<string>(allPolicies.map((p: any) => p.subscriber_id).filter(Boolean))];
          const providerIds = [...new Set<string>(actionable.map((a: any) => a.provider_id).filter(Boolean))];

          const [{ data: payers }, { data: subscribers }, { data: clients }, { data: providers }] = await Promise.all([
            payerIds.length > 0
              ? (supabase as any).from("insurance_payers").select("id, payer_name, payer_id, archived_at").in("id", payerIds)
              : Promise.resolve({ data: [] }),
            subscriberIds.length > 0
              ? (supabase as any).from("insurance_subscribers").select("id, first_name, last_name, date_of_birth, member_id, relationship_to_client").in("id", subscriberIds)
              : Promise.resolve({ data: [] }),
            (supabase as any).from("clients").select("id, first_name, last_name, date_of_birth").in("id", clientIds),
            providerIds.length > 0
              ? (supabase as any).from("providers").select("id, display_name, first_name, last_name").in("id", providerIds)
              : Promise.resolve({ data: [] }),
          ]);

          const payerMap = new Map<string, any>((payers ?? []).map((p: any) => [p.id, p]));
          const subMap = new Map<string, any>((subscribers ?? []).map((s: any) => [s.id, s]));
          const clientMap = new Map<string, any>((clients ?? []).map((c: any) => [c.id, c]));
          const providerMap = new Map<string, any>((providers ?? []).map((p: any) => [p.id, p]));

          for (const appt of actionable) {
            if (existingApptIds.has(appt.id)) continue;
            const serviceDate = appt.scheduled_start_at ? String(appt.scheduled_start_at).slice(0, 10) : null;
            const clientPolicies = policiesByClient.get(appt.client_id) ?? [];
            if (clientPolicies.length === 0) continue;

            const datePolicies = serviceDate
              ? clientPolicies.filter((p: any) => {
                  if (p.effective_date && String(p.effective_date) > serviceDate) return false;
                  if (p.termination_date && String(p.termination_date) < serviceDate) return false;
                  return true;
                })
              : clientPolicies;
            const usable = datePolicies.length > 0 ? datePolicies : clientPolicies;
            if (usable.length !== 1) continue;

            const policy = usable[0];
            const payer = payerMap.get(policy.payer_id);
            if (!payer || !payer.payer_id) continue;
            const subscriber = subMap.get(policy.subscriber_id);
            const memberid = subscriber?.member_id ?? policy.policy_number ?? null;
            if (!subscriber || !memberid) continue;

            const client = clientMap.get(appt.client_id);
            const provider = providerMap.get(appt.provider_id);
            const providerName = provider
              ? provider.display_name || [provider.first_name, provider.last_name].filter(Boolean).join(" ")
              : null;

            fallbackCandidates.push({
              appointment_id: appt.id,
              client_id: appt.client_id,
              insurance_policy_id: policy.id,
              payer_id: policy.payer_id,
              payer_name: payer.payer_name ?? null,
              electronic_payer_id: payer.payer_id,
              service_date: serviceDate,
              client_first_name: client?.first_name ?? null,
              client_last_name: client?.last_name ?? null,
              client_dob: client?.date_of_birth ?? null,
              subscriber_first_name: subscriber?.first_name ?? client?.first_name ?? null,
              subscriber_last_name: subscriber?.last_name ?? client?.last_name ?? null,
              subscriber_dob: subscriber?.date_of_birth ?? client?.date_of_birth ?? null,
              subscriber_member_id: memberid,
              relationship_to_client: subscriber?.relationship_to_client ?? "self",
              provider_name: providerName ?? null,
            });
          }
        }
      }
    } catch {
      // Fallback is best-effort; do not fail batch generation
    }

    const allCandidatesRaw = [...(Array.isArray(candidatesRaw) ? candidatesRaw : []), ...fallbackCandidates];

    let candidates = (allCandidatesRaw as DbRow[]).filter(
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
