-- PP-3: allow 'payment_transfer' in era_posting_ledger_entries.source_type so
-- paired transferred_balance ledger writes don't violate the check constraint.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'era_posting_ledger_entries'
      and constraint_name = 'era_posting_ledger_source_type_check'
  ) then
    alter table public.era_posting_ledger_entries
      drop constraint era_posting_ledger_source_type_check;
  end if;
  alter table public.era_posting_ledger_entries
    add constraint era_posting_ledger_source_type_check
    check (source_type in (
      'era_835','manual_insurance','patient_payment',
      'payment_transfer','recoupment','refund','reversal'
    ));
end$$;
