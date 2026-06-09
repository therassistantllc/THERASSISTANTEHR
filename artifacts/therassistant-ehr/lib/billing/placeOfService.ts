export const ALLOWED_PLACE_OF_SERVICE_CODES = ["11", "02"] as const;

export type AllowedPlaceOfServiceCode = (typeof ALLOWED_PLACE_OF_SERVICE_CODES)[number];

// Canonical default Place of Service codes. Use these instead of inline string
// literals so every claim-building path falls back to a value the app actually
// allows. (POS "10" is explicitly NOT allowed — see placeOfServiceWarning.)
export const DEFAULT_OFFICE_PLACE_OF_SERVICE: AllowedPlaceOfServiceCode = "11";
export const DEFAULT_TELEHEALTH_PLACE_OF_SERVICE: AllowedPlaceOfServiceCode = "02";

export function normalizePlaceOfService(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isAllowedPlaceOfService(value: unknown): value is AllowedPlaceOfServiceCode {
  const code = normalizePlaceOfService(value);
  return ALLOWED_PLACE_OF_SERVICE_CODES.includes(code as AllowedPlaceOfServiceCode);
}

export function isBlockedPlaceOfService(value: unknown): boolean {
  const code = normalizePlaceOfService(value);
  return code.length > 0 && !isAllowedPlaceOfService(code);
}

export function defaultPlaceOfService(isTelehealth: boolean): AllowedPlaceOfServiceCode {
  return isTelehealth ? DEFAULT_TELEHEALTH_PLACE_OF_SERVICE : DEFAULT_OFFICE_PLACE_OF_SERVICE;
}

export function placeOfServiceWarning(code: unknown): string | null {
  const normalized = normalizePlaceOfService(code);
  if (!normalized) return null;
  if (normalized === "10") {
    return "POS 10 is not allowed. Please correct this to 11 (office) or 02 (telehealth) before saving or batching.";
  }
  if (!isAllowedPlaceOfService(normalized)) {
    return `POS ${normalized} is not allowed. Please use 11 (office) or 02 (telehealth).`;
  }
  return null;
}
