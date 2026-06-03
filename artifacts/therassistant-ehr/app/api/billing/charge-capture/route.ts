import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const RETIRED_MESSAGE =
  "Charge capture has been retired. Use encounters, professional claims, and ready-to-generate queues instead.";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const guard = await requireBillingAccess({
    requestedOrganizationId: searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;

  return NextResponse.json({
    success: true,
    retired: true,
    organizationId: guard.organizationId,
    message: RETIRED_MESSAGE,
    redirectTo: "/billing/ready-to-generate",
    tabs: [],
    tabCounts: {},
    items: [],
    totalItems: 0,
  });
}
