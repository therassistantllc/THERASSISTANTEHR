import { NextResponse } from "next/server";
import {
  mark837PBatchSubmitted,
  mark837PBatchSubmissionFailed,
} from "@/lib/claims/edi837pSubmissionService";
import { requireOrgAccess } from "@/lib/auth/requireOrgAccess";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const guard = await requireOrgAccess({
      requestedOrganizationId: body.organizationId,
    });
    if (guard instanceof NextResponse) return guard;
    if (!body.batchId) {
      return NextResponse.json({ success: false, error: "batchId is required" }, { status: 400 });
    }

    const result = body.status === "failed"
      ? await mark837PBatchSubmissionFailed({
          organizationId: guard.organizationId,
          batchId: String(body.batchId),
          reason: String(body.reason ?? "837P submission failed"),
        })
      : await mark837PBatchSubmitted({
          organizationId: guard.organizationId,
          batchId: String(body.batchId),
          availityFileId: body.availityFileId ?? null,
          submittedAt: body.submittedAt ?? null,
        });

    return NextResponse.json({ success: result.ok, result }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    console.error("837P submission API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "837P submission tracking failed" },
      { status: 500 },
    );
  }
}
