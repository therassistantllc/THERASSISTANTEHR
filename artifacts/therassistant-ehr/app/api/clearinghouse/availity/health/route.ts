import { NextResponse } from "next/server";
import { AvailityJsonApiAdapter } from "@/lib/clearinghouse/adapters/AvailityJsonApiAdapter";

import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await requireOrgAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const adapter = new AvailityJsonApiAdapter();
    const result = await adapter.healthCheck(guard.organizationId);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Availity health check failed" },
      { status: 500 },
    );
  }
}
