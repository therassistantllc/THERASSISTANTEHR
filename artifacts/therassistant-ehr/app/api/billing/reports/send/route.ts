/**
 * POST /api/billing/reports/send  (Task #781)
 *
 * Emails the same single-page Revenue Overview snapshot the Download
 * PDF button captures to one or more recipients. Respects the current
 * month + scope filters by re-running the same data fetch the page
 * uses (delegates to the GET handler in the parent route so the
 * payload is byte-for-byte identical).
 *
 * Auth: requires VIEW_BILLING in the caller's session; the recipient
 * list is caller-supplied (typically an outside accountant or board
 * member) and is NOT subject to the staff RBAC check.
 *
 * Returns 200 on send success, 400 on validation, 401/403 on auth,
 * 502 if Resend rejected the message.
 */
import { NextResponse } from "next/server";
import { requireBillingAccess } from "@/lib/billing/requireBillingAccess";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import { sendBillingReportEmail } from "@/lib/email/resend";
import { GET as getBillingReport } from "../route";

const MAX_RECIPIENTS = 10;
const MAX_NOTE_LEN = 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  recipients?: unknown;
  note?: unknown;
  month?: unknown;
  providerId?: unknown;
  organizationId?: unknown;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseRecipients(input: unknown): { ok: true; emails: string[] } | { ok: false; error: string } {
  let list: string[] = [];
  if (Array.isArray(input)) {
    list = input.map((v) => asString(v)).filter(Boolean);
  } else if (typeof input === "string") {
    list = input
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  const dedup = Array.from(new Set(list.map((e) => e.toLowerCase())));
  if (dedup.length === 0) {
    return { ok: false, error: "Add at least one recipient email." };
  }
  if (dedup.length > MAX_RECIPIENTS) {
    return { ok: false, error: `Send to ${MAX_RECIPIENTS} or fewer recipients at a time.` };
  }
  const bad = dedup.find((e) => !EMAIL_RE.test(e));
  if (bad) return { ok: false, error: `"${bad}" doesn't look like a valid email address.` };
  return { ok: true, emails: dedup };
}

function resolveBaseUrl(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    const url = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const host = forwardedHost || url.host;
    const proto = forwardedProto || url.protocol.replace(/:$/, "");
    return `${proto}://${host}`;
  } catch {
    return "";
  }
}

function formatMonthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month || "Current month";
  const d = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

type ReportData = {
  month?: string;
  claims?: { submitted: number; paid: number; deniedOrRejected: number; totalChargeSubmitted: number };
  payments?: { count: number; totalAmount: number };
  derived?: {
    collectionRate: number;
    netCollectionPct: number;
    averageDaysInAR: number | null;
    outstandingAR: number;
    topDenial: { carcCode: string; occurrences: number; payerName: string | null } | null;
  };
  aging?: {
    bucket0to30: { count: number; totalCharge: number };
    bucket31to60: { count: number; totalCharge: number };
    bucket61Plus: { count: number; totalCharge: number };
    totalOutstanding: number;
  };
  operational?: {
    unresolvedClaims: number;
    eraUnpostedCount: number;
    eraUnmatchedCount: number;
    authIssuesOpen: number;
  };
  payerPerformance?: Array<{ payerName: string; totalClaims: number; paidClaims: number; acceptanceRate: number; totalCharge: number }>;
};

