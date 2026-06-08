---
name: Availity 837P / Batch EDI compliance landmines
description: Availity Batch EDI Companion Guide (v.20260429) gotchas that have bitten this codebase and will silently malform or misroute claims. Replaces the prior Office Ally compliance notes after the full OA → Availity vendor rip-out.
---

- **ISA15 is the routing switch — opposite of Office Ally.** Availity honors ISA15 (T/P) directly. A `P` usage indicator submitted in the QA / test environment **will forward the transaction to the payer**. Test mode must be enforced by setting ISA15="T" on the connection; do NOT rely on filename keywords (no `OATEST` equivalent exists).

- **Envelope identifiers are fixed by Availity.** ISA08 = `030240928` (Availity Dun & Bradstreet number), GS03 = `030240928`, 1000B NM103 = literal `Availity` (mixed case per CG), NM109 = `030240928`. ISA02 and ISA04 remain fixed 10-char fields (10 spaces if unused).

- **ISA06 sender ID.** Availity Batch EDI CG specifies `AV09311993` (+5 blank spaces) as the sender-side ID code in the envelope for inbound submissions. Individual submitters are configured per-org; default this to the Availity-assigned submitter ID, not to a filename keyword.

- **Loop 1000A PER is required** by TR3 005010X222A1 and must include at least one of TE/EM/FX qualifiers. `PER*IC*<name>` alone (no TE/EM/FX) fails IG syntax. Persist a submitter contact phone/email on the clearinghouse connection and validate with the **same** sanitization the emitter uses (digits-only phone, trimmed email) so values like `"---"` or whitespace can't slip past validation and yield an empty PER02.

- **Billing provider address (Loop 2010AA N3) must be physical.** TR3 005010X222A1 prohibits PO boxes here. Pay-to (2010AB) is where you put the PO box.

- **Response file extensions.** Availity returns acknowledgments and reports with conventional X12 extensions: `.ACK` (sender acknowledgment), `.TA1` (interchange-level), `.999` (functional ack), `.ibr` / `.ebr` (Inbound/Edit Batch Report), `.era` (835 remittance). The OA-style proprietary filenames are gone — parsers must dispatch by extension, not legacy substring.

**Why:** all of these produce silent failures — either Availity returns a syntactic 999/TA1 reject (envelope, PER) or, worse, the claim is processed in the wrong environment (ISA15 routing). None are caught by generic 5010 validators that don't read Availity's specific Companion Guide. The ISA15 behavior is the single most dangerous regression vs. Office Ally and is easy to overlook because the field exists in both.

**How to apply:** any change to either 837P generator (`lib/clearinghouse/x12/availity837P.ts` or `lib/edi/availity837p/generate837p.ts`) must preserve these invariants. New connection fields that affect X12 emission must also be wired through `app/api/settings/clearinghouse/route.ts` (GET select list + POST insert + PATCH allowedFields + normalize) **and** `app/settings/clearinghouse/ClearinghouseSettingsClient.tsx` (Connection type + FormState + EMPTY_FORM + form fields), or operators can't fix validation failures without raw SQL.
