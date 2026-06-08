-- File: supabase/migrations/20260520050000_clinical_form_engine.sql
-- Purpose: Configurable clinical form engine.
-- Adds three tables that let admins define new clinical forms as data
-- (definition + typed fields + scoring) and let clinicians fill them out
-- inside an encounter. Submissions store both the responses and a snapshot
-- of the definition + computed score so historical reads stay correct even
-- if the definition is later edited.
--
-- Idempotent: re-runs safely (create-if-not-exists + do-blocks).

-- ─── clinical_forms ──────────────────────────────────────────────────────────
create table if not exists public.clinical_forms (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  code                text        not null,
  title               text        not null,
  description         text,
  scoring_kind        text        not null default 'none'
    check (scoring_kind in ('none', 'sum')),
  scoring_bands       jsonb       not null default '[]'::jsonb,
  high_risk_rule      jsonb,
  is_builtin          boolean     not null default false,
  is_active           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by_user_id  uuid,
  updated_by_user_id  uuid,
  archived_at         timestamptz,
  unique (organization_id, code)
);

create index if not exists clinical_forms_org_active_idx
  on public.clinical_forms (organization_id, is_active);

-- ─── clinical_form_fields ────────────────────────────────────────────────────
-- Typed field definitions for each form, ordered by `position`.
create table if not exists public.clinical_form_fields (
  id                uuid        primary key default gen_random_uuid(),
  form_id           uuid        not null references public.clinical_forms(id) on delete cascade,
  organization_id   uuid        not null references public.organizations(id) on delete cascade,
  position          integer     not null default 0,
  field_key         text        not null,
  label             text        not null,
  help_text         text,
  kind              text        not null
    check (kind in ('text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox')),
  required          boolean     not null default false,
  options           jsonb       not null default '[]'::jsonb,
  scoring_weight    numeric(8,3) not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (form_id, field_key)
);

create index if not exists clinical_form_fields_form_position_idx
  on public.clinical_form_fields (form_id, position);

-- ─── clinical_form_submissions ───────────────────────────────────────────────
create table if not exists public.clinical_form_submissions (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  form_id             uuid        not null references public.clinical_forms(id) on delete restrict,
  form_code           text        not null,
  form_title          text        not null,
  encounter_id        uuid        references public.encounters(id) on delete cascade,
  client_id           uuid        not null references public.clients(id) on delete cascade,
  provider_id         uuid,
  definition_snapshot jsonb       not null,
  responses           jsonb       not null default '{}'::jsonb,
  score               numeric(10,3),
  severity            text,
  high_risk           boolean     not null default false,
  high_risk_reason    text,
  status              text        not null default 'submitted'
    check (status in ('draft', 'submitted')),
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by_user_id  uuid,
  updated_by_user_id  uuid,
  archived_at         timestamptz
);

create index if not exists clinical_form_submissions_encounter_idx
  on public.clinical_form_submissions (encounter_id, created_at desc);

create index if not exists clinical_form_submissions_client_form_idx
  on public.clinical_form_submissions (client_id, form_code, created_at desc);

create index if not exists clinical_form_submissions_org_idx
  on public.clinical_form_submissions (organization_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.clinical_forms              enable row level security;
alter table public.clinical_form_fields        enable row level security;
alter table public.clinical_form_submissions   enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='clinical_forms'
      and policyname='clinical_forms_org_isolation'
  ) then
    create policy clinical_forms_org_isolation on public.clinical_forms
      for all
      using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text))
      with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='clinical_form_fields'
      and policyname='clinical_form_fields_org_isolation'
  ) then
    create policy clinical_form_fields_org_isolation on public.clinical_form_fields
      for all
      using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text))
      with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text));
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='clinical_form_submissions'
      and policyname='clinical_form_submissions_org_isolation'
  ) then
    create policy clinical_form_submissions_org_isolation on public.clinical_form_submissions
      for all
      using (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text))
      with check (organization_id::text = coalesce(auth.jwt() ->> 'organization_id', organization_id::text));
  end if;
end $$;

