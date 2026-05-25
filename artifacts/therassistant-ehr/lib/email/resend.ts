import { Resend } from "resend";

const REPLIT_CONNECTORS_HOSTNAME = process.env.REPLIT_CONNECTORS_HOSTNAME;
const X_REPLIT_TOKEN =
  process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

type ResendCredentials = {
  apiKey: string;
  fromEmail?: string;
};

async function fetchResendCredentialsFromConnector(): Promise<ResendCredentials | null> {
  if (!REPLIT_CONNECTORS_HOSTNAME || !X_REPLIT_TOKEN) return null;

  try {
    const response = await fetch(
      `https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names=resend`,
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN,
        },
      },
    );
    if (!response.ok) return null;
    const json = (await response.json()) as { items?: Array<Record<string, unknown>> };
    const item = json.items?.[0];
    if (!item) return null;
    const settings = (item.settings ?? {}) as Record<string, unknown>;
    const apiKey =
      (typeof settings.api_key === "string" && settings.api_key) ||
      (typeof (settings as { apiKey?: unknown }).apiKey === "string" && (settings as { apiKey: string }).apiKey) ||
      "";
    const fromEmail =
      (typeof settings.from_email === "string" && settings.from_email) ||
      (typeof (settings as { fromEmail?: unknown }).fromEmail === "string" && (settings as { fromEmail: string }).fromEmail) ||
      undefined;
    if (!apiKey) return null;
    return { apiKey, fromEmail };
  } catch {
    return null;
  }
}

async function resolveResendCredentials(): Promise<ResendCredentials | null> {
  const envKey = process.env.RESEND_API_KEY?.trim();
  if (envKey) {
    return {
      apiKey: envKey,
      fromEmail: process.env.RESEND_FROM_EMAIL?.trim() || undefined,
    };
  }
  return fetchResendCredentialsFromConnector();
}

export type SendIntakeEmailInput = {
  to: string;
  patientName: string;
  practiceName: string;
  intakeUrl: string;
  expiresAt: string | null;
};

export type SendIntakeEmailResult =
  | { ok: true; providerId: string | null; fromEmail: string }
  | { ok: false; error: string };

function formatExpiration(expiresAt: string | null): string {
  if (!expiresAt) return "soon";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendIntakeEmail(input: SendIntakeEmailInput): Promise<SendIntakeEmailResult> {
  const credentials = await resolveResendCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. Connect Resend in Integrations (or set RESEND_API_KEY) before emailing intake links.",
    };
  }

  const fromEmail =
    credentials.fromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "onboarding@resend.dev";

  const expirationText = formatExpiration(input.expiresAt);
  const safeName = input.patientName.trim() || "there";
  const safePractice = input.practiceName.trim() || "your care team";

  const subject = `${safePractice}: complete your intake before your visit`;
  const textBody =
    `Hello ${safeName},\n\n` +
    `${safePractice} has sent you a secure intake form to complete before your visit.\n\n` +
    `Open your form: ${input.intakeUrl}\n\n` +
    `This link expires on ${expirationText}. If the link has expired, contact the practice and we'll send a new one.\n\n` +
    `Thank you,\n${safePractice}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto;">
      <p>Hello ${escapeHtml(safeName)},</p>
      <p><strong>${escapeHtml(safePractice)}</strong> has sent you a secure intake form to complete before your visit.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(input.intakeUrl)}" style="background:#2563eb;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Open your intake form</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">Or paste this link into your browser:<br/>
        <a href="${escapeHtml(input.intakeUrl)}">${escapeHtml(input.intakeUrl)}</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">This link expires on <strong>${escapeHtml(expirationText)}</strong>. If it has expired by the time you open it, please contact the practice and we will send a fresh link.</p>
      <p style="margin-top: 32px;">Thank you,<br/>${escapeHtml(safePractice)}</p>
    </div>
  `;

  try {
    const client = new Resend(credentials.apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: input.to,
      subject,
      text: textBody,
      html: htmlBody,
    });

    if (result.error) {
      const message = result.error.message || "Resend rejected the email";
      return { ok: false, error: message };
    }
    return { ok: true, providerId: result.data?.id ?? null, fromEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { ok: false, error: message };
  }
}

