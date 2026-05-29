import { NextResponse } from "next/server";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { checkProviderAvailability } from "@/lib/scheduling/core";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function parseIso(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabaseServiceRoleClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Service role key is required for availability checks." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      organizationId?: string;
      providerId?: string;
      startAt?: string;
      endAt?: string;
      location?: "office" | "telehealth" | "any";
    };

    const guard = await requireOrgAccess({
      requestedOrganizationId: body.organizationId,
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const providerId = String(body.providerId ?? "").trim();
    const startAt = String(body.startAt ?? "").trim();
    const endAt = String(body.endAt ?? "").trim();
    const location = body.location ?? "any";

    if (!providerId || !startAt || !endAt) {
      return NextResponse.json(
        { success: false, error: "providerId, startAt, and endAt are required" },
        { status: 400 },
      );
    }
    if (!isUuid(providerId)) {
      return NextResponse.json(
        { success: false, error: "providerId must be a valid UUID" },
        { status: 400 },
      );
    }
    if (!["office", "telehealth", "any"].includes(location)) {
      return NextResponse.json(
        { success: false, error: "location must be one of office, telehealth, or any" },
        { status: 400 },
      );
    }

    const startDate = parseIso(startAt);
    const endDate = parseIso(endAt);
    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: "startAt and endAt must be valid ISO timestamps" },
        { status: 400 },
      );
    }
    if (endDate <= startDate) {
      return NextResponse.json(
        { success: false, error: "endAt must be after startAt" },
        { status: 400 },
      );
    }

    const durationMinutes = (endDate.getTime() - startDate.getTime()) / 60000;
    if (durationMinutes < 5 || durationMinutes > 12 * 60) {
      return NextResponse.json(
        { success: false, error: "Appointment duration must be between 5 and 720 minutes" },
        { status: 400 },
      );
    }

    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select("id")
      .eq("id", providerId)
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .maybeSingle();
    if (providerError) {
      console.error("Availability provider lookup failed", providerError);
      return NextResponse.json(
        { success: false, error: "Failed to validate provider" },
        { status: 500 },
      );
    }
    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found for this organization" },
        { status: 404 },
      );
    }

    const result = await checkProviderAvailability({
      supabase,
      organizationId,
      providerId,
      startAt,
      endAt,
      location,
    });

    return NextResponse.json({ success: true, organizationId, ...result });
  } catch (error) {
    console.error("Availability check failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Availability check failed",
      },
      { status: 500 },
    );
  }
}
