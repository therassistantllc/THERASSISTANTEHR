-- Allow the ERA posting engine to record the submitted charge (CLP03) as a
-- debit-style ledger effect alongside payer payments, adjustments, and patient
-- responsibility. This keeps patient-balance recalculation from losing the
-- charge side when a payment posts from an ERA.
alter table public.era_posting_ledger_entries
  drop constraint if exists era_posting_ledger_entries_entry_type_check;

alter table public.era_posting_ledger_entries
  add constraint era_posting_ledger_entries_entry_type_check
  check (entry_type = any (array[
    'charge'::text,
    'insurance_payment'::text,
    'contractual_adjustment'::text,
    'patient_responsibility'::text,
    'other_adjustment'::text
  ]));