export type SendCobUpdateEmailInput = {
  to: string;
  patientName: string;
  practiceName: string;
  updateUrl: string;
  expiresAt: string | null;
};

export type SendCobUpdateEmailResult =
  | { ok: true; providerId: string | null; fromEmail: string }
  | { ok: false; error: string };

export async function sendCobUpdateEmail(
  input: SendCobUpdateEmailInput,
): Promise<SendCobUpdateEmailResult> {
  const credentials = await resolveResendCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. Connect Resend in Integrations (or set RESEND_API_KEY) before emailing insurance update links.",
    };
  }

  const fromEmail =
    credentials.fromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "onboarding@resend.dev";

  const expirationText = formatExpiration(input.expiresAt);
  const safeName = input.patientName.trim() || "there";
  const safePractice = input.practiceName.trim() || "your care team";

  const subject = `${safePractice}: confirm your insurance so we can bill correctly`;
  const textBody =
    `Hello ${safeName},\n\n` +
    `${safePractice} needs you to confirm your current insurance so we can bill your recent visit to the correct payer.\n\n` +
    `Open the secure form: ${input.updateUrl}\n\n` +
    `It takes about a minute — you'll confirm which plan is primary, let us know if you have any other coverage, and optionally upload a photo of your insurance card.\n\n` +
    `This link expires on ${expirationText}. If the link has expired, contact the practice and we'll send a new one.\n\n` +
    `Thank you,\n${safePractice}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto;">
      <p>Hello ${escapeHtml(safeName)},</p>
      <p><strong>${escapeHtml(safePractice)}</strong> needs you to confirm your current insurance so we can bill your recent visit to the correct payer.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(input.updateUrl)}" style="background:#2563eb;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Confirm your insurance</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">It takes about a minute — you'll confirm which plan is primary, let us know if you have any other coverage, and optionally upload a photo of your insurance card.</p>
      <p style="font-size: 13px; color: #4b5563;">Or paste this link into your browser:<br/>
        <a href="${escapeHtml(input.updateUrl)}">${escapeHtml(input.updateUrl)}</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">This link expires on <strong>${escapeHtml(expirationText)}</strong>. If it has expired by the time you open it, please contact the practice and we will send a fresh link.</p>
      <p style="margin-top: 32px;">Thank you,<br/>${escapeHtml(safePractice)}</p>
    </div>
  `;

  try {
    const client = new Resend(credentials.apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: input.to,
      subject,
      text: textBody,
      html: htmlBody,
    });

    if (result.error) {
      const message = result.error.message || "Resend rejected the email";
      return { ok: false, error: message };
    }
    return { ok: true, providerId: result.data?.id ?? null, fromEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { ok: false, error: message };
  }
}

export type PayerDocumentationAttachment = {
  filename: string;
  content: Buffer;
};

export type SendPayerDocumentationEmailInput = {
  to: string;
  payerName: string;
  practiceName: string;
  claimNumber: string;
  patientName: string;
  dateOfService: string | null;
  note: string | null;
  attachments: PayerDocumentationAttachment[];
};

export type SendPayerDocumentationEmailResult =
  | { ok: true; providerId: string | null; fromEmail: string }
  | { ok: false; error: string };

