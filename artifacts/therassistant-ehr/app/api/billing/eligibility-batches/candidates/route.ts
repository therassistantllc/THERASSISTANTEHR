import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

function normalizeMonth(value: string | null) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) return null;
  return `${raw.slice(0, 7)}-01`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({ requestedOrganizationId: searchParams.get("organizationId") });
    if (guard instanceof NextResponse) return guard;

    const month = normalizeMonth(searchParams.get("month"));
    if (!month) {
      return NextResponse.json({ success: false, error: "month is required in YYYY-MM or YYYY-MM-DD format" }, { status: 400 });
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const monthStart = month;
    const monthEnd = new Date(`${monthStart}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const monthEndText = monthEnd.toISOString().slice(0, 10);

    const { data, error } = await supabase.rpc("eligibility_270_candidates_for_month", {
      p_organization_id: guard.organizationId,
      p_month_start: monthStart,
      p_month_end: monthEndText,
    });

    if (error) throw error;

    // ── Policy fallback: appointments with insurance_policy_id = null ────────
    // The RPC filters WHERE insurance_policy_id IS NOT NULL, so these are missed.
    // For each such appointment we look up the client's active primary policy and
    // synthesize a candidate row so the batch center can still run eligibility.
    let fallbackCandidates: typeof data = [];
    let fallbackCount = 0;
    const fallbackDiagnostics = {
      appointmentPolicyMissing: 0,
      clientPolicyFound: 0,
      clientPolicyMissing: 0,
      clientPolicyRejectedMissingPayer: 0,
      clientPolicyRejectedMissingSubscriber: 0,
      multiplePoliciesNeedSelection: 0,
      usedClientPolicyFallback: 0,
    };

    try {
      const { data: nullPolicyAppts } = await (supabase as any)
        .from("appointments")
        .select("id, client_id, provider_id, scheduled_start_at, appointment_status")
        .eq("organization_id", guard.organizationId)
        .is("archived_at", null)
        .is("insurance_policy_id", null)
        .gte("scheduled_start_at", `${monthStart}T00:00:00.000Z`)
        .lt("scheduled_start_at", `${monthEndText}T00:00:00.000Z`);

      if (Array.isArray(nullPolicyAppts) && nullPolicyAppts.length > 0) {
        const actionableNullPolicyAppts = nullPolicyAppts.filter((appt: any) => {
          const status = String(appt.appointment_status ?? "").toLowerCase();
          return status !== "canceled" && status !== "no_show" && status !== "no-show";
        });
        fallbackDiagnostics.appointmentPolicyMissing = actionableNullPolicyAppts.length;
        // Collect unique client IDs to batch-fetch policies
        const clientIds: string[] = [...new Set<string>(actionableNullPolicyAppts.map((a: any) => a.client_id).filter(Boolean))];

        // Fetch non-archived policies for all those clients.
        // We do active/date filtering in code to survive schema drift.
        const { data: policies } = await (supabase as any)
          .from("insurance_policies")
          .select("id, client_id, payer_id, plan_name, policy_number, subscriber_id, priority, active_flag, effective_date, termination_date, archived_at")
          .eq("organization_id", guard.organizationId)
          .in("client_id", clientIds)
          .is("archived_at", null);

        // Map clientId -> all candidate policies for disambiguation.
        const policiesByClient = new Map<string, any[]>();
        if (Array.isArray(policies)) {
          for (const p of policies) {
            const list = policiesByClient.get(p.client_id) ?? [];
            list.push(p);
            policiesByClient.set(p.client_id, list);
          }
        }

        // Collect payer IDs we need
        const allPolicies = [...policiesByClient.values()].flat();
        const payerIds = [...new Set<string>(allPolicies.map((p: any) => p.payer_id).filter(Boolean))];
        const subscriberIds = [...new Set<string>(allPolicies.map((p: any) => p.subscriber_id).filter(Boolean))];

        // Batch-fetch payers and subscribers. Avoid non-portable columns
        // so fallback survives environments where optional payer columns drift.
        const [{ data: payers }, { data: subscribers }, { data: clients }] = await Promise.all([
          payerIds.length > 0
            ? (supabase as any).from("insurance_payers").select("id, payer_name, payer_id, archived_at").in("id", payerIds)
            : Promise.resolve({ data: [] }),
          subscriberIds.length > 0
            ? (supabase as any).from("insurance_subscribers").select("id, first_name, last_name, date_of_birth, member_id, relationship_to_client").in("id", subscriberIds)
            : Promise.resolve({ data: [] }),
          (supabase as any).from("clients").select("id, first_name, last_name, date_of_birth").in("id", clientIds),
        ]);

        const payerMap = new Map<string, any>((payers ?? []).map((p: any) => [p.id, p]));
        const subMap = new Map<string, any>((subscribers ?? []).map((s: any) => [s.id, s]));
        const clientMap = new Map<string, any>((clients ?? []).map((c: any) => [c.id, c]));

        // Fetch provider names in batch (for rendering provider)
        const providerIds = [...new Set<string>(actionableNullPolicyAppts.map((a: any) => a.provider_id).filter(Boolean))];
        const { data: providerRows } = providerIds.length > 0
          ? await (supabase as any).from("providers").select("id, display_name, first_name, last_name").in("id", providerIds)
          : { data: [] };
        const providerMap = new Map<string, any>((providerRows ?? []).map((p: any) => [p.id, p]));

        // Build synthetic candidates — only for appointments where client has exactly 1 resolvable policy
        const existingApptIds = new Set<string>((Array.isArray(data) ? data : []).map((c: any) => c.appointment_id));

        for (const appt of actionableNullPolicyAppts) {
          if (existingApptIds.has(appt.id)) continue; // RPC already included it somehow
          const serviceDate = appt.scheduled_start_at ? String(appt.scheduled_start_at).slice(0, 10) : null;
          const clientPolicies = (policiesByClient.get(appt.client_id) ?? []).filter((p: any) => p.active_flag !== false);
          if (clientPolicies.length === 0) {
            fallbackDiagnostics.clientPolicyMissing += 1;
            continue;
          }

          fallbackDiagnostics.clientPolicyFound += 1;

          const dateFilteredPolicies = serviceDate
            ? clientPolicies.filter((p: any) => {
                const effective = p.effective_date ? String(p.effective_date) : null;
                const termination = p.termination_date ? String(p.termination_date) : null;
                if (effective && effective > serviceDate) return false;
                if (termination && termination < serviceDate) return false;
                return true;
              })
            : clientPolicies;
          const usablePolicies = dateFilteredPolicies.length > 0 ? dateFilteredPolicies : clientPolicies;

          if (usablePolicies.length > 1) {
            fallbackDiagnostics.multiplePoliciesNeedSelection += 1;
            continue;
          }

          const policy = usablePolicies[0];
          const payer = payerMap.get(policy.payer_id);
          if (!payer || !payer.payer_id) {
            fallbackDiagnostics.clientPolicyRejectedMissingPayer += 1;
            continue;
          }
          const subscriber = subMap.get(policy.subscriber_id);
          const subscriberMemberId = subscriber?.member_id ?? policy.policy_number ?? null;
          if (!subscriber || !subscriberMemberId) {
            fallbackDiagnostics.clientPolicyRejectedMissingSubscriber += 1;
            continue;
          }
          const client = clientMap.get(appt.client_id);
          const provider = providerMap.get(appt.provider_id);
          const providerName = provider
            ? (provider.display_name || [provider.first_name, provider.last_name].filter(Boolean).join(" "))
            : null;

          fallbackCandidates.push({
            appointment_id: appt.id,
            client_id: appt.client_id,
            insurance_policy_id: policy.id,
            payer_id: policy.payer_id,
            payer_name: payer.payer_name ?? null,
            electronic_payer_id: payer.payer_id ?? null,
            service_date: appt.scheduled_start_at ? appt.scheduled_start_at.slice(0, 10) : null,
            client_first_name: client?.first_name ?? null,
            client_last_name: client?.last_name ?? null,
            client_dob: client?.date_of_birth ?? null,
            subscriber_first_name: subscriber?.first_name ?? client?.first_name ?? null,
            subscriber_last_name: subscriber?.last_name ?? client?.last_name ?? null,
            subscriber_dob: subscriber?.date_of_birth ?? null,
            subscriber_member_id: subscriberMemberId,
            relationship_to_client: subscriber?.relationship_to_client ?? "self",
            provider_name: providerName ?? null,
            _fallback: true,
          });
          fallbackCount++;
          fallbackDiagnostics.usedClientPolicyFallback += 1;
        }
      }
    } catch {
      // Fallback is best-effort; do not fail the main response
    }

    const allCandidates = [...(Array.isArray(data) ? data : []), ...fallbackCandidates];

    // ── Diagnostic pass: explain why appointments may be excluded ──────────
    // Run non-blocking; failures produce null diagnostics, not a 500.
    let diagnostics: {
      totalAppointmentsInMonth: number;
      appointmentPolicyMissing: number;
      clientPolicyFound: number;
      clientPolicyMissing: number;
      clientPolicyRejectedMissingPayer: number;
      clientPolicyRejectedMissingSubscriber: number;
      multiplePoliciesNeedSelection: number;
      excludedNoPolicyId: number;
      excludedCanceledOrNoShow: number;
      excludedAlreadyCheckedThisMonth: number;
      includedCandidates: number;
      usedClientPolicyFallback: number;
    } | null = null;

    try {
      // Count all non-archived appointments in the month for this org
      const { count: totalCount } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", guard.organizationId)
        .is("archived_at", null)
        .gte("scheduled_start_at", `${monthStart}T00:00:00.000Z`)
        .lt("scheduled_start_at", `${monthEndText}T00:00:00.000Z`);

      // Count canceled / no-show appointments
      const { count: canceledCount } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", guard.organizationId)
        .is("archived_at", null)
        .in("appointment_status", ["canceled", "no_show", "no-show"])
        .gte("scheduled_start_at", `${monthStart}T00:00:00.000Z`)
        .lt("scheduled_start_at", `${monthEndText}T00:00:00.000Z`);

      // Count appointments that already have an eligibility check this month
      const { count: alreadyCheckedCount } = await supabase
        .from("eligibility_checks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", guard.organizationId)
        .gte("created_at", `${monthStart}T00:00:00.000Z`)
        .lt("created_at", `${monthEndText}T00:00:00.000Z`);

      diagnostics = {
        totalAppointmentsInMonth: totalCount ?? 0,
        appointmentPolicyMissing: fallbackDiagnostics.appointmentPolicyMissing,
        clientPolicyFound: fallbackDiagnostics.clientPolicyFound,
        clientPolicyMissing: fallbackDiagnostics.clientPolicyMissing,
        clientPolicyRejectedMissingPayer: fallbackDiagnostics.clientPolicyRejectedMissingPayer,
        clientPolicyRejectedMissingSubscriber: fallbackDiagnostics.clientPolicyRejectedMissingSubscriber,
        multiplePoliciesNeedSelection: fallbackDiagnostics.multiplePoliciesNeedSelection,
        // Only true no-policy exclusions (no client policy found), not missing appointment linkage.
        excludedNoPolicyId: fallbackDiagnostics.clientPolicyMissing,
        excludedCanceledOrNoShow: canceledCount ?? 0,
        excludedAlreadyCheckedThisMonth: alreadyCheckedCount ?? 0,
        includedCandidates: allCandidates.length,
        usedClientPolicyFallback: fallbackDiagnostics.usedClientPolicyFallback,
      };
    } catch {
      // Diagnostics are best-effort; do not fail the main response
    }

    return NextResponse.json({
      success: true,
      month: monthStart,
      count: allCandidates.length,
      candidates: allCandidates,
      ...(diagnostics ? { diagnostics } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load eligibility candidates" },
      { status: 500 },
    );
  }
}