function buildSnapshotHtml(p: ReportData): string {
  const c = p.claims;
  const d = p.derived;
  const ag = p.aging;
  const op = p.operational;
  const cell = (label: string, value: string) =>
    `<td style="padding:10px 12px;border:1px solid #e5e7eb;vertical-align:top;">
       <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
       <div style="font-size:16px;color:#10243f;font-weight:600;margin-top:2px;">${value}</div>
     </td>`;
  const topDenialLabel = d?.topDenial
    ? `${d.topDenial.carcCode}${d.topDenial.payerName ? ` · ${d.topDenial.payerName}` : ""} (${d.topDenial.occurrences}×)`
    : "—";

  const payerRows = (p.payerPerformance ?? [])
    .slice(0, 5)
    .map(
      (row) =>
        `<tr>
           <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;">${escapeHtml(row.payerName)}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${row.totalClaims}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${row.paidClaims}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${row.acceptanceRate}%</td>
           <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;">${money(row.totalCharge)}</td>
         </tr>`,
    )
    .join("");

  return `
    <h2 style="font-size:14px;color:#10243f;margin:16px 0 8px 0;text-transform:uppercase;letter-spacing:0.06em;">Executive Snapshot</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
      <tr>
        ${cell("Claims Submitted", String(c?.submitted ?? 0))}
        ${cell("Claims Paid", String(c?.paid ?? 0))}
        ${cell("Denials / Rejections", String(c?.deniedOrRejected ?? 0))}
      </tr>
      <tr>
        ${cell("Charges Submitted", money(c?.totalChargeSubmitted ?? 0))}
        ${cell("Payments Posted", money(p.payments?.totalAmount ?? 0))}
        ${cell("Outstanding AR", money(d?.outstandingAR ?? 0))}
      </tr>
      <tr>
        ${cell("Collection Rate", `${d?.collectionRate ?? 0}%`)}
        ${cell("Net Collection %", `${d?.netCollectionPct ?? 0}%`)}
        ${cell("Avg Days in AR", d?.averageDaysInAR != null ? String(Math.round(d.averageDaysInAR)) : "—")}
      </tr>
      <tr>
        ${cell("Top Denial", topDenialLabel)}
        ${cell("Unresolved Claims", String(op?.unresolvedClaims ?? 0))}
        ${cell("Unmatched ERAs", String(op?.eraUnmatchedCount ?? 0))}
      </tr>
    </table>
    ${
      ag
        ? `<h2 style="font-size:14px;color:#10243f;margin:16px 0 8px 0;text-transform:uppercase;letter-spacing:0.06em;">Aging Buckets</h2>
           <table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
             <tr>
               ${cell("0–30 days", `${ag.bucket0to30.count} · ${money(ag.bucket0to30.totalCharge)}`)}
               ${cell("31–60 days", `${ag.bucket31to60.count} · ${money(ag.bucket31to60.totalCharge)}`)}
               ${cell("61+ days", `${ag.bucket61Plus.count} · ${money(ag.bucket61Plus.totalCharge)}`)}
             </tr>
           </table>`
        : ""
    }
    ${
      payerRows
        ? `<h2 style="font-size:14px;color:#10243f;margin:16px 0 8px 0;text-transform:uppercase;letter-spacing:0.06em;">Top Payers</h2>
           <table style="border-collapse:collapse;width:100%;font-family:inherit;">
             <thead>
               <tr style="background:#f9fafb;">
                 <th style="padding:6px 10px;text-align:left;font-size:12px;color:#6b7280;">Payer</th>
                 <th style="padding:6px 10px;text-align:right;font-size:12px;color:#6b7280;">Claims</th>
                 <th style="padding:6px 10px;text-align:right;font-size:12px;color:#6b7280;">Paid</th>
                 <th style="padding:6px 10px;text-align:right;font-size:12px;color:#6b7280;">Acceptance</th>
                 <th style="padding:6px 10px;text-align:right;font-size:12px;color:#6b7280;">Charges</th>
               </tr>
             </thead>
             <tbody>${payerRows}</tbody>
           </table>`
        : ""
    }
  `;
}