export async function sendPayerDocumentationEmail(
  input: SendPayerDocumentationEmailInput,
): Promise<SendPayerDocumentationEmailResult> {
  const credentials = await resolveResendCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. Connect Resend in Integrations (or set RESEND_API_KEY) before sending documentation to payers.",
    };
  }

  const fromEmail =
    credentials.fromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "onboarding@resend.dev";

  const safePayer = input.payerName.trim() || "Insurance Payer";
  const safePractice = input.practiceName.trim() || "the billing office";
  const safePatient = input.patientName.trim() || "the patient";
  const dosText = input.dateOfService
    ? new Date(input.dateOfService).toLocaleDateString()
    : "the date of service on file";

  const subject = `Medical records — claim ${input.claimNumber} (${safePatient})`;
  const noteLine = input.note ? `\n\nNotes from the biller:\n${input.note}` : "";
  const fileList = input.attachments.map((a) => `  • ${a.filename}`).join("\n");
  const textBody =
    `${safePayer} records team,\n\n` +
    `Please find attached the documentation requested for the claim below.\n\n` +
    `Claim number: ${input.claimNumber}\n` +
    `Patient: ${safePatient}\n` +
    `Date of service: ${dosText}\n` +
    `Attachments (${input.attachments.length}):\n${fileList}` +
    `${noteLine}\n\n` +
    `Thank you,\n${safePractice}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 640px; margin: 0 auto;">
      <p>${escapeHtml(safePayer)} records team,</p>
      <p>Please find attached the documentation requested for the claim below.</p>
      <table style="font-size:14px;border-collapse:collapse;margin:12px 0;">
        <tbody>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Claim number</td><td style="padding:4px 0;"><strong>${escapeHtml(input.claimNumber)}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Patient</td><td style="padding:4px 0;">${escapeHtml(safePatient)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Date of service</td><td style="padding:4px 0;">${escapeHtml(dosText)}</td></tr>
        </tbody>
      </table>
      <p style="font-size:13px;color:#374151;"><strong>Attachments (${input.attachments.length}):</strong></p>
      <ul style="font-size:13px;color:#374151;margin:0 0 12px 18px;padding:0;">
        ${input.attachments.map((a) => `<li>${escapeHtml(a.filename)}</li>`).join("")}
      </ul>
      ${input.note ? `<p style="font-size:13px;color:#374151;white-space:pre-wrap;"><strong>Notes from the biller:</strong><br/>${escapeHtml(input.note)}</p>` : ""}
      <p style="margin-top:24px;">Thank you,<br/>${escapeHtml(safePractice)}</p>
    </div>
  `;

  try {
    const client = new Resend(credentials.apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: input.to,
      subject,
      text: textBody,
      html: htmlBody,
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    if (result.error) {
      const message = result.error.message || "Resend rejected the email";
      return { ok: false, error: message };
    }
    return { ok: true, providerId: result.data?.id ?? null, fromEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { ok: false, error: message };
  }
}

export type SendEligibilityRoutedEmailInput = {
  to: string;
  assigneeName: string;
  routedByName: string | null;
  patientName: string | null;
  appointmentAt: string | null;
  kind: "clinician" | "admin";
  note: string | null;
  inboxUrl: string;
  // Task #702: scheduled re-ping for items still open past the threshold.
  // Only affects the subject line so the assignee can spot it in their
  // inbox; body + opt-out preference are identical to the first send.
  isReminder?: boolean;
  reminderNumber?: number;
};

export type SendEligibilityRoutedEmailResult =
  | { ok: true; providerId: string | null; fromEmail: string }
  | { ok: false; error: string };

export async function sendEligibilityRoutedEmail(
  input: SendEligibilityRoutedEmailInput,
): Promise<SendEligibilityRoutedEmailResult> {
  const credentials = await resolveResendCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. Connect Resend in Integrations (or set RESEND_API_KEY) before sending eligibility routing notifications.",
    };
  }

  const fromEmail =
    credentials.fromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "onboarding@resend.dev";

  const safeAssignee = input.assigneeName.trim() || "there";
  const kindLabel =
    input.kind === "clinician"
      ? "verify a patient's insurance before their next visit"
      : "follow up on an eligibility issue";
  const routedBy = input.routedByName?.trim()
    ? `${input.routedByName.trim()} routed`
    : "A biller routed";
  const patientLine = input.patientName?.trim()
    ? `Patient: ${input.patientName.trim()}`
    : null;
  const apptLine = input.appointmentAt
    ? `Appointment: ${formatExpiration(input.appointmentAt)}`
    : null;
  const noteLine = input.note?.trim() ? `Note: ${input.note.trim()}` : null;

  const baseSubject =
    input.kind === "clinician"
      ? "Action needed: verify patient insurance"
      : "Action needed: resolve eligibility issue";
  const subject = input.isReminder
    ? `Reminder${input.reminderNumber && input.reminderNumber > 1 ? ` (#${input.reminderNumber})` : ""}: ${baseSubject}`
    : baseSubject;

  const lines = [
    `Hello ${safeAssignee},`,
    "",
    `${routedBy} an eligibility issue to your inbox — please ${kindLabel}.`,
    "",
    ...[patientLine, apptLine, noteLine].filter(Boolean) as string[],
    "",
    `Open My Inbox: ${input.inboxUrl}`,
    "",
    "You can opt out of these emails from My Inbox.",
  ];
  const textBody = lines.join("\n");

  const detailsHtml = [
    patientLine ? `<li>${escapeHtml(patientLine)}</li>` : "",
    apptLine ? `<li>${escapeHtml(apptLine)}</li>` : "",
    noteLine ? `<li>${escapeHtml(noteLine)}</li>` : "",
  ]
    .filter(Boolean)
    .join("");

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto;">
      <p>Hello ${escapeHtml(safeAssignee)},</p>
      <p>${escapeHtml(routedBy)} an eligibility issue to your inbox — please ${escapeHtml(kindLabel)}.</p>
      ${detailsHtml ? `<ul style="font-size:13px;color:#374151;margin:8px 0 16px 18px;padding:0;">${detailsHtml}</ul>` : ""}
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(input.inboxUrl)}" style="background:#1D4ED8;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Open My Inbox</a>
      </p>
      <p style="font-size: 12px; color: #6b7280;">You're receiving this because an eligibility issue was routed to you. You can opt out of these emails from the My Inbox screen.</p>
    </div>
  `;

  try {
    const client = new Resend(credentials.apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: input.to,
      subject,
      text: textBody,
      html: htmlBody,
    });
    if (result.error) {
      const message = result.error.message || "Resend rejected the email";
      return { ok: false, error: message };
    }
    return { ok: true, providerId: result.data?.id ?? null, fromEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { ok: false, error: message };
  }
}

export type SendPortalInviteEmailInput = {
  to: string;
  patientName: string;
  practiceName: string;
  portalUrl: string;
  expiresAt: string | null;
};

export type SendPortalInviteEmailResult =
  | { ok: true; providerId: string | null; fromEmail: string }
  | { ok: false; error: string };

export async function sendPortalInviteEmail(
  input: SendPortalInviteEmailInput,
): Promise<SendPortalInviteEmailResult> {
  const credentials = await resolveResendCredentials();
  if (!credentials) {
    return {
      ok: false,
      error:
        "Email is not configured. Connect Resend in Integrations (or set RESEND_API_KEY) before emailing portal invites.",
    };
  }

  const fromEmail =
    credentials.fromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "onboarding@resend.dev";

  const expirationText = formatExpiration(input.expiresAt);
  const safeName = input.patientName.trim() || "there";
  const safePractice = input.practiceName.trim() || "your care team";

  const subject = `${safePractice}: your patient portal access`;
  const textBody =
    `Hello ${safeName},\n\n` +
    `${safePractice} has invited you to access your patient portal.\n\n` +
    `Open your portal: ${input.portalUrl}\n\n` +
    `This link expires on ${expirationText}. If the link has expired, contact the practice and we'll send a new one.\n\n` +
    `Thank you,\n${safePractice}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto;">
      <p>Hello ${escapeHtml(safeName)},</p>
      <p><strong>${escapeHtml(safePractice)}</strong> has invited you to access your patient portal.</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(input.portalUrl)}" style="background:#2563eb;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Open your patient portal</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">Or paste this link into your browser:<br/>
        <a href="${escapeHtml(input.portalUrl)}">${escapeHtml(input.portalUrl)}</a>
      </p>
      <p style="font-size: 13px; color: #4b5563;">This link expires on <strong>${escapeHtml(expirationText)}</strong>. If it has expired by the time you open it, please contact the practice and we will send a fresh link.</p>
      <p style="margin-top: 32px;">Thank you,<br/>${escapeHtml(safePractice)}</p>
    </div>
  `;

  try {
    const client = new Resend(credentials.apiKey);
    const result = await client.emails.send({
      from: fromEmail,
      to: input.to,
      subject,
      text: textBody,
      html: htmlBody,
    });

    if (result.error) {
      const message = result.error.message || "Resend rejected the email";
      return { ok: false, error: message };
    }
    return { ok: true, providerId: result.data?.id ?? null, fromEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email";
    return { ok: false, error: message };
  }
}
