-- Migration: 20260530010000_clinical_notes_soap_alignment.sql
-- Purpose: Align clinical-note storage with the SOAP editor.
--
-- Background: encounter_clinical_notes was originally created with columns
-- (subjective, interventions, plan). A later migration added (objective,
-- assessment) without removing `interventions`. The editor exposes
-- subjective/objective/assessment/plan, so the save path was writing the
-- middle slot into `interventions` while the editor read from `objective` —
-- those two never met, and `assessment` was never persisted at all.
--
-- This migration backfills any existing `interventions` content into
-- `objective` (without overwriting anything already there), then drops the
-- redundant column so the schema matches the editor 1:1.
--
-- note_templates had the same shape mismatch: `default_interventions` with no
-- `default_objective` / `default_assessment`. Rename the column and add the
-- missing one so templates seed the same fields the editor reads.

-- 1) encounter_clinical_notes: collapse interventions into objective.

update public.encounter_clinical_notes
   set objective = interventions
 where interventions is not null
   and interventions <> ''
   and (objective is null or objective = '');

alter table public.encounter_clinical_notes
  drop column if exists interventions;

-- The plan column comment still referenced "interventions"; refresh it so
-- future schema dumps don't re-introduce the old vocabulary.
comment on column public.encounter_clinical_notes.plan
  is 'SOAP P: treatment plan, follow-up, referrals, next steps';

-- 2) note_templates: rename default_interventions -> default_objective and
--    add default_assessment.

alter table public.note_templates
  add column if not exists default_objective text not null default '',
  add column if not exists default_assessment text not null default '';

update public.note_templates
   set default_objective = default_interventions
 where default_interventions is not null
   and default_interventions <> ''
   and (default_objective is null or default_objective = '');

alter table public.note_templates
  drop column if exists default_interventions;

select pg_notify('pgrst', 'reload schema');
