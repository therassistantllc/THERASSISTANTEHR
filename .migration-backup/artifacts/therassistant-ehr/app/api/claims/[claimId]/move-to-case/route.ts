import { NextResponse } from "next/server";
import { moveClaimToCase } from "@/lib/cases/clientCasesService";

export async function POST(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
) {
  try {
    const { claimId } = await context.params;
    const body = (await request.json()) as {
      organizationId?: string;
      targetCaseId?: string;
      reason?: string | null;
      actorUserId?: string | null;
      actorRole?: string | null;
    };
    if (!body.organizationId || !body.targetCaseId) {
      return NextResponse.json(
        { success: false, error: "organizationId and targetCaseId are required" },
        { status: 400 },
      );
    }
    const result = await moveClaimToCase({
      organizationId: body.organizationId,
      claimId,
      targetCaseId: body.targetCaseId,
      reason: body.reason ?? null,
      actorUserId: body.actorUserId ?? null,
      actorRole: body.actorRole ?? null,
    });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    return NextResponse.json({
      success: true,
      previousCaseId: result.previousCaseId,
      newPayerProfileId: result.newPayerProfileId,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to move claim" },
      { status: 500 },
    );
  }
}
