-- File: supabase/seed/workqueue_mailroom_billing_seed.sql
-- Purpose: Seed workqueue, mailroom, charge capture, claims, and 837P batch records
--          so every billing-related page shows real demo data.
--
-- All records use org_id 11111111-1111-1111-1111-111111111111 (demo org).
-- Fixed UUIDs are used throughout so this script is safe to run multiple times.
-- All INSERTs use ON CONFLICT DO NOTHING.

do $$
declare
  v_org_id uuid := '11111111-1111-1111-1111-111111111111';

  -- Demo client UUIDs (all hex: a-f, 0-9)
  v_c1 uuid := 'cc100001-0000-0000-0000-000000000001';
  v_c2 uuid := 'cc100001-0000-0000-0000-000000000002';
  v_c3 uuid := 'cc100001-0000-0000-0000-000000000003';
  v_c4 uuid := 'cc100001-0000-0000-0000-000000000004';
  v_c5 uuid := 'cc100001-0000-0000-0000-000000000005';

  -- Demo appointment UUIDs
  v_a1 uuid := 'aa200001-0000-0000-0000-000000000001';
  v_a2 uuid := 'aa200001-0000-0000-0000-000000000002';
  v_a3 uuid := 'aa200001-0000-0000-0000-000000000003';
  v_a4 uuid := 'aa200001-0000-0000-0000-000000000004';
  v_a5 uuid := 'aa200001-0000-0000-0000-000000000005';
  v_a6 uuid := 'aa200001-0000-0000-0000-000000000006';
  v_a7 uuid := 'aa200001-0000-0000-0000-000000000007';
  v_a8 uuid := 'aa200001-0000-0000-0000-000000000008';

  -- Demo encounter UUIDs
  v_e1 uuid := 'ee300001-0000-0000-0000-000000000001';
  v_e2 uuid := 'ee300001-0000-0000-0000-000000000002';
  v_e3 uuid := 'ee300001-0000-0000-0000-000000000003';
  v_e4 uuid := 'ee300001-0000-0000-0000-000000000004';
  v_e5 uuid := 'ee300001-0000-0000-0000-000000000005';
  v_e6 uuid := 'ee300001-0000-0000-0000-000000000006';
  v_e7 uuid := 'ee300001-0000-0000-0000-000000000007';
  v_e8 uuid := 'ee300001-0000-0000-0000-000000000008';

  -- Demo professional claim UUIDs (ac = valid hex)
  v_pc1 uuid := 'ac400001-0000-0000-0000-000000000001';
  v_pc2 uuid := 'ac400001-0000-0000-0000-000000000002';
  v_pc3 uuid := 'ac400001-0000-0000-0000-000000000003';
  v_pc4 uuid := 'ac400001-0000-0000-0000-000000000004';
  v_pc5 uuid := 'ac400001-0000-0000-0000-000000000005';

  -- Demo batch UUIDs
  v_b1 uuid := 'bb500001-0000-0000-0000-000000000001';
  v_b2 uuid := 'bb500001-0000-0000-0000-000000000002';

  -- Demo mailroom item UUIDs (ab = valid hex)
  v_m1 uuid := 'ab600001-0000-0000-0000-000000000001';
  v_m2 uuid := 'ab600001-0000-0000-0000-000000000002';
  v_m3 uuid := 'ab600001-0000-0000-0000-000000000003';
  v_m4 uuid := 'ab600001-0000-0000-0000-000000000004';
  v_m5 uuid := 'ab600001-0000-0000-0000-000000000005';
  v_m6 uuid := 'ab600001-0000-0000-0000-000000000006';
  v_m7 uuid := 'ab600001-0000-0000-0000-000000000007';
  v_m8 uuid := 'ab600001-0000-0000-0000-000000000008';

  -- Real provider UUID from the database
  v_provider uuid := '22222222-2222-2222-2222-222222222222';

