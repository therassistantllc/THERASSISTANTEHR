-- Task #464 — Historical resolution notes per RARC code
--
-- Adds two columns to public.claim_notes so the "Denials by RARC" detail
-- panel can show prior resolution notes for the same remark code across
-- every claim in the office (not just the currently selected claim).
--
--   rarc_codes      — array of RARC codes the note relates to. Set
--                     automatically when a note is added to a denied claim
--                     (inferred from era_claim_payments / claim_workqueue_items)
--                     and/or supplied explicitly by the caller.
--   resolved_denial — biller marks the note as the one that closed the
--                     denial (got paid, accepted as corrected, appeal
--                     overturned). Powers the "Resolved by" filter.
--
-- Both default to safe values so existing inserters keep working.

alter table public.claim_notes
  add column if not exists rarc_codes text[] not null default '{}'::text[];

alter table public.claim_notes
  add column if not exists resolved_denial boolean not null default false;

-- GIN index so we can ask "give me every note tagged with RARC N10" without
-- scanning the whole table.
create index if not exists idx_claim_notes_rarc_codes
  on public.claim_notes using gin (rarc_codes);

create index if not exists idx_claim_notes_org_rarc_created
  on public.claim_notes (organization_id, created_at desc)
  where array_length(rarc_codes, 1) > 0;

-- Backfill rarc_codes for existing notes on denied claims by unioning what
-- the ERA layer and the workqueue layer already know. Best-effort only —
-- notes on non-denied claims stay with rarc_codes = '{}'.
with claim_rarc as (
  select cn.id as note_id,
         array_agg(distinct upper(btrim(r))) filter (where r is not null and btrim(r) <> '') as codes
  from public.claim_notes cn
  join public.professional_claims pc on pc.id = cn.claim_id
  left join lateral (
    select unnest(coalesce(ecp.rarc_codes, '{}'::text[])) as r
    from public.era_claim_payments ecp
    where ecp.professional_claim_id = cn.claim_id
    union all
    select cwi.rarc_code as r
    from public.claim_workqueue_items cwi
    where cwi.claim_id = cn.claim_id
      and cwi.rarc_code is not null
  ) src on true
  where pc.claim_status = 'denied'
    and (cn.rarc_codes is null or array_length(cn.rarc_codes, 1) is null)
  group by cn.id
)
update public.claim_notes cn
   set rarc_codes = claim_rarc.codes
  from claim_rarc
 where cn.id = claim_rarc.note_id
   and claim_rarc.codes is not null
   and array_length(claim_rarc.codes, 1) > 0;

-- Force PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';
