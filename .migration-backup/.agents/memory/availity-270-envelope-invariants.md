---
name: Availity 270/271 envelope invariants
description: Which X12 envelope fields must be hard-set vs caller-controlled when generating eligibility 270s through Availity, and why.
---

The X12 005010X279A1 (270) generator for Availity must hard-set four envelope
fields and not allow callers to override them. A caller-overridable envelope
is the most common compliance failure for new Availity 270 implementations
because clearinghouse_connections schemas typically expose a `receiver_id`,
`gs_receiver_code`, and `x12_version` for historical reasons (other payers,
direct submission), and they get silently mis-populated.

The hard-set fields per Availity Batch EDI Companion Guide §6.2:

- ISA08 = Availity D&B number (single fixed value)
- GS03  = Availity D&B number (single fixed value)
- GS08  = `005010X279A1` (the only 270/271 version Availity accepts)
- ISA15 = derived directly from `connection.mode` (test → "T",
  production → "P"). The legacy `isa_usage_indicator` field is ignored.

**Why:** ISA15 mismatch with mode silently routes test payloads to
production payers (or vice versa) — the worst-case eligibility bug because
payer claim systems will reconcile against bogus inquiries. Fixing the
mismatch as a validator *warning* is not enough; the only safe design is to
make the mismatch unrepresentable by deriving ISA15 from `mode`.

**How to apply:** When adding a new 270/271 generation path (e.g., a real-
time SOAP wrapper in `AvailityRealtimeAdapter`, or a future batch
generator), always go through `buildAvaility270` in
`lib/edi/availity270/generate270.ts`. Do NOT build the ISA/GS envelope
inline in adapter code. If a payer is reachable only via direct submission
(not Availity), build a separate generator — do not parameterize this one.

Additionally: 1000A NM1*41 (submitter) and 1000B NM1*40 (receiver =
"AVAILITY" / Availity D&B) are required segments *before* any HL loop per
CG §6.3. Forgetting them causes 999 rejections at the Availity gateway.
