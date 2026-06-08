/**
 * GET /api/billing/claims/[claimId]/proof-files?path=...&organizationId=...
 *
 * Streams a proof-of-timely-filing file from the `claim-proofs` Supabase
 * Storage bucket. The path is validated to start with
 * `<sessionOrgId>/claim-proofs/<claimId>/` so a caller can't read another
 * tenant's or another claim's attachments by guessing or rewriting it.
 *
 * `?probe=1` returns JSON with a short-lived signed URL instead of bytes,
 * matching the mailroom file probe convention.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

const BUCKET = "claim-proofs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function logCtx(label: string, ctx: Record<string, unknown>) {
  const parts = Object.entries(ctx)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  console.log(`[claim.proof-files] ${label} ${parts}`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ claimId: string }> },
) {
  const { claimId } = await context.params;
  const { searchParams } = new URL(request.url);
  const guard = await requireBillingAccess({
    requestedOrganizationId: searchParams.get("organizationId"),
  });
  if (guard instanceof NextResponse) return guard;
  const organizationId = guard.organizationId;

  const path = clean(searchParams.get("path"));
  const expectedPrefix = `${organizationId}/claim-proofs/${claimId}/`;
  if (!path || !path.startsWith(expectedPrefix) || path.includes("..")) {
    logCtx("path-rejected", { organizationId, claimId, path });
    return NextResponse.json(
      { success: false, error: "Invalid file path" },
      { status: 400 },
    );
  }
  const isProbe = searchParams.get("probe") === "1";

  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: "Database not available" },
      { status: 500 },
    );
  }

  // Verify the claim belongs to the session org before exposing anything.
  const { data: claim } = await (supabase as any)
    .from("professional_claims")
    .select("id")
    .eq("id", claimId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!claim) {
    return NextResponse.json(
      { success: false, error: "Claim not found" },
      { status: 404 },
    );
  }

  const fileName = path.split("/").pop() || "proof";

  if (isProbe) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      logCtx("probe-missing", {
        organizationId,
        claimId,
        path,
        err: error?.message,
      });
      return NextResponse.json(
        { success: false, error: error?.message || "File not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      signedUrl: data.signedUrl,
      fileName,
    });
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(path);
  if (dlErr || !blob) {
    logCtx("download-failed", {
      organizationId,
      claimId,
      path,
      err: dlErr?.message,
    });
    return NextResponse.json(
      { success: false, error: dlErr?.message || "File not available" },
      { status: 404 },
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