begin
  -- Only seed if the demo org exists
  if not exists (select 1 from public.organizations where id = v_org_id) then
    raise notice 'Demo org % not found — skipping billing seed.', v_org_id;
    return;
  end if;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 1. DEMO CLIENTS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.clients (id, organization_id, first_name, last_name, date_of_birth, sex_at_birth, phone, email, city, state, postal_code, created_at, updated_at)
  values
    (v_c1, v_org_id, 'Sarah',   'Johnson',  '1985-03-14', 'F', '303-555-0101', 'sarah.johnson@example.com',  'Denver',      'CO', '80202', now() - interval '180 days', now()),
    (v_c2, v_org_id, 'Marcus',  'Lee',      '1979-07-22', 'M', '303-555-0102', 'marcus.lee@example.com',     'Boulder',     'CO', '80301', now() - interval '150 days', now()),
    (v_c3, v_org_id, 'Dana',    'Patel',    '1992-11-05', 'F', '303-555-0103', 'dana.patel@example.com',     'Aurora',      'CO', '80012', now() - interval '120 days', now()),
    (v_c4, v_org_id, 'James',   'Rivera',   '1968-04-30', 'M', '303-555-0104', 'james.rivera@example.com',   'Lakewood',    'CO', '80215', now() - interval '90 days',  now()),
    (v_c5, v_org_id, 'Priya',   'Thompson', '1995-09-18', 'F', '303-555-0105', 'priya.thompson@example.com', 'Fort Collins','CO', '80521', now() - interval '60 days',  now())
  on conflict (id) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 2. DEMO APPOINTMENTS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.appointments (id, organization_id, client_id, provider_id, scheduled_start_at, scheduled_end_at, appointment_status, appointment_type, created_at, updated_at)
  values
    (v_a1, v_org_id, v_c1, v_provider, now() - interval '60 days', now() - interval '60 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '61 days', now()),
    (v_a2, v_org_id, v_c2, v_provider, now() - interval '55 days', now() - interval '55 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '56 days', now()),
    (v_a3, v_org_id, v_c3, v_provider, now() - interval '50 days', now() - interval '50 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '51 days', now()),
    (v_a4, v_org_id, v_c4, v_provider, now() - interval '45 days', now() - interval '45 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '46 days', now()),
    (v_a5, v_org_id, v_c1, v_provider, now() - interval '40 days', now() - interval '40 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '41 days', now()),
    (v_a6, v_org_id, v_c2, v_provider, now() - interval '35 days', now() - interval '35 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '36 days', now()),
    (v_a7, v_org_id, v_c5, v_provider, now() - interval '30 days', now() - interval '30 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '31 days', now()),
    (v_a8, v_org_id, v_c3, v_provider, now() - interval '20 days', now() - interval '20 days' + interval '50 min', 'completed', 'individual_therapy', now() - interval '21 days', now())
  on conflict (id) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 3. DEMO ENCOUNTERS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.encounters (id, organization_id, appointment_id, client_id, provider_id, encounter_status, service_date, started_at, ended_at, required_billing_fields_complete, created_at, updated_at)
  values
    (v_e1, v_org_id, v_a1, v_c1, v_provider, 'completed', (now() - interval '60 days')::date, now() - interval '60 days', now() - interval '60 days' + interval '50 min', true,  now() - interval '60 days', now()),
    (v_e2, v_org_id, v_a2, v_c2, v_provider, 'completed', (now() - interval '55 days')::date, now() - interval '55 days', now() - interval '55 days' + interval '50 min', true,  now() - interval '55 days', now()),
    (v_e3, v_org_id, v_a3, v_c3, v_provider, 'completed', (now() - interval '50 days')::date, now() - interval '50 days', now() - interval '50 days' + interval '50 min', false, now() - interval '50 days', now()),
    (v_e4, v_org_id, v_a4, v_c4, v_provider, 'completed', (now() - interval '45 days')::date, now() - interval '45 days', now() - interval '45 days' + interval '50 min', true,  now() - interval '45 days', now()),
    (v_e5, v_org_id, v_a5, v_c1, v_provider, 'completed', (now() - interval '40 days')::date, now() - interval '40 days', now() - interval '40 days' + interval '50 min', true,  now() - interval '40 days', now()),
    (v_e6, v_org_id, v_a6, v_c2, v_provider, 'completed', (now() - interval '35 days')::date, now() - interval '35 days', now() - interval '35 days' + interval '50 min', false, now() - interval '35 days', now()),
    (v_e7, v_org_id, v_a7, v_c5, v_provider, 'completed', (now() - interval '30 days')::date, now() - interval '30 days', now() - interval '30 days' + interval '50 min', true,  now() - interval '30 days', now()),
    (v_e8, v_org_id, v_a8, v_c3, v_provider, 'completed', (now() - interval '20 days')::date, now() - interval '20 days', now() - interval '20 days' + interval '50 min', true,  now() - interval '20 days', now())
  on conflict (id) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 4. CHARGE CAPTURE ITEMS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Ready for claim
    ('c0000001-0000-0000-0000-000000000001', v_org_id, v_e1, v_c1, v_provider, v_a1,
     'encounter', v_e1, 'ready_for_claim',
     (now() - interval '60 days')::date,
     array['F32.1', 'Z71.1'],
     '[{"procedure_code":"90837","units":1,"charge_amount":175.00,"modifiers":[]},{"procedure_code":"90785","units":1,"charge_amount":35.00,"modifiers":[]}]'::jsonb,
     210.00, '11', '[]'::jsonb, now() - interval '60 days', now() - interval '2 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Claim already created
    ('c0000001-0000-0000-0000-000000000002', v_org_id, v_e2, v_c2, v_provider, v_a2,
     'encounter', v_e2, 'claim_created',
     (now() - interval '55 days')::date,
     array['F41.1'],
     '[{"procedure_code":"90834","units":1,"charge_amount":145.00,"modifiers":[]}]'::jsonb,
     145.00, '11', '[]'::jsonb, now() - interval '55 days', now() - interval '5 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Blocked - missing info
    ('c0000001-0000-0000-0000-000000000003', v_org_id, v_e3, v_c3, v_provider, v_a3,
     'encounter', v_e3, 'blocked',
     (now() - interval '50 days')::date,
     array['F33.0'],
     '[{"procedure_code":"90837","units":1,"charge_amount":175.00,"modifiers":[]}]'::jsonb,
     175.00, '11',
     '[{"code":"MISSING_INSURANCE_POLICY","message":"No active insurance policy found for patient"},{"code":"MISSING_AUTH","message":"Prior authorization required for this payer"}]'::jsonb,
     now() - interval '50 days', now() - interval '1 day')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Claim created
    ('c0000001-0000-0000-0000-000000000004', v_org_id, v_e4, v_c4, v_provider, v_a4,
     'encounter', v_e4, 'claim_created',
     (now() - interval '45 days')::date,
     array['F32.9', 'Z79.899'],
     '[{"procedure_code":"90837","units":1,"charge_amount":175.00,"modifiers":["95"]}]'::jsonb,
     175.00, '02', '[]'::jsonb, now() - interval '45 days', now() - interval '7 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Ready for claim
    ('c0000001-0000-0000-0000-000000000005', v_org_id, v_e5, v_c1, v_provider, v_a5,
     'encounter', v_e5, 'ready_for_claim',
     (now() - interval '40 days')::date,
     array['F32.1', 'F41.0'],
     '[{"procedure_code":"90834","units":1,"charge_amount":145.00,"modifiers":[]}]'::jsonb,
     145.00, '11', '[]'::jsonb, now() - interval '40 days', now() - interval '3 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Blocked - missing auth
    ('c0000001-0000-0000-0000-000000000006', v_org_id, v_e6, v_c2, v_provider, v_a6,
     'encounter', v_e6, 'blocked',
     (now() - interval '35 days')::date,
     array['F41.1', 'F40.10'],
     '[{"procedure_code":"90837","units":1,"charge_amount":175.00,"modifiers":[]}]'::jsonb,
     175.00, '11',
     '[{"code":"ELIGIBILITY_NOT_VERIFIED","message":"Eligibility has not been verified for this date of service"}]'::jsonb,
     now() - interval '35 days', now() - interval '4 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Claim created
    ('c0000001-0000-0000-0000-000000000007', v_org_id, v_e7, v_c5, v_provider, v_a7,
     'encounter', v_e7, 'claim_created',
     (now() - interval '30 days')::date,
     array['F32.0'],
     '[{"procedure_code":"90834","units":1,"charge_amount":145.00,"modifiers":["95"]}]'::jsonb,
     145.00, '02', '[]'::jsonb, now() - interval '30 days', now() - interval '10 days')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  insert into public.charge_capture_items
    (id, organization_id, encounter_id, client_id, provider_id, appointment_id, source_object_type, source_object_id, charge_status, service_date, diagnosis_codes, service_lines, total_charge, place_of_service, blocker_reasons, created_at, updated_at)
  values
    -- Ready for claim
    ('c0000001-0000-0000-0000-000000000008', v_org_id, v_e8, v_c3, v_provider, v_a8,
     'encounter', v_e8, 'ready_for_claim',
     (now() - interval '20 days')::date,
     array['F33.1', 'Z71.1'],
     '[{"procedure_code":"90837","units":1,"charge_amount":175.00,"modifiers":[]}]'::jsonb,
     175.00, '11', '[]'::jsonb, now() - interval '20 days', now() - interval '1 day')
  on conflict (encounter_id) where archived_at is null and charge_status <> 'voided' do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 5. PROFESSIONAL CLAIMS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.professional_claims
    (id, organization_id, patient_id, appointment_id, claim_number, patient_account_number, claim_status, total_charge, place_of_service, diagnosis_codes, first_billed_date, last_billed_date, billing_notes, created_at, updated_at)
  values
    (v_pc1, v_org_id, v_c2, v_a2,
     'CLM-2026-001', 'ACC-20260001',
     'ready_for_batch', 145.00, '11', array['F41.1'],
     (now() - interval '53 days')::date, (now() - interval '53 days')::date,
     'Auto-created from charge capture. Ready for 837P batch.', now() - interval '53 days', now() - interval '5 days'),

    (v_pc2, v_org_id, v_c4, v_a4,
     'CLM-2026-002', 'ACC-20260002',
     'submitted', 175.00, '02', array['F32.9'],
     (now() - interval '43 days')::date, (now() - interval '43 days')::date,
     'Submitted via 837P batch B2026-01.', now() - interval '43 days', now() - interval '7 days'),

    (v_pc3, v_org_id, v_c5, v_a7,
     'CLM-2026-003', 'ACC-20260003',
     'denied', 145.00, '02', array['F32.0'],
     (now() - interval '28 days')::date, (now() - interval '28 days')::date,
     'Denied CARC 97 — service not covered. Needs appeal or rebill.', now() - interval '28 days', now() - interval '10 days'),

    (v_pc4, v_org_id, v_c1, v_a1,
     'CLM-2026-004', 'ACC-20260004',
     'paid', 210.00, '11', array['F32.1', 'Z71.1'],
     (now() - interval '58 days')::date, (now() - interval '58 days')::date,
     'Paid in full — $168 allowed, $42 write-off.', now() - interval '58 days', now() - interval '20 days'),

    (v_pc5, v_org_id, v_c1, v_a5,
     'CLM-2026-005', 'ACC-20260005',
     'ready_for_batch', 145.00, '11', array['F32.1', 'F41.0'],
     (now() - interval '38 days')::date, (now() - interval '38 days')::date,
     'Validated and ready for next 837P batch.', now() - interval '38 days', now() - interval '3 days')
  on conflict (id) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 6. 837P BATCHES
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.claim_837p_batches
    (id, organization_id, batch_number, batch_status, claim_count, total_charge_amount, generated_file_name, submitted_at, created_at, updated_at)
  values
    (v_b1, v_org_id, 'B2026-01', 'accepted',
     1, 175.00, '837P_B2026-01_20260415.edi',
     now() - interval '40 days', now() - interval '43 days', now() - interval '30 days'),
    (v_b2, v_org_id, 'B2026-02', 'submitted',
     2, 290.00, '837P_B2026-02_20260507.edi',
     now() - interval '12 days', now() - interval '15 days', now() - interval '5 days')
  on conflict (organization_id, batch_number) where archived_at is null do nothing;

  -- Link claims to batches
  insert into public.claim_837p_batch_claims (id, organization_id, batch_id, professional_claim_id, created_at)
  values
    ('bc000001-0000-0000-0000-000000000001', v_org_id, v_b1, v_pc2, now() - interval '43 days'),
    ('bc000001-0000-0000-0000-000000000002', v_org_id, v_b2, v_pc1, now() - interval '15 days'),
    ('bc000001-0000-0000-0000-000000000003', v_org_id, v_b2, v_pc5, now() - interval '15 days')
  on conflict (organization_id, professional_claim_id) where archived_at is null do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 7. WORKQUEUE ITEMS  (15 open billing tasks)
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.workqueue_items
    (id, organization_id, source_object_type, source_object_id, client_id, encounter_id, work_type, title, description, status, priority, context_payload, created_at, updated_at)
  values
    -- Eligibility tasks
    ('b0000001-0000-0000-0000-000000000001', v_org_id, 'client', v_c2, v_c2, null,
     'eligibility_check',
     'Eligibility not verified — Marcus Lee',
     'Patient eligibility has not been checked for the upcoming session. Verify coverage before next appointment.',
     'open', 'high',
     jsonb_build_object('patient_name','Marcus Lee','last_checked_days_ago',32,'payer','BlueCross BlueShield'),
     now() - interval '5 days', now()),

    ('b0000001-0000-0000-0000-000000000002', v_org_id, 'client', v_c5, v_c5, null,
     'eligibility_check',
     'Eligibility expiring — Priya Thompson',
     'Insurance policy expires within 30 days. Re-verify coverage and collect updated insurance card.',
     'open', 'normal',
     jsonb_build_object('patient_name','Priya Thompson','policy_expiry_date',(now() + interval '25 days')::date::text,'payer','Aetna'),
     now() - interval '3 days', now()),

    -- Denial tasks
    ('b0000001-0000-0000-0000-000000000003', v_org_id, 'claim', v_pc3, v_c5, v_e7,
     'claim_denial',
     'Claim denied — CARC 97 — Priya Thompson',
     'Claim CLM-2026-003 denied with CARC 97 (Service not covered). Determine if resubmission, appeal, or patient billing is appropriate.',
     'open', 'urgent',
     jsonb_build_object('claim_number','CLM-2026-003','carc_code','97','carc_description','Service not covered','patient_name','Priya Thompson','denial_date',(now() - interval '10 days')::date::text,'amount_denied',145.00),
     now() - interval '10 days', now()),

    ('b0000001-0000-0000-0000-000000000004', v_org_id, 'claim', v_pc2, v_c4, v_e4,
     'claim_denial',
     'Claim requires follow-up — CLM-2026-002',
     'Claim submitted 7 days ago with no response from payer. Follow up with clearinghouse for status update.',
     'in_progress', 'high',
     jsonb_build_object('claim_number','CLM-2026-002','days_since_submission',7,'patient_name','James Rivera','payer','United Healthcare'),
     now() - interval '7 days', now()),

    -- Missing info tasks
    ('b0000001-0000-0000-0000-000000000005', v_org_id, 'encounter', v_e3, v_c3, v_e3,
     'missing_info',
     'Missing insurance policy — Dana Patel',
     'Encounter cannot be billed: no active insurance policy on file. Contact patient to obtain current insurance information.',
     'open', 'high',
     jsonb_build_object('patient_name','Dana Patel','encounter_date',(now() - interval '50 days')::date::text,'blocker','MISSING_INSURANCE_POLICY'),
     now() - interval '50 days', now()),

    ('b0000001-0000-0000-0000-000000000006', v_org_id, 'encounter', v_e3, v_c3, v_e3,
     'missing_info',
     'Prior auth required — Dana Patel',
     'Payer requires prior authorization for 90837. Obtain auth number before submitting claim.',
     'open', 'high',
     jsonb_build_object('patient_name','Dana Patel','procedure_code','90837','payer','Medicaid','blocker','MISSING_AUTH'),
     now() - interval '50 days', now()),

    ('b0000001-0000-0000-0000-000000000007', v_org_id, 'encounter', v_e6, v_c2, v_e6,
     'missing_info',
     'Eligibility not verified for DOS — Marcus Lee',
     'Charge blocked: eligibility was not verified for the date of service. Run eligibility check before proceeding.',
     'open', 'normal',
     jsonb_build_object('patient_name','Marcus Lee','dos',(now() - interval '35 days')::date::text,'blocker','ELIGIBILITY_NOT_VERIFIED'),
     now() - interval '35 days', now()),

    -- AR follow-up tasks
    ('b0000001-0000-0000-0000-000000000008', v_org_id, 'claim', v_pc1, v_c2, v_e2,
     'ar_follow_up',
     'AR follow-up — CLM-2026-001 > 30 days',
     'Claim is 30+ days in AR with no response. Initiate follow-up with BlueCross BlueShield.',
     'open', 'high',
     jsonb_build_object('claim_number','CLM-2026-001','patient_name','Marcus Lee','days_in_ar',35,'payer','BlueCross BlueShield','charge_amount',145.00),
     now() - interval '35 days', now()),

    ('b0000001-0000-0000-0000-000000000009', v_org_id, 'claim', v_pc3, v_c5, v_e7,
     'ar_follow_up',
     'Appeal deadline approaching — CLM-2026-003',
     'Denied claim appeal deadline is 15 days away. Draft appeal letter and gather supporting documentation.',
     'open', 'urgent',
     jsonb_build_object('claim_number','CLM-2026-003','patient_name','Priya Thompson','appeal_deadline',(now() + interval '15 days')::date::text),
     now() - interval '5 days', now()),

    -- Mailroom review tasks
    ('b0000001-0000-0000-0000-000000000010', v_org_id, 'mailroom_item', v_m1, v_c2, null,
     'mailroom_review',
     'EOB received — BlueCross BlueShield — Marcus Lee',
     'Paper Explanation of Benefits received for Marcus Lee. Post payment and reconcile with outstanding claims.',
     'open', 'normal',
     jsonb_build_object('patient_name','Marcus Lee','document_type','paper_eob','payer','BlueCross BlueShield','mailroom_item_id', v_m1::text),
     now() - interval '4 days', now()),

    ('b0000001-0000-0000-0000-000000000011', v_org_id, 'mailroom_item', v_m3, null, null,
     'mailroom_review',
     'Payer notice — credentialing update required',
     'Payer sent credentialing update notice. Review requirements and forward to credentialing team.',
     'in_progress', 'high',
     jsonb_build_object('document_type','credentialing_notice','payer','Aetna','mailroom_item_id', v_m3::text),
     now() - interval '6 days', now()),

    -- Ready-to-bill tasks
    ('b0000001-0000-0000-0000-000000000012', v_org_id, 'encounter', v_e1, v_c1, v_e1,
     'ready_to_bill',
     'Charge capture ready — Sarah Johnson',
     'Encounter coded and ready for claim submission. Create 837P claim for this session.',
     'open', 'normal',
     jsonb_build_object('patient_name','Sarah Johnson','dos',(now() - interval '60 days')::date::text,'procedure_codes',array['90837','90785'],'total_charge',210.00),
     now() - interval '2 days', now()),

    ('b0000001-0000-0000-0000-000000000013', v_org_id, 'encounter', v_e5, v_c1, v_e5,
     'ready_to_bill',
     'Charge capture ready — Sarah Johnson (2nd session)',
     'Second encounter ready for billing. Verify diagnosis codes match treatment plan before submitting.',
     'open', 'normal',
     jsonb_build_object('patient_name','Sarah Johnson','dos',(now() - interval '40 days')::date::text,'procedure_codes',array['90834'],'total_charge',145.00),
     now() - interval '3 days', now()),

    ('b0000001-0000-0000-0000-000000000014', v_org_id, 'encounter', v_e8, v_c3, v_e8,
     'ready_to_bill',
     'Charge capture ready — Dana Patel',
     'Encounter coded and ready. Confirm insurance policy has been updated before submitting.',
     'open', 'high',
     jsonb_build_object('patient_name','Dana Patel','dos',(now() - interval '20 days')::date::text,'procedure_codes',array['90837'],'total_charge',175.00),
     now() - interval '1 day', now()),

    -- Batch review task
    ('b0000001-0000-0000-0000-000000000015', v_org_id, 'claim', v_pc5, v_c1, null,
     'batch_review',
     '837P batch ready for submission — 2 claims',
     'Claims CLM-2026-001 and CLM-2026-005 are ready for batch. Generate 837P file and submit to clearinghouse.',
     'open', 'high',
     jsonb_build_object('claim_count',2,'total_charge_amount',290.00,'claims',array['CLM-2026-001','CLM-2026-005']),
     now() - interval '1 day', now())

  on conflict (id) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- 8. MAILROOM ITEMS
  -- ─────────────────────────────────────────────────────────────────────────────
  insert into public.mailroom_items
    (id, organization_id, client_id, title, sender_name, payer_name, received_date, document_type, mail_status, status, priority, source, file_name, mime_type, storage_path, notes, admin_comments, created_at, updated_at)
  values
    (v_m1, v_org_id, v_c2,
     'EOB — BlueCross BlueShield — Marcus Lee',
     'BlueCross BlueShield of Colorado', 'BlueCross BlueShield',
     (now() - interval '4 days')::date,
     'paper_eob', 'pending_action', 'needs_review', 'high',
     'fax',
     'eob_bcbs_marcus_lee_20260515.pdf', 'application/pdf',
     'mailroom/demo/eob_bcbs_marcus_lee_20260515.pdf',
     'Paper EOB received for Marcus Lee. Match to CLM-2026-001 and post payment.', null,
     now() - interval '4 days', now()),

    (v_m2, v_org_id, v_c5,
     'Denial notice — Aetna — Priya Thompson',
     'Aetna', 'Aetna',
     (now() - interval '8 days')::date,
     'payer_notice', 'pending_action', 'needs_review', 'urgent',
     'fax',
     'denial_aetna_priya_thompson_20260511.pdf', 'application/pdf',
     'mailroom/demo/denial_aetna_priya_thompson_20260511.pdf',
     'Denial notice for CLM-2026-003. CARC 97 — not covered. Review for appeal.', null,
     now() - interval '8 days', now()),

    (v_m3, v_org_id, null,
     'Credentialing update notice — Aetna',
     'Aetna Provider Relations', 'Aetna',
     (now() - interval '6 days')::date,
     'credentialing_notice', 'pending_action', 'needs_review', 'high',
     'mail',
     'credentialing_notice_aetna_20260513.pdf', 'application/pdf',
     'mailroom/demo/credentialing_notice_aetna_20260513.pdf',
     'Annual credentialing re-attestation required by June 30, 2026. Assign to credentialing team.', null,
     now() - interval '6 days', now()),

    (v_m4, v_org_id, v_c4,
     'Refund request — United Healthcare — James Rivera',
     'United Healthcare', 'United Healthcare',
     (now() - interval '12 days')::date,
     'refund_request', 'pending_action', 'needs_review', 'urgent',
     'mail',
     'refund_request_uhc_james_rivera_20260507.pdf', 'application/pdf',
     'mailroom/demo/refund_request_uhc_james_rivera_20260507.pdf',
     'Payer requesting refund of $52.00 — alleged overpayment on CLM-2026-002. Verify and respond within 30 days.', null,
     now() - interval '12 days', now()),

    (v_m5, v_org_id, v_c1,
     'EOB — Cigna — Sarah Johnson (filed)',
     'Cigna', 'Cigna',
     (now() - interval '25 days')::date,
     'paper_eob', 'filed', 'filed', 'normal',
     'fax',
     'eob_cigna_sarah_johnson_20260424.pdf', 'application/pdf',
     'mailroom/demo/eob_cigna_sarah_johnson_20260424.pdf',
     'EOB filed. Payment of $168 posted to CLM-2026-004.',
     'Filed to client chart on ' || (now() - interval '20 days')::date::text || '. No further action required.',
     now() - interval '25 days', now() - interval '20 days'),

    (v_m6, v_org_id, null,
     'Payer bulletin — Medicaid CPT code update',
     'Colorado HCPF', 'Colorado Medicaid',
     (now() - interval '15 days')::date,
     'payer_notice', 'filed', 'filed', 'low',
     'email',
     'medicaid_bulletin_cpt_update_20260504.pdf', 'application/pdf',
     'mailroom/demo/medicaid_bulletin_cpt_update_20260504.pdf',
     'Medicaid CPT code policy update effective July 1, 2026. Filed to practice documents.',
     'Forwarded to clinical director for review. Filed 05/09/2026.',
     now() - interval '15 days', now() - interval '10 days'),

    (v_m7, v_org_id, v_c3,
     'Patient document — Insurance card — Dana Patel',
     'Dana Patel', null,
     (now() - interval '3 days')::date,
     'client_document', 'unsorted', 'needs_review', 'normal',
     'patient_portal',
     'insurance_card_dana_patel_20260516.jpg', 'image/jpeg',
     'mailroom/demo/insurance_card_dana_patel_20260516.jpg',
     'Patient uploaded new insurance card. Verify policy details and update record.', null,
     now() - interval '3 days', now()),

    (v_m8, v_org_id, null,
     'Practice document — NPI registry confirmation',
     'NPPES', null,
     (now() - interval '20 days')::date,
     'practice_document', 'filed', 'filed', 'low',
     'email',
     'npi_registry_confirmation_20260429.pdf', 'application/pdf',
     'mailroom/demo/npi_registry_confirmation_20260429.pdf',
     'Annual NPI registry verification confirmed. Filed to practice documents.',
     'Filed 04/30/2026.',
     now() - interval '20 days', now() - interval '18 days')

  on conflict (id) do nothing;

end $$;
