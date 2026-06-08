import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type Parsed271 = {
  traceNumber: string;
  eligibilityStatus: "active" | "inactive" | "unknown";
  rawSegments: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function splitSegments(raw: string) {
  return raw
    .replace(/\r/g, "")
    .split("~")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parse271(raw: string): Parsed271[] {
  const segments = splitSegments(raw);
  const results: Parsed271[] = [];
  let current: Parsed271 | null = null;

  for (const segment of segments) {
    const parts = segment.split("*");
    const id = parts[0];

    if (id === "TRN") {
      if (current) results.push(current);
      current = {
        traceNumber: text(parts[2]),
        eligibilityStatus: "unknown",
        rawSegments: [segment],
      };
      continue;
    }

    if (!current) continue;

    current.rawSegments.push(segment);

    if (id === "EB") {
      const eb01 = text(parts[1]);
      if (["1", "2", "3", "4", "5", "6", "7", "8"].includes(eb01)) {
        current.eligibilityStatus = "active";
      }

      if (["6"].includes(eb01)) {
        current.eligibilityStatus = "inactive";
      }
    }
  }

  if (current) results.push(current);

  return results.filter((item) => item.traceNumber);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { searchParams } = new URL(request.url);

    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });

    if (guard instanceof NextResponse) return guard;

    const { id } = await ctx.params;

    const rawBody = await request.text();
    let raw271 = rawBody;

    try {
      const parsed = JSON.parse(rawBody) as { raw271?: string; content?: string };
      raw271 = parsed.raw271 || parsed.content || rawBody;
    } catch {
      raw271 = rawBody;
    }

    raw271 = text(raw271);

    if (!raw271) {
      return NextResponse.json(
        { success: false, error: "271 content is required" },
        { status: 400 },
      );
    }

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database connection not available" },
        { status: 500 },
      );
    }

    const { data: batch, error: batchError } = await supabase
      .from("eligibility_270_batches")
      .select("id,batch_number")
      .eq("organization_id", guard.organizationId)
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();

    if (batchError) throw batchError;

    if (!batch) {
      return NextResponse.json(
        { success: false, error: "Eligibility batch not found" },
        { status: 404 },
      );
    }

    const parsedResponses = parse271(raw271);
    let matched = 0;
    let unmatched = 0;

    for (const response of parsedResponses) {
      const { data: requestRow, error: requestError } = await supabase
        .from("eligibility_270_batch_requests")
        .select("id,eligibility_check_id,client_id,insurance_policy_id")
        .eq("organization_id", guard.organizationId)
        .eq("batch_id", id)
        .eq("trace_number", response.traceNumber)
        .is("archived_at", null)
        .maybeSingle();

      if (requestError) throw requestError;

      if (!requestRow) {
        unmatched += 1;
        continue;
      }

      matched += 1;

      await supabase
        .from("eligibility_270_batch_requests")
        .update({
          request_status: "matched_271",
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id);

      if (requestRow.eligibility_check_id) {
        await supabase
          .from("eligibility_checks")
          .update({
            eligibility_status: response.eligibilityStatus,
            checked_at: new Date().toISOString(),
            response_summary: {
              source: "271_import",
              batch_id: id,
              trace_number: response.traceNumber,
              status: response.eligibilityStatus,
              raw_segments: response.rawSegments,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestRow.eligibility_check_id)
          .eq("organization_id", guard.organizationId);
      }
    }

    const finalStatus =
      matched > 0 && unmatched === 0
        ? "response_imported"
        : matched > 0
          ? "partially_imported"
          : "failed";

    await supabase
      .from("eligibility_270_batches")
      .update({
        batch_status: finalStatus,
        imported_at: new Date().toISOString(),
        last_import_error:
          matched === 0 ? "No matching TRN values were found in the 271 file." : null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", guard.organizationId)
      .eq("id", id);

    return NextResponse.json({
      success: matched > 0,
      batchId: id,
      matched,
      unmatched,
      parsedResponses: parsedResponses.length,
      message:
        matched > 0
          ? `Imported 271 response. Matched ${matched} response${matched === 1 ? "" : "s"}.`
          : "No matching TRN values were found in the 271 file.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to import 271 eligibility response",
      },
      { status: 500 },
    );
  }
}
