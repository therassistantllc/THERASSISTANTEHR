export const US_STATE_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "PR", name: "Puerto Rico" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export const US_STATE_CODES: ReadonlySet<string> = new Set(
  US_STATE_OPTIONS.map((s) => s.code),
);

export const SEX_AT_BIRTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "intersex", label: "Intersex" },
  { value: "unknown", label: "Unknown" },
  { value: "declined", label: "Declined to answer" },
];

export const SEX_AT_BIRTH_VALUES: ReadonlySet<string> = new Set(
  SEX_AT_BIRTH_OPTIONS.map((o) => o.value),
);

export const GENDER_IDENTITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "transgender_female", label: "Transgender female" },
  { value: "transgender_male", label: "Transgender male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "two_spirit", label: "Two-spirit" },
  { value: "other", label: "Other" },
  { value: "declined", label: "Declined to answer" },
];

export const GENDER_IDENTITY_VALUES: ReadonlySet<string> = new Set(
  GENDER_IDENTITY_OPTIONS.map((o) => o.value),
);

export const GENDER_IDENTITY_FREE_TEXT_PREFIX = "other:";

export const PREFERRED_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "zh", label: "Chinese" },
  { value: "vi", label: "Vietnamese" },
  { value: "tl", label: "Tagalog" },
  { value: "ar", label: "Arabic" },
  { value: "fr", label: "French" },
  { value: "ht", label: "Haitian Creole" },
  { value: "ko", label: "Korean" },
  { value: "ru", label: "Russian" },
  { value: "pt", label: "Portuguese" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "hi", label: "Hindi" },
  { value: "pl", label: "Polish" },
  { value: "it", label: "Italian" },
  { value: "asl", label: "American Sign Language" },
  { value: "other", label: "Other" },
];

export const PREFERRED_LANGUAGE_VALUES: ReadonlySet<string> = new Set(
  PREFERRED_LANGUAGE_OPTIONS.map((o) => o.value),
);

export const PREFERRED_LANGUAGE_FREE_TEXT_PREFIX = "other:";

export function isValidStateCode(value: string): boolean {
  return US_STATE_CODES.has(value.toUpperCase());
}

export function isValidSexAtBirth(value: string): boolean {
  return SEX_AT_BIRTH_VALUES.has(value);
}

export function isValidGenderIdentity(value: string): boolean {
  if (GENDER_IDENTITY_VALUES.has(value)) return true;
  if (value.startsWith(GENDER_IDENTITY_FREE_TEXT_PREFIX)) {
    return value.slice(GENDER_IDENTITY_FREE_TEXT_PREFIX.length).trim().length > 0;
  }
  return false;
}

export function isValidPreferredLanguage(value: string): boolean {
  if (PREFERRED_LANGUAGE_VALUES.has(value)) return true;
  if (value.startsWith(PREFERRED_LANGUAGE_FREE_TEXT_PREFIX)) {
    return value.slice(PREFERRED_LANGUAGE_FREE_TEXT_PREFIX.length).trim().length > 0;
  }
  return false;
}
