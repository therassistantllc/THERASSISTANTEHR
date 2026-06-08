/**
 * Back-compat re-export. The schema guard moved to
 * `lib/supabase/__tests__/schemaGuard.ts` so every fake supabase client
 * across modules can wire it (Task #233). The two posting-engine fakes
 * that imported it from here continue to work.
 */
export {
  SchemaGuardError,
  validateInsert,
  validateWritePayload,
  _resetSchemaCacheForTests,
} from "../../../supabase/__tests__/schemaGuard";
