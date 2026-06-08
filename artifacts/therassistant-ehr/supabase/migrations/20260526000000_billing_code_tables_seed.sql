-- ============================================================================
-- Migration: 20260526000000_billing_code_tables_seed.sql
-- Purpose:   Add procedure_codes (CPT/HCPCS) reference table and seed a
--            behavioral-health subset for both diagnosis_codes (ICD-10-CM)
--            and procedure_codes so the Charge Capture comboboxes have
--            real data to search against and validate against.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- procedure_codes (CPT / HCPCS reference)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.procedure_codes (
  id                uuid        primary key default gen_random_uuid(),
  code              text        not null,
  code_system       text        not null default 'CPT' check (code_system in ('CPT', 'HCPCS')),
  description       text        not null,
  description_short text,
  is_active         boolean     not null default true,
  effective_date    date,
  expiration_date   date,
  created_at        timestamptz not null default now()
);

create unique index if not exists idx_procedure_codes_code_system
  on public.procedure_codes (code, code_system);

create index if not exists idx_procedure_codes_code_prefix
  on public.procedure_codes (code text_pattern_ops)
  where is_active = true;

create index if not exists idx_procedure_codes_description_fts
  on public.procedure_codes using gin (to_tsvector('english', description));

alter table public.procedure_codes enable row level security;
drop policy if exists procedure_codes_read on public.procedure_codes;
create policy procedure_codes_read on public.procedure_codes
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: ICD-10-CM behavioral-health subset (no-op if codes already exist)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.diagnosis_codes (code, code_system, description, is_active)
values
  ('F32.0',  'ICD-10-CM', 'Major depressive disorder, single episode, mild', true),
  ('F32.1',  'ICD-10-CM', 'Major depressive disorder, single episode, moderate', true),
  ('F32.2',  'ICD-10-CM', 'Major depressive disorder, single episode, severe without psychotic features', true),
  ('F32.9',  'ICD-10-CM', 'Major depressive disorder, single episode, unspecified', true),
  ('F33.0',  'ICD-10-CM', 'Major depressive disorder, recurrent, mild', true),
  ('F33.1',  'ICD-10-CM', 'Major depressive disorder, recurrent, moderate', true),
  ('F33.2',  'ICD-10-CM', 'Major depressive disorder, recurrent severe without psychotic features', true),
  ('F33.9',  'ICD-10-CM', 'Major depressive disorder, recurrent, unspecified', true),
  ('F41.0',  'ICD-10-CM', 'Panic disorder without agoraphobia', true),
  ('F41.1',  'ICD-10-CM', 'Generalized anxiety disorder', true),
  ('F41.8',  'ICD-10-CM', 'Other specified anxiety disorders', true),
  ('F41.9',  'ICD-10-CM', 'Anxiety disorder, unspecified', true),
  ('F42.2',  'ICD-10-CM', 'Mixed obsessional thoughts and acts', true),
  ('F42.9',  'ICD-10-CM', 'Obsessive-compulsive disorder, unspecified', true),
  ('F43.0',  'ICD-10-CM', 'Acute stress reaction', true),
  ('F43.10', 'ICD-10-CM', 'Post-traumatic stress disorder, unspecified', true),
  ('F43.11', 'ICD-10-CM', 'Post-traumatic stress disorder, acute', true),
  ('F43.12', 'ICD-10-CM', 'Post-traumatic stress disorder, chronic', true),
  ('F43.20', 'ICD-10-CM', 'Adjustment disorder, unspecified', true),
  ('F43.21', 'ICD-10-CM', 'Adjustment disorder with depressed mood', true),
  ('F43.22', 'ICD-10-CM', 'Adjustment disorder with anxiety', true),
  ('F43.23', 'ICD-10-CM', 'Adjustment disorder with mixed anxiety and depressed mood', true),
  ('F43.25', 'ICD-10-CM', 'Adjustment disorder with mixed disturbance of emotions and conduct', true),
  ('F50.00', 'ICD-10-CM', 'Anorexia nervosa, unspecified', true),
  ('F50.81', 'ICD-10-CM', 'Binge eating disorder', true),
  ('F60.3',  'ICD-10-CM', 'Borderline personality disorder', true),
  ('F84.0',  'ICD-10-CM', 'Autistic disorder', true),
  ('F90.0',  'ICD-10-CM', 'Attention-deficit hyperactivity disorder, predominantly inattentive type', true),
  ('F90.1',  'ICD-10-CM', 'Attention-deficit hyperactivity disorder, predominantly hyperactive type', true),
  ('F90.2',  'ICD-10-CM', 'Attention-deficit hyperactivity disorder, combined type', true),
  ('F90.9',  'ICD-10-CM', 'Attention-deficit hyperactivity disorder, unspecified type', true),
  ('F31.9',  'ICD-10-CM', 'Bipolar disorder, unspecified', true),
  ('F31.81', 'ICD-10-CM', 'Bipolar II disorder', true),
  ('F10.20', 'ICD-10-CM', 'Alcohol dependence, uncomplicated', true),
  ('F11.20', 'ICD-10-CM', 'Opioid dependence, uncomplicated', true),
  ('F14.20', 'ICD-10-CM', 'Cocaine dependence, uncomplicated', true),
  ('Z63.0',  'ICD-10-CM', 'Problems in relationship with spouse or partner', true),
  ('Z63.4',  'ICD-10-CM', 'Disappearance and death of family member', true),
  ('Z65.8',  'ICD-10-CM', 'Other specified problems related to psychosocial circumstances', true)
