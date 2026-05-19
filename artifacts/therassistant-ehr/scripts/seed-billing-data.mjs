/**
 * Seed script: Workqueue, Mailroom, and Billing demo data
 * Run with: node artifacts/therassistant-ehr/scripts/seed-billing-data.mjs
 *
 * All UUIDs use only valid hex characters (0-9, a-f).
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = '11111111-1111-1111-1111-111111111111';

// Fixed UUIDs — only hex characters (0-9, a-f)
const C1 = 'cc100001-0000-0000-0000-000000000001';
const C2 = 'cc100001-0000-0000-0000-000000000002';
const C3 = 'cc100001-0000-0000-0000-000000000003';
const C4 = 'cc100001-0000-0000-0000-000000000004';
const C5 = 'cc100001-0000-0000-0000-000000000005';
const A1 = 'aa200001-0000-0000-0000-000000000001';
const A2 = 'aa200001-0000-0000-0000-000000000002';
const A3 = 'aa200001-0000-0000-0000-000000000003';
const A4 = 'aa200001-0000-0000-0000-000000000004';
const A5 = 'aa200001-0000-0000-0000-000000000005';
const A6 = 'aa200001-0000-0000-0000-000000000006';
const A7 = 'aa200001-0000-0000-0000-000000000007';
const A8 = 'aa200001-0000-0000-0000-000000000008';
const E1 = 'ee300001-0000-0000-0000-000000000001';
const E2 = 'ee300001-0000-0000-0000-000000000002';
const E3 = 'ee300001-0000-0000-0000-000000000003';
const E4 = 'ee300001-0000-0000-0000-000000000004';
const E5 = 'ee300001-0000-0000-0000-000000000005';
const E6 = 'ee300001-0000-0000-0000-000000000006';
const E7 = 'ee300001-0000-0000-0000-000000000007';
const E8 = 'ee300001-0000-0000-0000-000000000008';
// Professional claims — ac (hex a=10, c=12)
const PC1 = 'ac400001-0000-0000-0000-000000000001';
const PC2 = 'ac400001-0000-0000-0000-000000000002';
const PC3 = 'ac400001-0000-0000-0000-000000000003';
const PC4 = 'ac400001-0000-0000-0000-000000000004';
const PC5 = 'ac400001-0000-0000-0000-000000000005';
// Batches
const B1 = 'bb500001-0000-0000-0000-000000000001';
const B2 = 'bb500001-0000-0000-0000-000000000002';
// Mailroom — ab (all hex)
const M1 = 'ab600001-0000-0000-0000-000000000001';
const M2 = 'ab600001-0000-0000-0000-000000000002';
const M3 = 'ab600001-0000-0000-0000-000000000003';
const M4 = 'ab600001-0000-0000-0000-000000000004';
const M5 = 'ab600001-0000-0000-0000-000000000005';
const M6 = 'ab600001-0000-0000-0000-000000000006';
const M7 = 'ab600001-0000-0000-0000-000000000007';
const M8 = 'ab600001-0000-0000-0000-000000000008';
// Real provider UUID (already exists in DB)
const PROVIDER = '22222222-2222-2222-2222-222222222222';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function dateAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function daysAhead(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function minLater(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

async function upsert(table, rows) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    console.error(`  ERROR ${table}:`, error.message);
    return false;
  }
  console.log(`  ✓ ${table}: ${rows.length} row(s)`);
  return true;
}

async function main() {
  console.log('\n=== Therassistant EHR Billing Seed ===\n');

  const { data: org } = await supabase.from('organizations').select('id,name').eq('id', ORG_ID).single();
  if (!org) {
    console.error(`Demo org ${ORG_ID} not found. Is the database set up?`);
    process.exit(1);
  }
  console.log(`Org: ${org.name} (${ORG_ID})\n`);

  // ─── 1. Clients ──────────────────────────────────────────────────────────────
  console.log('1. Clients');
  await upsert('clients', [
    { id: C1, organization_id: ORG_ID, first_name: 'Sarah',  last_name: 'Johnson',  date_of_birth: '1985-03-14', sex_at_birth: 'F', phone: '303-555-0101', email: 'sarah.johnson@example.com',  city: 'Denver',       state: 'CO', postal_code: '80202' },
    { id: C2, organization_id: ORG_ID, first_name: 'Marcus', last_name: 'Lee',      date_of_birth: '1979-07-22', sex_at_birth: 'M', phone: '303-555-0102', email: 'marcus.lee@example.com',     city: 'Boulder',      state: 'CO', postal_code: '80301' },
    { id: C3, organization_id: ORG_ID, first_name: 'Dana',   last_name: 'Patel',    date_of_birth: '1992-11-05', sex_at_birth: 'F', phone: '303-555-0103', email: 'dana.patel@example.com',     city: 'Aurora',       state: 'CO', postal_code: '80012' },
    { id: C4, organization_id: ORG_ID, first_name: 'James',  last_name: 'Rivera',   date_of_birth: '1968-04-30', sex_at_birth: 'M', phone: '303-555-0104', email: 'james.rivera@example.com',   city: 'Lakewood',     state: 'CO', postal_code: '80215' },
    { id: C5, organization_id: ORG_ID, first_name: 'Priya',  last_name: 'Thompson', date_of_birth: '1995-09-18', sex_at_birth: 'F', phone: '303-555-0105', email: 'priya.thompson@example.com', city: 'Fort Collins', state: 'CO', postal_code: '80521' },
  ]);

  // ─── 2. Appointments ─────────────────────────────────────────────────────────
  console.log('2. Appointments');
  const apptRows = [
    { id: A1, client_id: C1, days: 60 }, { id: A2, client_id: C2, days: 55 },
    { id: A3, client_id: C3, days: 50 }, { id: A4, client_id: C4, days: 45 },
    { id: A5, client_id: C1, days: 40 }, { id: A6, client_id: C2, days: 35 },
    { id: A7, client_id: C5, days: 30 }, { id: A8, client_id: C3, days: 20 },
  ].map(({ id, client_id, days }) => ({
    id,
    organization_id: ORG_ID,
    client_id,
    provider_id: PROVIDER,
    scheduled_start_at: daysAgo(days),
    scheduled_end_at:   minLater(daysAgo(days), 50),
    appointment_status: 'completed',
    appointment_type:   'individual_therapy',
  }));
  await upsert('appointments', apptRows);

  // ─── 3. Encounters ───────────────────────────────────────────────────────────
  console.log('3. Encounters');
  const encRows = [
    { id: E1, appt: A1, client: C1, days: 60, complete: true  },
    { id: E2, appt: A2, client: C2, days: 55, complete: true  },
    { id: E3, appt: A3, client: C3, days: 50, complete: false },
    { id: E4, appt: A4, client: C4, days: 45, complete: true  },
    { id: E5, appt: A5, client: C1, days: 40, complete: true  },
    { id: E6, appt: A6, client: C2, days: 35, complete: false },
    { id: E7, appt: A7, client: C5, days: 30, complete: true  },
    { id: E8, appt: A8, client: C3, days: 20, complete: true  },
  ].map(({ id, appt, client, days, complete }) => ({
    id,
    organization_id:               ORG_ID,
    appointment_id:                appt,
    client_id:                     client,
    provider_id:                   PROVIDER,
    encounter_status:              'completed',
    service_date:                  dateAgo(days),
    started_at:                    daysAgo(days),
    ended_at:                      minLater(daysAgo(days), 50),
    required_billing_fields_complete: complete,
  }));
  await upsert('encounters', encRows);

  // ─── 4. Charge Capture Items ─────────────────────────────────────────────────
  console.log('4. Charge capture items');
  // Use gen_random_uuid() style IDs for these since conflict key is on encounter_id
  const chargeRows = [
    { enc: E1, appt: A1, client: C1, days: 60, status: 'ready_for_claim', codes: ['F32.1','Z71.1'], lines: [{procedure_code:'90837',units:1,charge_amount:175.00,modifiers:[]},{procedure_code:'90785',units:1,charge_amount:35.00,modifiers:[]}],  total: 210.00, pos: '11', blockers: [] },
    { enc: E2, appt: A2, client: C2, days: 55, status: 'claim_created',   codes: ['F41.1'],          lines: [{procedure_code:'90834',units:1,charge_amount:145.00,modifiers:[]}],                                                                       total: 145.00, pos: '11', blockers: [] },
    { enc: E3, appt: A3, client: C3, days: 50, status: 'blocked',         codes: ['F33.0'],          lines: [{procedure_code:'90837',units:1,charge_amount:175.00,modifiers:[]}],                                                                       total: 175.00, pos: '11', blockers: [{code:'MISSING_INSURANCE_POLICY',message:'No active insurance policy found'},{code:'MISSING_AUTH',message:'Prior authorization required'}] },
    { enc: E4, appt: A4, client: C4, days: 45, status: 'claim_created',   codes: ['F32.9','Z79.899'],lines: [{procedure_code:'90837',units:1,charge_amount:175.00,modifiers:['95']}],                                                                  total: 175.00, pos: '02', blockers: [] },
    { enc: E5, appt: A5, client: C1, days: 40, status: 'ready_for_claim', codes: ['F32.1','F41.0'],  lines: [{procedure_code:'90834',units:1,charge_amount:145.00,modifiers:[]}],                                                                       total: 145.00, pos: '11', blockers: [] },
    { enc: E6, appt: A6, client: C2, days: 35, status: 'blocked',         codes: ['F41.1','F40.10'], lines: [{procedure_code:'90837',units:1,charge_amount:175.00,modifiers:[]}],                                                                       total: 175.00, pos: '11', blockers: [{code:'ELIGIBILITY_NOT_VERIFIED',message:'Eligibility not verified for this date of service'}] },
    { enc: E7, appt: A7, client: C5, days: 30, status: 'claim_created',   codes: ['F32.0'],          lines: [{procedure_code:'90834',units:1,charge_amount:145.00,modifiers:['95']}],                                                                  total: 145.00, pos: '02', blockers: [] },
    { enc: E8, appt: A8, client: C3, days: 20, status: 'ready_for_claim', codes: ['F33.1','Z71.1'],  lines: [{procedure_code:'90837',units:1,charge_amount:175.00,modifiers:[]}],                                                                       total: 175.00, pos: '11', blockers: [] },
  ];
  let chargeOk = 0, chargeErr = 0;
  for (const r of chargeRows) {
    const { error } = await supabase.from('charge_capture_items').insert({
      organization_id:    ORG_ID,
      encounter_id:       r.enc,
      client_id:          r.client,
      provider_id:        PROVIDER,
      appointment_id:     r.appt,
      source_object_type: 'encounter',
      source_object_id:   r.enc,
      charge_status:      r.status,
      service_date:       dateAgo(r.days),
      diagnosis_codes:    r.codes,
      service_lines:      r.lines,
      total_charge:       r.total,
      place_of_service:   r.pos,
      blocker_reasons:    r.blockers,
    });
    // Conflict on the unique partial index (encounter_id where not voided) is not a true error
    if (error && !error.message.includes('unique') && !error.message.includes('duplicate') && !error.message.includes('conflict')) {
      console.error(`  ERROR charge_capture_items (enc ${r.enc}):`, error.message);
      chargeErr++;
    } else {
      chargeOk++;
    }
  }
  console.log(`  ✓ charge_capture_items: ${chargeOk} inserted/skipped, ${chargeErr} errors`);

  // ─── 5. Professional Claims ───────────────────────────────────────────────────
  console.log('5. Professional claims');
  await upsert('professional_claims', [
    { id: PC1, organization_id: ORG_ID, patient_id: C2, appointment_id: A2, claim_number: 'CLM-2026-001', patient_account_number: 'ACC-20260001', claim_status: 'ready_for_batch', total_charge: 145.00, place_of_service: '11', diagnosis_codes: ['F41.1'],          first_billed_date: dateAgo(53), last_billed_date: dateAgo(53), billing_notes: 'Auto-created from charge capture. Ready for 837P batch.' },
    { id: PC2, organization_id: ORG_ID, patient_id: C4, appointment_id: A4, claim_number: 'CLM-2026-002', patient_account_number: 'ACC-20260002', claim_status: 'submitted',       total_charge: 175.00, place_of_service: '02', diagnosis_codes: ['F32.9'],           first_billed_date: dateAgo(43), last_billed_date: dateAgo(43), billing_notes: 'Submitted via 837P batch B2026-01.' },
    { id: PC3, organization_id: ORG_ID, patient_id: C5, appointment_id: A7, claim_number: 'CLM-2026-003', patient_account_number: 'ACC-20260003', claim_status: 'denied',          total_charge: 145.00, place_of_service: '02', diagnosis_codes: ['F32.0'],           first_billed_date: dateAgo(28), last_billed_date: dateAgo(28), billing_notes: 'Denied CARC 97 — service not covered.', denial_reason_code: '97', denial_reason_description: 'Service not covered by payer' },
    { id: PC4, organization_id: ORG_ID, patient_id: C1, appointment_id: A1, claim_number: 'CLM-2026-004', patient_account_number: 'ACC-20260004', claim_status: 'paid',            total_charge: 210.00, place_of_service: '11', diagnosis_codes: ['F32.1','Z71.1'],   first_billed_date: dateAgo(58), last_billed_date: dateAgo(58), billing_notes: 'Paid in full — $168 allowed, $42 write-off.' },
    { id: PC5, organization_id: ORG_ID, patient_id: C1, appointment_id: A5, claim_number: 'CLM-2026-005', patient_account_number: 'ACC-20260005', claim_status: 'ready_for_batch', total_charge: 145.00, place_of_service: '11', diagnosis_codes: ['F32.1','F41.0'],   first_billed_date: dateAgo(38), last_billed_date: dateAgo(38), billing_notes: 'Validated and ready for next 837P batch.' },
  ]);

  // ─── 6. 837P Batches ─────────────────────────────────────────────────────────
  console.log('6. 837P batches');
  await upsert('claim_837p_batches', [
    { id: B1, organization_id: ORG_ID, batch_number: 'B2026-01', batch_status: 'accepted',  claim_count: 1, total_charge_amount: 175.00, generated_file_name: '837P_B2026-01_20260415.edi', submitted_at: daysAgo(40) },
    { id: B2, organization_id: ORG_ID, batch_number: 'B2026-02', batch_status: 'submitted', claim_count: 2, total_charge_amount: 290.00, generated_file_name: '837P_B2026-02_20260507.edi', submitted_at: daysAgo(12) },
  ]);

  console.log('6b. Batch claim links');
  await upsert('claim_837p_batch_claims', [
    { id: 'bc000001-0000-0000-0000-000000000001', organization_id: ORG_ID, batch_id: B1, professional_claim_id: PC2 },
    { id: 'bc000001-0000-0000-0000-000000000002', organization_id: ORG_ID, batch_id: B2, professional_claim_id: PC1 },
    { id: 'bc000001-0000-0000-0000-000000000003', organization_id: ORG_ID, batch_id: B2, professional_claim_id: PC5 },
  ]);

  // ─── 7. Workqueue Items ───────────────────────────────────────────────────────
  console.log('7. Workqueue items');
  const wqRows = [
    { id: 'b0000001-0000-0000-0000-000000000001', src_type: 'client',        src_id: C2,  cid: C2,  eid: null, wt: 'eligibility_check', title: 'Eligibility not verified — Marcus Lee',               st: 'open',        pr: 'high',   desc: 'Patient eligibility has not been checked for the upcoming session. Verify coverage before next appointment.',       ctx: { patient_name: 'Marcus Lee',   last_checked_days_ago: 32, payer: 'BlueCross BlueShield' } },
    { id: 'b0000001-0000-0000-0000-000000000002', src_type: 'client',        src_id: C5,  cid: C5,  eid: null, wt: 'eligibility_check', title: 'Eligibility expiring — Priya Thompson',               st: 'open',        pr: 'normal', desc: 'Insurance policy expires within 30 days. Re-verify coverage and collect updated insurance card.',                    ctx: { patient_name: 'Priya Thompson', policy_expiry_date: daysAhead(25), payer: 'Aetna' } },
    { id: 'b0000001-0000-0000-0000-000000000003', src_type: 'claim',         src_id: PC3, cid: C5,  eid: E7,   wt: 'claim_denial',      title: 'Claim denied — CARC 97 — Priya Thompson',             st: 'open',        pr: 'urgent', desc: 'Claim CLM-2026-003 denied with CARC 97 (Service not covered). Determine if resubmission, appeal, or patient billing is appropriate.', ctx: { claim_number: 'CLM-2026-003', carc_code: '97', patient_name: 'Priya Thompson', denial_date: dateAgo(10), amount_denied: 145.00 } },
    { id: 'b0000001-0000-0000-0000-000000000004', src_type: 'claim',         src_id: PC2, cid: C4,  eid: E4,   wt: 'claim_denial',      title: 'Claim requires follow-up — CLM-2026-002',             st: 'in_progress', pr: 'high',   desc: 'Claim submitted 7 days ago with no response from payer. Follow up with clearinghouse for status update.',              ctx: { claim_number: 'CLM-2026-002', days_since_submission: 7, patient_name: 'James Rivera', payer: 'United Healthcare' } },
    { id: 'b0000001-0000-0000-0000-000000000005', src_type: 'encounter',     src_id: E3,  cid: C3,  eid: E3,   wt: 'missing_info',      title: 'Missing insurance policy — Dana Patel',               st: 'open',        pr: 'high',   desc: 'Encounter cannot be billed: no active insurance policy on file. Contact patient to obtain current insurance information.', ctx: { patient_name: 'Dana Patel', encounter_date: dateAgo(50), blocker: 'MISSING_INSURANCE_POLICY' } },
    { id: 'b0000001-0000-0000-0000-000000000006', src_type: 'encounter',     src_id: E3,  cid: C3,  eid: E3,   wt: 'missing_info',      title: 'Prior auth required — Dana Patel',                    st: 'open',        pr: 'high',   desc: 'Payer requires prior authorization for 90837. Obtain auth number before submitting claim.',                             ctx: { patient_name: 'Dana Patel', procedure_code: '90837', payer: 'Medicaid', blocker: 'MISSING_AUTH' } },
    { id: 'b0000001-0000-0000-0000-000000000007', src_type: 'encounter',     src_id: E6,  cid: C2,  eid: E6,   wt: 'missing_info',      title: 'Eligibility not verified for DOS — Marcus Lee',       st: 'open',        pr: 'normal', desc: 'Charge blocked: eligibility was not verified for the date of service. Run eligibility check before proceeding.',        ctx: { patient_name: 'Marcus Lee', dos: dateAgo(35), blocker: 'ELIGIBILITY_NOT_VERIFIED' } },
    { id: 'b0000001-0000-0000-0000-000000000008', src_type: 'claim',         src_id: PC1, cid: C2,  eid: E2,   wt: 'ar_follow_up',      title: 'AR follow-up — CLM-2026-001 > 30 days',              st: 'open',        pr: 'high',   desc: 'Claim is 30+ days in AR with no response. Initiate follow-up with BlueCross BlueShield.',                              ctx: { claim_number: 'CLM-2026-001', patient_name: 'Marcus Lee', days_in_ar: 35, payer: 'BlueCross BlueShield', charge_amount: 145.00 } },
    { id: 'b0000001-0000-0000-0000-000000000009', src_type: 'claim',         src_id: PC3, cid: C5,  eid: E7,   wt: 'ar_follow_up',      title: 'Appeal deadline approaching — CLM-2026-003',          st: 'open',        pr: 'urgent', desc: 'Denied claim appeal deadline is 15 days away. Draft appeal letter and gather supporting documentation.',                 ctx: { claim_number: 'CLM-2026-003', patient_name: 'Priya Thompson', appeal_deadline: daysAhead(15) } },
    { id: 'b0000001-0000-0000-0000-000000000010', src_type: 'mailroom_item', src_id: M1,  cid: C2,  eid: null, wt: 'mailroom_review',   title: 'EOB received — BlueCross BlueShield — Marcus Lee',    st: 'open',        pr: 'normal', desc: 'Paper EOB received for Marcus Lee. Post payment and reconcile with outstanding claims.',                                ctx: { patient_name: 'Marcus Lee', document_type: 'paper_eob', payer: 'BlueCross BlueShield', mailroom_item_id: M1 } },
    { id: 'b0000001-0000-0000-0000-000000000011', src_type: 'mailroom_item', src_id: M3,  cid: null, eid: null, wt: 'mailroom_review',   title: 'Payer notice — credentialing update required',        st: 'in_progress', pr: 'high',   desc: 'Payer sent credentialing update notice. Review requirements and forward to credentialing team.',                        ctx: { document_type: 'credentialing_notice', payer: 'Aetna', mailroom_item_id: M3 } },
    { id: 'b0000001-0000-0000-0000-000000000012', src_type: 'encounter',     src_id: E1,  cid: C1,  eid: E1,   wt: 'ready_to_bill',     title: 'Charge capture ready — Sarah Johnson',                st: 'open',        pr: 'normal', desc: 'Encounter coded and ready for claim submission. Create 837P claim for this session.',                                   ctx: { patient_name: 'Sarah Johnson', dos: dateAgo(60), procedure_codes: ['90837','90785'], total_charge: 210.00 } },
    { id: 'b0000001-0000-0000-0000-000000000013', src_type: 'encounter',     src_id: E5,  cid: C1,  eid: E5,   wt: 'ready_to_bill',     title: 'Charge capture ready — Sarah Johnson (2nd session)',  st: 'open',        pr: 'normal', desc: 'Second encounter ready for billing. Verify diagnosis codes match treatment plan before submitting.',                    ctx: { patient_name: 'Sarah Johnson', dos: dateAgo(40), procedure_codes: ['90834'], total_charge: 145.00 } },
    { id: 'b0000001-0000-0000-0000-000000000014', src_type: 'encounter',     src_id: E8,  cid: C3,  eid: E8,   wt: 'ready_to_bill',     title: 'Charge capture ready — Dana Patel',                   st: 'open',        pr: 'high',   desc: 'Encounter coded and ready. Confirm insurance policy has been updated before submitting.',                               ctx: { patient_name: 'Dana Patel', dos: dateAgo(20), procedure_codes: ['90837'], total_charge: 175.00 } },
    { id: 'b0000001-0000-0000-0000-000000000015', src_type: 'claim',         src_id: PC5, cid: C1,  eid: null, wt: 'batch_review',      title: '837P batch ready for submission — 2 claims',          st: 'open',        pr: 'high',   desc: 'Claims CLM-2026-001 and CLM-2026-005 are ready for batch. Generate 837P file and submit to clearinghouse.',           ctx: { claim_count: 2, total_charge_amount: 290.00, claims: ['CLM-2026-001','CLM-2026-005'] } },
  ].map(r => ({
    id:                  r.id,
    organization_id:     ORG_ID,
    source_object_type:  r.src_type,
    source_object_id:    r.src_id,
    client_id:           r.cid  || undefined,
    encounter_id:        r.eid  || undefined,
    work_type:           r.wt,
    title:               r.title,
    description:         r.desc,
    status:              r.st,
    priority:            r.pr,
    context_payload:     r.ctx,
  }));

  let wqOk = 0, wqErr = 0;
  for (const row of wqRows) {
    const { error } = await supabase.from('workqueue_items').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { console.error(`  ERROR wq (${row.title.slice(0,45)}):`, error.message); wqErr++; }
    else wqOk++;
  }
  console.log(`  ✓ workqueue_items: ${wqOk} ok, ${wqErr} errors`);

  // ─── 8. Mailroom Items ────────────────────────────────────────────────────────
  // Actual columns (verified): id, organization_id, client_id, workqueue_item_id,
  //   document_type, source, file_name, storage_path, mime_type, notes,
  //   admin_comments, status, mail_status, filed_client_id, filed_at,
  //   created_at, updated_at, archived_at, routed_to_workqueue_id,
  //   routed_at, routed_by_user_id, ticket_id, uploaded_by_user_id, document_scope
  console.log('8. Mailroom items');
  const mailRows = [
    { id: M1, cid: C2,   type: 'paper_eob',          mail_st: 'pending_action', status: 'needs_review', source: 'fax',           fname: 'eob_bcbs_marcus_lee_20260515.pdf',              mime: 'application/pdf', path: 'mailroom/demo/eob_bcbs_marcus_lee_20260515.pdf',             notes: 'Paper EOB received for Marcus Lee. Match to CLM-2026-001 and post payment.',                                                      admin: null },
    { id: M2, cid: C5,   type: 'payer_notice',        mail_st: 'pending_action', status: 'needs_review', source: 'fax',           fname: 'denial_aetna_priya_thompson_20260511.pdf',     mime: 'application/pdf', path: 'mailroom/demo/denial_aetna_priya_thompson_20260511.pdf',      notes: 'Denial notice for CLM-2026-003. CARC 97 — not covered. Review for appeal.',                                                        admin: null },
    { id: M3, cid: null, type: 'credentialing_notice', mail_st: 'pending_action', status: 'needs_review', source: 'mail',          fname: 'credentialing_notice_aetna_20260513.pdf',      mime: 'application/pdf', path: 'mailroom/demo/credentialing_notice_aetna_20260513.pdf',       notes: 'Annual credentialing re-attestation required by June 30, 2026. Assign to credentialing team.',                                      admin: null },
    { id: M4, cid: C4,   type: 'refund_request',      mail_st: 'pending_action', status: 'needs_review', source: 'mail',          fname: 'refund_request_uhc_james_rivera_20260507.pdf', mime: 'application/pdf', path: 'mailroom/demo/refund_request_uhc_james_rivera_20260507.pdf',  notes: 'Payer requesting refund of $52.00 — alleged overpayment on CLM-2026-002. Verify and respond within 30 days.',                      admin: null },
    { id: M5, cid: C1,   type: 'paper_eob',           mail_st: 'filed',          status: 'filed',         source: 'fax',           fname: 'eob_cigna_sarah_johnson_20260424.pdf',         mime: 'application/pdf', path: 'mailroom/demo/eob_cigna_sarah_johnson_20260424.pdf',          notes: 'EOB filed. Payment of $168 posted to CLM-2026-004.',                                                                               admin: `Filed to practice records on ${dateAgo(20)}.` },
    { id: M6, cid: null, type: 'payer_notice',         mail_st: 'filed',          status: 'filed',         source: 'email',         fname: 'medicaid_bulletin_cpt_update_20260504.pdf',    mime: 'application/pdf', path: 'mailroom/demo/medicaid_bulletin_cpt_update_20260504.pdf',     notes: 'Medicaid CPT code policy update effective July 1, 2026. Filed to practice documents.',                                              admin: `Forwarded to clinical director for review. Filed on ${dateAgo(10)}.` },
    { id: M7, cid: C3,   type: 'client_document',     mail_st: 'unsorted',       status: 'needs_review', source: 'patient_portal', fname: 'insurance_card_dana_patel_20260516.jpg',        mime: 'image/jpeg',      path: 'mailroom/demo/insurance_card_dana_patel_20260516.jpg',         notes: 'Patient uploaded new insurance card. Verify policy details and update record.',                                                      admin: null },
    { id: M8, cid: null, type: 'practice_document',   mail_st: 'filed',          status: 'filed',         source: 'email',         fname: 'npi_registry_confirmation_20260429.pdf',       mime: 'application/pdf', path: 'mailroom/demo/npi_registry_confirmation_20260429.pdf',         notes: 'Annual NPI registry verification confirmed. Filed to practice documents.',                                                           admin: `Filed ${dateAgo(18)}.` },
  ].map(r => ({
    id:              r.id,
    organization_id: ORG_ID,
    client_id:       r.cid || undefined,
    document_type:   r.type,
    mail_status:     r.mail_st,
    status:          r.status,
    source:          r.source,
    file_name:       r.fname,
    mime_type:       r.mime,
    storage_path:    r.path,
    notes:           r.notes,
    admin_comments:  r.admin,
  }));

  let mailOk = 0, mailErr = 0;
  for (const row of mailRows) {
    const { error } = await supabase.from('mailroom_items').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { console.error(`  ERROR mailroom (${row.file_name?.slice(0,40)}):`, error.message); mailErr++; }
    else mailOk++;
  }
  console.log(`  ✓ mailroom_items: ${mailOk} ok, ${mailErr} errors`);

  console.log('\n=== Seed complete ===\n');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
