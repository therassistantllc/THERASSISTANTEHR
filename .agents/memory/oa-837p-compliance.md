---
name: OA 837P compliance landmines
description: Office Ally Professional 837P Companion Guide gotchas that have bitten this codebase and will silently malform or misroute claims.
---

- ISA02 and ISA04 are fixed-length 10-char fields. Emitting `""` malforms the envelope and OA rejects the file. Always pad with exactly 10 spaces.
- Loop 1000B NM103 receiver name is literally `OFFICE ALLY` (with the space), per CG p. 11. Legacy `OFFICEALLY` works in practice but is non-conformant — keep it warning-only.
- The `OATEST` filename keyword (CG p. 8) is the **only** test/production switch — CG explicitly says ISA15 is ignored. An `OATEST_` filename submitted in P mode routes to OA test; a P-mode filename without it routes to production. Gate the keyword strictly on `usageIndicator === "T"`.
- Loop 1000A PER is **required** by TR3 005010X222A1 and must include at least one of TE/EM/FX qualifiers. `PER*IC*<name>` alone (no TE/EM/FX) fails IG syntax. Persist a submitter contact phone/email on the clearinghouse connection and validate with the **same** sanitization the emitter uses (digits-only phone, trimmed email) so values like `"---"` or whitespace can't slip past validation and yield an empty PER02.
- Billing provider address (Loop 2010AA N3) must be a physical address — OA's CG prohibits PO boxes here. Pay-to (2010AB) is where you put the PO box.

**Why:** all of these produce silent failures — either OA returns a syntactic 999/TA1 reject (envelope, PER) or, worse, the claim is processed in the wrong environment (OATEST keyword). None are caught by generic 5010 validators that don't read OA's specific CG.

**How to apply:** any change to either 837P generator (`lib/clearinghouse/x12/officeAlly837P.ts` or `lib/edi/officeAlly837p/generate837p.ts`) must preserve these invariants. New connection fields that affect X12 emission must also be wired through `app/api/settings/clearinghouse/route.ts` (GET select list + POST insert + PATCH allowedFields + normalize) **and** `app/settings/clearinghouse/ClearinghouseSettingsClient.tsx` (Connection type + FormState + EMPTY_FORM + form fields), or operators can't fix validation failures without raw SQL.
