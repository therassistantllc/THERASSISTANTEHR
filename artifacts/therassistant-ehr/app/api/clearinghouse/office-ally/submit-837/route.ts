import { NextResponse } from "next/server";
import { OfficeAllyJsonApiAdapter } from "@/lib/clearinghouse/adapters/OfficeAllyJsonApiAdapter";
import { assertClaimSubmissionReady, gateResponse } from "@/lib/validation/claimSubmissionGate";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.organizationId) {
      return NextResponse.json({ success: false, error: "organizationId is required" }, { status: 400 });
    }

    if (!body.x12) {
      return NextResponse.json({ success: false, error: "x12 payload is required" }, { status: 400 });
    }

    const gate = await assertClaimSubmissionReady(String(body.organizationId));
    const blocked = gateResponse(gate);
    if (blocked) return blocked;

    const adapter = new OfficeAllyJsonApiAdapter();

    const result = await adapter.submitProfessionalX12({
      organizationId: body.organizationId,
      x12: body.x12,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "837 submission failed" },
      { status: 500 },
    );
  }
}
