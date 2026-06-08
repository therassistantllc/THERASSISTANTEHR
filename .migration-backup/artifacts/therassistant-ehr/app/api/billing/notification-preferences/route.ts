/**
 * Task #625: per-user opt-out for routing notifications.
 *
 * GET  /api/billing/notification-preferences  → current user's prefs (defaults applied)
 * PUT  /api/billing/notification-preferences  → upsert prefs for the current user
 *
 * Always scoped to the requesting staff member; we never let one user
 * change another user's preferences.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

interface PrefRow {
  email_on_eligibility_routing: boolean | null;
  inapp_on_eligibility_routing: boolean | null;
}

const DEFAULTS = {
  emailOnEligibilityRouting: true,
  inAppOnEligibilityRouting: true,
};

function shapePrefs(row: PrefRow | null) {
  return {
    emailOnEligibilityRouting:
      row?.email_on_eligibility_routing ?? DEFAULTS.emailOnEligibilityRouting,
    inAppOnEligibilityRouting:
      row?.inapp_on_eligibility_routing ?? DEFAULTS.inAppOnEligibilityRouting,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const guard = await requireBillingAccess({
    requestedOrganizationId: url.searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;
  if (!guard.staffId) {
    // Dev passthrough / unauthenticated context — return defaults so the UI
    // can render its toggles without erroring.
    return NextResponse.json({ success: true, preferences: shapePrefs(null) });
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Database connection not available" },
      { status: 500 },
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  const { data } = await sb
    .from("staff_notification_preferences")
    .select("email_on_eligibility_routing, inapp_on_eligibility_routing")
    .eq("staff_id", guard.staffId)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    preferences: shapePrefs((data as PrefRow | null) ?? null),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    organizationId?: string;
    emailOnEligibilityRouting?: boolean;
    inAppOnEligibilityRouting?: boolean;
  };
  const guard = await requireBillingAccess({
    requestedOrganizationId: body.organizationId,
  });
  if (guard instanceof NextResponse) return guard;
  if (!guard.staffId) {
    return NextResponse.json(
      { success: false, error: "Sign in to manage notification preferences" },
      { status: 401 },
    );
  }

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Database connection not available" },
      { status: 500 },
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };

  const nowIso = new Date().toISOString();
  const emailOn =
    typeof body.emailOnEligibilityRouting === "boolean"
      ? body.emailOnEligibilityRouting
      : DEFAULTS.emailOnEligibilityRouting;
  const inAppOn =
    typeof body.inAppOnEligibilityRouting === "boolean"
      ? body.inAppOnEligibilityRouting
      : DEFAULTS.inAppOnEligibilityRouting;

  const { error } = await sb
    .from("staff_notification_preferences")
    .upsert(
      {
        organization_id: guard.organizationId,
        staff_id: guard.staffId,
        email_on_eligibility_routing: emailOn,
        inapp_on_eligibility_routing: inAppOn,
        updated_at: nowIso,
      },
      { onConflict: "staff_id" },
    );

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message ?? "Failed to save preferences" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    preferences: {
      emailOnEligibilityRouting: emailOn,
      inAppOnEligibilityRouting: inAppOn,
    },
  });
}
