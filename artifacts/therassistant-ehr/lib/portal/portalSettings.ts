export const PORTAL_SETTINGS_KEY = "organization.portal_settings";

export type PortalSettings = {
  portalDisplayName: string;
  welcomeHeadingTemplate: string;
  welcomeMessage: string;
  supportMessage: string;
  accentColor: string;
};

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  portalDisplayName: "",
  welcomeHeadingTemplate: "Hi, {patientName}",
  welcomeMessage: "Welcome to your portal. Review upcoming appointments, balances, and shared documents.",
  supportMessage: "Only documents your care team has shared appear here. To request another document, please contact {practiceName}.",
  accentColor: "#1D4ED8",
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanColor(value: unknown): string {
  const raw = cleanText(value);
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return DEFAULT_PORTAL_SETTINGS.accentColor;
}

export function normalizePortalSettings(value: unknown): PortalSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    portalDisplayName: cleanText(input.portalDisplayName),
    welcomeHeadingTemplate: cleanText(input.welcomeHeadingTemplate) || DEFAULT_PORTAL_SETTINGS.welcomeHeadingTemplate,
    welcomeMessage: cleanText(input.welcomeMessage) || DEFAULT_PORTAL_SETTINGS.welcomeMessage,
    supportMessage: cleanText(input.supportMessage) || DEFAULT_PORTAL_SETTINGS.supportMessage,
    accentColor: cleanColor(input.accentColor),
  };
}

export function applyPortalTemplate(
  template: string,
  tokens: { patientName?: string; practiceName?: string },
): string {
  const base = cleanText(template);
  if (!base) return "";
  return base
    .replaceAll("{patientName}", cleanText(tokens.patientName))
    .replaceAll("{practiceName}", cleanText(tokens.practiceName));
}