-- ─── Built-in form seeds (PHQ-9, GAD-7) ──────────────────────────────────────
-- Seed one copy per organization, idempotent on (organization_id, code).
-- Definitions live in the table; the renderer reads them like any other form.
do $$
declare
  org record;
  phq_id uuid;
  gad_id uuid;
  phq_questions text[] := array[
    'Little interest or pleasure in doing things',
    'Feeling down, depressed, or hopeless',
    'Trouble falling or staying asleep, or sleeping too much',
    'Feeling tired or having little energy',
    'Poor appetite or overeating',
    'Feeling bad about yourself — or that you are a failure',
    'Trouble concentrating on things',
    'Moving or speaking so slowly that other people noticed (or the opposite — being fidgety/restless)',
    'Thoughts that you would be better off dead, or of hurting yourself'
  ];
  gad_questions text[] := array[
    'Feeling nervous, anxious, or on edge',
    'Not being able to stop or control worrying',
    'Worrying too much about different things',
    'Trouble relaxing',
    'Being so restless that it is hard to sit still',
    'Becoming easily annoyed or irritable',
    'Feeling afraid as if something awful might happen'
  ];
  q text;
  i int;
  screener_options jsonb := jsonb_build_array(
    jsonb_build_object('label','Not at all','value',0),
    jsonb_build_object('label','Several days','value',1),
    jsonb_build_object('label','More than half the days','value',2),
    jsonb_build_object('label','Nearly every day','value',3)
  );
begin
  for org in select id from public.organizations loop
    -- PHQ-9
    insert into public.clinical_forms
      (organization_id, code, title, description, scoring_kind, scoring_bands, high_risk_rule, is_builtin, is_active)
    values (
      org.id,
      'phq9',
      'PHQ-9 (Depression)',
      'Patient Health Questionnaire — 9 items. Sum 0–27.',
      'sum',
      jsonb_build_array(
        jsonb_build_object('min',0,'max',4,'label','Minimal'),
        jsonb_build_object('min',5,'max',9,'label','Mild'),
        jsonb_build_object('min',10,'max',14,'label','Moderate'),
        jsonb_build_object('min',15,'max',19,'label','Moderately severe'),
        jsonb_build_object('min',20,'max',27,'label','Severe')
      ),
      jsonb_build_object(
        'kind','field_gte',
        'fieldKey','q9',
        'gte',1,
        'reason','PHQ-9 item 9 indicates self-harm risk; review immediately.'
      ),
      true,
      true
    )
    on conflict (organization_id, code) do update set
      title = excluded.title,
      description = excluded.description,
      scoring_kind = excluded.scoring_kind,
      scoring_bands = excluded.scoring_bands,
      high_risk_rule = excluded.high_risk_rule,
      is_builtin = true,
      updated_at = now()
    returning id into phq_id;

    -- Replace fields atomically per form to keep seeds aligned with definition.
    delete from public.clinical_form_fields where form_id = phq_id;
    i := 1;
    foreach q in array phq_questions loop
      insert into public.clinical_form_fields
        (form_id, organization_id, position, field_key, label, kind, required, options, scoring_weight)
      values (
        phq_id, org.id, i, 'q' || i,
        i || '. ' || q,
        'radio', true, screener_options, 1
      );
      i := i + 1;
    end loop;

    -- GAD-7
    insert into public.clinical_forms
      (organization_id, code, title, description, scoring_kind, scoring_bands, high_risk_rule, is_builtin, is_active)
    values (
      org.id,
      'gad7',
      'GAD-7 (Anxiety)',
      'Generalized Anxiety Disorder 7-item. Sum 0–21.',
      'sum',
      jsonb_build_array(
        jsonb_build_object('min',0,'max',4,'label','Minimal'),
        jsonb_build_object('min',5,'max',9,'label','Mild'),
        jsonb_build_object('min',10,'max',14,'label','Moderate'),
        jsonb_build_object('min',15,'max',21,'label','Severe')
      ),
      null,
      true,
      true
    )
    on conflict (organization_id, code) do update set
      title = excluded.title,
      description = excluded.description,
      scoring_kind = excluded.scoring_kind,
      scoring_bands = excluded.scoring_bands,
      high_risk_rule = excluded.high_risk_rule,
      is_builtin = true,
      updated_at = now()
    returning id into gad_id;

    delete from public.clinical_form_fields where form_id = gad_id;
    i := 1;
    foreach q in array gad_questions loop
      insert into public.clinical_form_fields
        (form_id, organization_id, position, field_key, label, kind, required, options, scoring_weight)
      values (
        gad_id, org.id, i, 'q' || i,
        i || '. ' || q,
        'radio', true, screener_options, 1
      );
      i := i + 1;
    end loop;
  end loop;
end $$;