function buildSnapshotText(p: ReportData): string {
  const c = p.claims;
  const d = p.derived;
  const ag = p.aging;
  const op = p.operational;
  const lines = [
    "EXECUTIVE SNAPSHOT",
    `  Claims Submitted:     ${c?.submitted ?? 0}`,
    `  Claims Paid:          ${c?.paid ?? 0}`,
    `  Denials/Rejections:   ${c?.deniedOrRejected ?? 0}`,
    `  Charges Submitted:    ${money(c?.totalChargeSubmitted ?? 0)}`,
    `  Payments Posted:      ${money(p.payments?.totalAmount ?? 0)}`,
    `  Outstanding AR:       ${money(d?.outstandingAR ?? 0)}`,
    `  Collection Rate:      ${d?.collectionRate ?? 0}%`,
    `  Net Collection %:     ${d?.netCollectionPct ?? 0}%`,
    `  Avg Days in AR:       ${d?.averageDaysInAR != null ? Math.round(d.averageDaysInAR) : "—"}`,
    `  Unresolved Claims:    ${op?.unresolvedClaims ?? 0}`,
    `  Unmatched ERAs:       ${op?.eraUnmatchedCount ?? 0}`,
  ];
  if (ag) {
    lines.push(
      "",
      "AGING BUCKETS",
      `  0–30 days:   ${ag.bucket0to30.count} claims · ${money(ag.bucket0to30.totalCharge)}`,
      `  31–60 days:  ${ag.bucket31to60.count} claims · ${money(ag.bucket31to60.totalCharge)}`,
      `  61+ days:    ${ag.bucket61Plus.count} claims · ${money(ag.bucket61Plus.totalCharge)}`,
    );
  }
  return lines.join("\n");
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as Payload | null;
    if (!payload) {
      return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const guard = await requireBillingAccess({
      requestedOrganizationId: asString(payload.organizationId) || null,
    });
    if (guard instanceof NextResponse) return guard;
    const { organizationId } = guard;

    const recipientsParsed = parseRecipients(payload.recipients);
    if (!recipientsParsed.ok) {
      return NextResponse.json({ success: false, error: recipientsParsed.error }, { status: 400 });
    }
    const note = asString(payload.note).slice(0, MAX_NOTE_LEN) || null;
    const month = asString(payload.month);
    const providerId = asString(payload.providerId);

    // Re-run the same query the page uses so the email contains the
    // exact same numbers — passing the caller's month + scope through.
    const baseUrl = resolveBaseUrl(request);
    const reportParams = new URLSearchParams({ organizationId, month });
    if (providerId) reportParams.set("providerId", providerId);
    const reportApiUrl = `${baseUrl || "http://localhost"}/api/billing/reports?${reportParams.toString()}`;
    const reportResponse = await getBillingReport(
      new Request(reportApiUrl, { headers: request.headers }),
    );
    const reportJson = (await reportResponse.json()) as ReportData & { success?: boolean; error?: string };
    if (!reportResponse.ok || reportJson.success === false) {
      return NextResponse.json(
        { success: false, error: reportJson.error || "Failed to compose report snapshot." },
        { status: 500 },
      );
    }

    // Look up the sender display name + practice name.
    const supabase = createServerSupabaseAdminClient();
    let practiceName = "Practice";
    let senderName: string | null = null;
    if (supabase) {
      const [{ data: orgRow }, staffCtx] = await Promise.all([
        supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
        requireAuthenticatedStaff().catch(() => null),
      ]);
      practiceName = (orgRow as { name?: string | null } | null)?.name || practiceName;
      const first = asString(staffCtx?.firstName);
      const last = asString(staffCtx?.lastName);
      const full = `${first} ${last}`.trim();
      senderName = full || asString(staffCtx?.email) || null;
    }

    const resolvedMonth = asString(reportJson.month) || month;

    // Build the live report URL with the caller's filters preserved so
    // recipients land on the same month + scope as the snapshot they got.
    const liveUrl = (() => {
      const params = new URLSearchParams({ organizationId });
      if (resolvedMonth) params.set("month", resolvedMonth);
      if (providerId) params.set("providerId", providerId);
      return `${baseUrl}/billing/reports?${params.toString()}`;
    })();

    const monthLabel = formatMonthLabel(resolvedMonth);
    const scopeLabel = providerId ? "Selected clinician" : "Practice (all clinicians)";

    const htmlSnapshot = buildSnapshotHtml(reportJson);
    const textSnapshot = buildSnapshotText(reportJson);

    const sendResult = await sendBillingReportEmail({
      to: recipientsParsed.emails,
      practiceName,
      monthLabel,
      scopeLabel,
      senderName,
      note,
      reportUrl: liveUrl,
      htmlSnapshot,
      textSnapshot,
    });

    if (!sendResult.ok) {
      return NextResponse.json({ success: false, error: sendResult.error }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      sent: {
        recipients: recipientsParsed.emails,
        providerId: sendResult.providerId,
        fromEmail: sendResult.fromEmail,
        monthLabel,
        scopeLabel,
      },
    });
  } catch (error) {
    console.error("Billing report send error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to send billing report" },
      { status: 500 },
    );
  }
}
