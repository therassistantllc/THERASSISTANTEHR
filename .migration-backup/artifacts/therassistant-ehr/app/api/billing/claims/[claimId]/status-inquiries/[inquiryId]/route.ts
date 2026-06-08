/**
 * /api/billing/claims/[claimId]/status-inquiries/[inquiryId]
 *
 * GET — return the full payer response for a single 276/277 inquiry so
 * billers can re-open an old payer status response without re-running
 * the inquiry. Includes the parsed response lines from
 * `claim_status_response_lines` and the raw payloads
 * (`raw_response_json`, `raw_response_x12`) stored on
 * `claim_status_inquiries` by AvailityJsonApiAdapter.persistClaimStatusResponse.
 */
import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function pickStatus(row: Row): string | null {
  return str(row["status"]) ?? str(row["inquiry_status"]) ?? null;
}

function pickStatusCode(row: Row): string | null {
  return (
    str(row["payer_status_code"]) ??
    str(row["status_code"]) ??
    str(row["response_status_code"]) ??
    str(row["status_category_code"]) ??
    null
  );
}

function pickStatusText(row: Row): string | null {
  const summary = row["response_summary"];
  let summaryText: string | null = null;
  if (typeof summary === "string") summaryText = str(summary);
  else if (summary && typeof summary === "object") {
    const obj = summary as Record<string, unknown>;
    summaryText = str(obj.description) ?? str(obj.message) ?? null;
  }
  return (
    str(row["payer_status_text"]) ??
    str(row["response_status_description"]) ??
    summaryText ??
    null
  );
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ claimId: string; inquiryId: string }> },
) {
  try {
    const { claimId, inquiryId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const guard = await requireBillingAccess({
      requestedOrganizationId: searchParams.get("organizationId"),
    });
    if (guard instanceof NextResponse) return guard;
    const organizationId = guard.organizationId;

    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Database not available" },
        { status: 500 },
      );
    }

    const inquiryResp = await (supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              eq: (k: string, v: string) => {
                maybeSingle: () => Promise<{
                  data: Row | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        };
      };
    })
      .from("claim_status_inquiries")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("claim_id", claimId)
      .eq("id", inquiryId)
      .maybeSingle();

    if (inquiryResp.error) {
      return NextResponse.json(
        { success: false, error: inquiryResp.error.message },
        { status: 500 },
      );
    }
    const row = inquiryResp.data;
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Inquiry not found" },
        { status: 404 },
      );
    }

    const linesResp = await (supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (k: string, v: string) => {
            eq: (k: string, v: string) => {
              order: (
                k: string,
                opts: { ascending: boolean },
              ) => Promise<{
                data: Row[] | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    })
      .from("claim_status_response_lines")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("claim_status_inquiry_id", inquiryId)
      .order("created_at", { ascending: true });

    if (linesResp.error) {
      return NextResponse.json(
        { success: false, error: linesResp.error.message },
        { status: 500 },
      );
    }

    const lines = (linesResp.data ?? [])
      .filter((r) => !r["archived_at"])
      .map((l) => ({
        id: str(l["id"]),
        status_category_code: str(l["status_category_code"]),
        status_code: str(l["status_code"]),
        entity_code: str(l["entity_code"]),
        status_effective_date: str(l["status_effective_date"]),
        total_charge_amount: num(l["total_charge_amount"]),
        paid_amount: num(l["paid_amount"]),
        check_eft_number: str(l["check_eft_number"]),
        payer_claim_control_number: str(l["payer_claim_control_number"]),
        service_date_from: str(l["service_date_from"]),
        service_date_to: str(l["service_date_to"]),
        message: str(l["message"]),
        raw_stc_segment: l["raw_stc_segment"] ?? null,
      }));

    return NextResponse.json({
      success: true,
      inquiry: {
        id: str(row["id"]),
        status: pickStatus(row),
        status_code: pickStatusCode(row),
        status_text: pickStatusText(row),
        requested_at: str(row["requested_at"]),
        received_at: str(row["received_at"]) ?? str(row["responded_at"]),
        created_at: str(row["created_at"]),
        external_transaction_id:
          str(row["external_transaction_id"]) ??
          str(row["availity_transaction_id"]),
        payer_id: str(row["payer_id"]),
        payer_name: str(row["payer_name"]),
        raw_response_json: row["raw_response_json"] ?? null,
        raw_response_x12: str(row["raw_response_x12"]),
      },
      lines,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
