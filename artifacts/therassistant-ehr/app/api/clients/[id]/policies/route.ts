import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";

type PostBody = {
  organizationId?: string;
  priority?: "primary" | "secondary" | "tertiary";
  payerId?: string;
  planName?: string | null;
  policyNumber?: string | null;
  groupNumber?: string | null;
  effectiveDate?: string | null;
  terminationDate?: string | null;
  copayAmount?: string | number | null;
  coinsurancePercent?: string | number | null;
  deductibleAmount?: string | number | null;
  outOfPocketMax?: string | number | null;
  subscriberRelationship?: string | null;
  subscriberFirstName?: string | null;
  subscriberLastName?: string | null;
  subscriberDateOfBirth?: string | null;
  subscriberMemberId?: string | null;
  subscriberPhone?: string | null;
  subscriberAddressLine1?: string | null;
  subscriberAddressLine2?: string | null;
  subscriberCity?: string | null;
  subscriberState?: string | null;
  subscriberPostalCode?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["primary", "secondary", "tertiary"]);

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}
function date(v: unknown): { ok: true; v: string | null } | { ok: false; err: string } {
  const t = s(v);
  if (!t) return { ok: true, v: null };
  if (!DATE_RE.test(t)) return { ok: false, err: "Dates must be YYYY-MM-DD" };
  // Strict calendar validation — reject things like 2026-02-31 that
  // JS's Date constructor silently rolls over.
  const [y, m, d] = t.split("-").map((p) => Number(p));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return { ok: false, err: "Invalid date" };
  }
  return { ok: true, v: t };
}
function money(v: unknown, label: string): { ok: true; v: string | null } | { ok: false; err: string } {
  const t = s(v);
  if (!t) return { ok: true, v: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false, err: `${label} must be a positive number` };
  if (n > 1_000_000) return { ok: false, err: `${label} is unreasonably large` };
  return { ok: true, v: n.toFixed(2) };
}
function pct(v: unknown): { ok: true; v: number | null } | { ok: false; err: string } {
  const t = s(v);
  if (!t) return { ok: true, v: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, err: "Coinsurance must be 0-100" };
  return { ok: true, v: n };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: clientId } = await context.params;
    const body = (await request.json()) as PostBody;

    const guard = await requireOrgAccess({ requestedOrganizationId: body.organizationId });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const staff = await requireAuthenticatedStaff();
    if (!staff) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const priority = body.priority && PRIORITIES.has(body.priority) ? body.priority : "primary";

    // Required fields per schema: payer_id, effective_date, subscriber_id
    // (subscriber row in turn requires first_name, last_name, member_id,
    // date_of_birth, relationship_to_client). policy_number is optional in
    // the DB but we keep it required from the UI because it's the member ID
    // we render on the claim.
    const payerId = s(body.payerId);
    if (!payerId) {
      return NextResponse.json({ success: false, error: "Payer is required" }, { status: 400 });
    }
    const policyNumber = s(body.policyNumber);
    if (!policyNumber) {
      return NextResponse.json({ success: false, error: "Policy / Member ID is required" }, { status: 400 });
    }

    const eff = date(body.effectiveDate);
    if (!eff.ok) return NextResponse.json({ success: false, error: eff.err }, { status: 400 });
    if (!eff.v) {
      return NextResponse.json({ success: false, error: "Effective date is required" }, { status: 400 });
    }
    const term = date(body.terminationDate);
    if (!term.ok) return NextResponse.json({ success: false, error: term.err }, { status: 400 });
    if (term.v && eff.v > term.v) {
      return NextResponse.json({ success: false, error: "Effective date must be on or before termination date" }, { status: 400 });
    }
    const dob = date(body.subscriberDateOfBirth);
    if (!dob.ok) return NextResponse.json({ success: false, error: dob.err }, { status: 400 });
    if (!dob.v) {
      return NextResponse.json({ success: false, error: "Subscriber date of birth is required" }, { status: 400 });
    }

    const subFirst = s(body.subscriberFirstName);
    const subLast = s(body.subscriberLastName);
    const subMember = s(body.subscriberMemberId);
    if (!subFirst || !subLast || !subMember) {
      return NextResponse.json(
        { success: false, error: "Subscriber first name, last name, and Member ID are required" },
        { status: 400 },
      );
    }
    const relationship = s(body.subscriberRelationship) ?? "self";

    const copay = money(body.copayAmount, "Copay");
    if (!copay.ok) return NextResponse.json({ success: false, error: copay.err }, { status: 400 });
    const deductible = money(body.deductibleAmount, "Deductible");
    if (!deductible.ok) return NextResponse.json({ success: false, error: deductible.err }, { status: 400 });
    const oop = money(body.outOfPocketMax, "Out-of-pocket max");
    if (!oop.ok) return NextResponse.json({ success: false, error: oop.err }, { status: 400 });
    const coins = pct(body.coinsurancePercent);
    if (!coins.ok) return NextResponse.json({ success: false, error: coins.err }, { status: 400 });

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    // Tenant guard: the route uses the admin client which bypasses RLS,
    // so we must verify the client in the path actually belongs to the
    // caller's organization before any insert that references it.
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id, organization_id")
      .eq("id", clientId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (clientErr) {
      return NextResponse.json({ success: false, error: clientErr.message }, { status: 500 });
    }
    if (!clientRow) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    const { data: payer, error: payerErr } = await supabase
      .from("insurance_payers")
      .select("id, organization_id, archived_at")
      .eq("id", payerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (payerErr) {
      return NextResponse.json({ success: false, error: payerErr.message }, { status: 500 });
    }
    if (!payer || payer.archived_at) {
      return NextResponse.json({ success: false, error: "Payer not found for this organization" }, { status: 400 });
    }

    // insurance_subscribers has no client_id column; subscribers are scoped
    // by organization and linked to a policy via insurance_policies.subscriber_id.
    const subInsert: Record<string, unknown> = {
      organization_id: organizationId,
      first_name: subFirst,
      last_name: subLast,
      date_of_birth: dob.v,
      member_id: subMember,
      phone: s(body.subscriberPhone),
      address_line_1: s(body.subscriberAddressLine1),
      address_line_2: s(body.subscriberAddressLine2),
      city: s(body.subscriberCity),
      state: s(body.subscriberState),
      postal_code: s(body.subscriberPostalCode),
      relationship_to_client: relationship,
      group_number: s(body.groupNumber),
    };
    const { data: sub, error: subErr } = await supabase
      .from("insurance_subscribers")
      .insert(subInsert)
      .select("id")
      .maybeSingle();
    if (subErr) {
      return NextResponse.json({ success: false, error: `Failed to create subscriber: ${subErr.message}` }, { status: 500 });
    }
    const subscriberId = sub?.id ? String(sub.id) : null;
    if (!subscriberId) {
      return NextResponse.json({ success: false, error: "Subscriber created but id missing" }, { status: 500 });
    }

    const policyInsert: Record<string, unknown> = {
      organization_id: organizationId,
      client_id: clientId,
      priority,
      payer_id: payerId,
      plan_name: s(body.planName),
      policy_number: policyNumber,
      group_number: s(body.groupNumber),
      effective_date: eff.v,
      termination_date: term.v,
      copay_amount: copay.v,
      coinsurance_percent: coins.v,
      deductible_amount: deductible.v,
      out_of_pocket_max: oop.v,
      subscriber_relationship: relationship,
      subscriber_id: subscriberId,
      active_flag: true,
    };

    const { data: policy, error: polErr } = await supabase
      .from("insurance_policies")
      .insert(policyInsert)
      .select("id")
      .maybeSingle();
    if (polErr) {
      // Best-effort cleanup: drop the orphan subscriber we just made so
      // we don't leave a half-created record behind.
      await supabase.from("insurance_subscribers").delete().eq("id", subscriberId);
      return NextResponse.json({ success: false, error: `Failed to create insurance policy: ${polErr.message}` }, { status: 500 });
    }
    const policyId = policy?.id ? String(policy.id) : null;
    if (!policyId) {
      return NextResponse.json({ success: false, error: "Insurance policy created but id missing" }, { status: 500 });
    }

    return NextResponse.json({ success: true, policyId, priority });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to create policy" },
      { status: 500 },
    );
  }
}
