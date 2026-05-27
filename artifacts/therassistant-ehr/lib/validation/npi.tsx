/**
 * NPI (National Provider Identifier) checksum validation.
 *
 * NPI is a 10-digit number. The check digit is computed using the Luhn
 * algorithm against the prefix "80840" + the first 9 NPI digits.
 *
 * See: 45 CFR 162.408 (HIPAA NPI standard) and the CMS NPPES technical spec.
 */
export function isValidNpi(npi: string | null | undefined): boolean {
  if (!npi) return false;
  const digits = String(npi).replace(/\D/g, "");
  if (digits.length !== 10) return false;

  const base = "80840" + digits.slice(0, 9);
  let sum = 0;
  // Luhn: double every second digit from the right (i.e. odd index from left
  // when length is 14 — see CMS check digit calculation table).
  for (let i = 0; i < base.length; i++) {
    let n = Number(base.charAt(i));
    if ((base.length - i) % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits.charAt(9));
}