on conflict (code, code_system) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: CPT/HCPCS behavioral-health subset
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.procedure_codes (code, code_system, description, is_active)
values
  -- Psychotherapy
  ('90791', 'CPT',   'Psychiatric diagnostic evaluation', true),
  ('90792', 'CPT',   'Psychiatric diagnostic evaluation with medical services', true),
  ('90832', 'CPT',   'Psychotherapy, 30 minutes with patient', true),
  ('90834', 'CPT',   'Psychotherapy, 45 minutes with patient', true),
  ('90837', 'CPT',   'Psychotherapy, 60 minutes with patient', true),
  ('90785', 'CPT',   'Interactive complexity (add-on)', true),
  ('90839', 'CPT',   'Psychotherapy for crisis, first 60 minutes', true),
  ('90840', 'CPT',   'Psychotherapy for crisis, each additional 30 minutes', true),
  ('90846', 'CPT',   'Family psychotherapy (without the patient present), 50 minutes', true),
  ('90847', 'CPT',   'Family psychotherapy (with patient present), 50 minutes', true),
  ('90849', 'CPT',   'Multiple-family group psychotherapy', true),
  ('90853', 'CPT',   'Group psychotherapy (other than of a multiple-family group)', true),
  -- Testing / Assessment
  ('96130', 'CPT',   'Psychological testing evaluation services, first hour', true),
  ('96131', 'CPT',   'Psychological testing evaluation services, each additional hour', true),
  ('96136', 'CPT',   'Psychological or neuropsychological test administration, first 30 minutes', true),
  ('96137', 'CPT',   'Psychological or neuropsychological test administration, each additional 30 minutes', true),
  ('96156', 'CPT',   'Health behavior assessment or reassessment', true),
  ('96158', 'CPT',   'Health behavior intervention, individual, first 30 minutes', true),
  ('96159', 'CPT',   'Health behavior intervention, individual, each additional 15 minutes', true),
  -- E/M (commonly used in BH)
  ('99202', 'CPT',   'Office or other outpatient visit, new patient, low MDM', true),
  ('99203', 'CPT',   'Office or other outpatient visit, new patient, moderate MDM', true),
  ('99204', 'CPT',   'Office or other outpatient visit, new patient, moderate-high MDM', true),
  ('99205', 'CPT',   'Office or other outpatient visit, new patient, high MDM', true),
  ('99212', 'CPT',   'Office or other outpatient visit, established patient, straightforward MDM', true),
  ('99213', 'CPT',   'Office or other outpatient visit, established patient, low MDM', true),
  ('99214', 'CPT',   'Office or other outpatient visit, established patient, moderate MDM', true),
  ('99215', 'CPT',   'Office or other outpatient visit, established patient, high MDM', true),
  -- HCPCS behavioral health
  ('H0001', 'HCPCS', 'Alcohol and/or drug assessment', true),
  ('H0002', 'HCPCS', 'Behavioral health screening to determine eligibility for admission', true),
  ('H0004', 'HCPCS', 'Behavioral health counseling and therapy, per 15 minutes', true),
  ('H0005', 'HCPCS', 'Alcohol and/or drug services; group counseling by a clinician', true),
  ('H0006', 'HCPCS', 'Alcohol and/or drug services; case management', true),
  ('H0031', 'HCPCS', 'Mental health assessment, by non-physician', true),
  ('H0032', 'HCPCS', 'Mental health service plan development by non-physician', true),
  ('H0038', 'HCPCS', 'Self-help/peer services, per 15 minutes', true),
  ('H2011', 'HCPCS', 'Crisis intervention service, per 15 minutes', true),
  ('H2014', 'HCPCS', 'Skills training and development, per 15 minutes', true),
  ('H2017', 'HCPCS', 'Psychosocial rehabilitation services, per 15 minutes', true),
  ('T1017', 'HCPCS', 'Targeted case management, each 15 minutes', true)
on conflict (code, code_system) do nothing;

select pg_notify('pgrst', 'reload schema');
