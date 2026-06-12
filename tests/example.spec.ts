import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';

declare const process: {
  env: Record<string, string | undefined>;
};

const env = process.env;

function requiredEnv(name: string) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it before running the system test.`,
    );
  }

  return value;
}

function optionalEnv(name: string) {
  return env[name]?.trim() || null;
}

async function readJsonResponse(response: APIResponse): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      rawText: text,
    };
  }
}

function assertJsonArray(
  value: unknown,
  label: string,
): Record<string, unknown>[] {
  expect(Array.isArray(value), `${label} response was not an array`).toBe(true);

  return value as Record<string, unknown>[];
}

async function supabaseGetSingle(params: {
  request: APIRequestContext;
  table: string;
  query: string;
  select: string;
}) {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const url = new URL(`/rest/v1/${params.table}`, supabaseUrl);
  url.search = params.query;
  url.searchParams.set('select', params.select);
  url.searchParams.set('limit', '1');

  const response = await params.request.get(url.toString(), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });

  const json = await readJsonResponse(response);

  expect(
    response.ok(),
    `${params.table} lookup failed: ${response.status()} ${JSON.stringify(json)}`,
  ).toBe(true);

  const rows = assertJsonArray(json, params.table);

  return rows[0];
}

async function supabaseGetMany(params: {
  request: APIRequestContext;
  table: string;
  query: string;
  select: string;
}) {
  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  const url = new URL(`/rest/v1/${params.table}`, supabaseUrl);
  url.search = params.query;
  url.searchParams.set('select', params.select);

  const response = await params.request.get(url.toString(), {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    },
  });

  const json = await readJsonResponse(response);

  expect(
    response.ok(),
    `${params.table} lookup failed: ${response.status()} ${JSON.stringify(json)}`,
  ).toBe(true);

  return assertJsonArray(json, params.table);
}

function asObject(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

test('SYSTEM: signing a clinical note creates a billable charge and non-draft claim with codes', async ({
  request,
}, testInfo) => {
  const organizationId = requiredEnv('SYSTEM_TEST_ORGANIZATION_ID');
  const encounterId = requiredEnv('SYSTEM_TEST_ENCOUNTER_ID');
  const userId = optionalEnv('SYSTEM_TEST_USER_ID');

  const expectedDiagnosisCode = optionalEnv('SYSTEM_TEST_EXPECTED_DX');
  const expectedProcedureCode = optionalEnv('SYSTEM_TEST_EXPECTED_CPT');

  const response = await request.post(`/api/encounters/${encounterId}/note`, {
    data: {
      organizationId,
      action: 'sign',
      userId,
      subjective:
        'System test note. Client reports symptoms affecting daily functioning.',
      objective:
        'Client was alert, oriented, engaged, and participated appropriately.',
      assessment:
        'Diagnosis and service line should already exist on the encounter billing records.',
      plan:
        'Continue treatment plan and submit billing through the claim workflow.',
      codingReport: {
        reportText:
          'System test coding report. Encounter billing records must drive claim diagnosis and service lines.',
      },
    },
  });

  const body = asObject(await response.json());

  await testInfo.attach('signed-note-response.json', {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  });

  expect(
    response.ok(),
    `Sign-note API failed: HTTP ${response.status()} ${JSON.stringify(body)}`,
  ).toBe(true);

  expect(body.success, JSON.stringify(body, null, 2)).toBe(true);
  expect(body.status).toBe('signed');

  const chargeCapture = asObject(body.chargeCapture);

  expect(
    chargeCapture.chargeId,
    `No charge was created from signed note: ${JSON.stringify(body, null, 2)}`,
  ).toBeTruthy();

  expect(
    String(chargeCapture.status),
    `Charge is not claim-ready: ${JSON.stringify(chargeCapture, null, 2)}`,
  ).toMatch(/ready_for_claim|claim_created/);

  expect(
    asArray(chargeCapture.blockers),
    `Charge has blockers: ${JSON.stringify(chargeCapture, null, 2)}`,
  ).toEqual([]);

  const claimDraft = asObject(body.claimDraft);

  expect(
    claimDraft.claimId,
    `No claim was created from signed-note charge: ${JSON.stringify(body, null, 2)}`,
  ).toBeTruthy();

  expect(
    claimDraft.ok,
    `Claim creation returned errors: ${JSON.stringify(claimDraft, null, 2)}`,
  ).toBe(true);

  expect(
    asArray(claimDraft.errors),
    `Claim errors were returned: ${JSON.stringify(claimDraft, null, 2)}`,
  ).toEqual([]);

  const chargeId = String(chargeCapture.chargeId);
  const claimId = String(claimDraft.claimId);

  const charge = await supabaseGetSingle({
    request,
    table: 'charge_capture_items',
    query: `id=eq.${encodeURIComponent(chargeId)}`,
    select:
      'id,charge_status,claim_id,diagnosis_codes,service_lines,total_charge,blocker_reasons',
  });

  expect(charge, `Charge row not found: ${chargeId}`).toBeTruthy();

  await testInfo.attach('charge-capture-row.json', {
    body: JSON.stringify(charge, null, 2),
    contentType: 'application/json',
  });

  expect(charge.claim_id).toBe(claimId);
  expect(charge.charge_status).toBe('claim_created');

  expect(
    asArray(charge.diagnosis_codes).length,
    `Charge has no diagnosis codes: ${JSON.stringify(charge, null, 2)}`,
  ).toBeGreaterThan(0);

  expect(
    asArray(charge.service_lines).length,
    `Charge has no service lines: ${JSON.stringify(charge, null, 2)}`,
  ).toBeGreaterThan(0);

  if (expectedDiagnosisCode) {
    expect(asArray(charge.diagnosis_codes)).toContain(expectedDiagnosisCode);
  }

  const claim = await supabaseGetSingle({
    request,
    table: 'professional_claims',
    query: `id=eq.${encodeURIComponent(claimId)}`,
    select:
      'id,claim_status,diagnosis_codes,total_charge,validation_errors,patient_id,encounter_id',
  });

  expect(claim, `Claim row not found: ${claimId}`).toBeTruthy();

  await testInfo.attach('professional-claim-row.json', {
    body: JSON.stringify(claim, null, 2),
    contentType: 'application/json',
  });

  expect(claim.encounter_id).toBe(encounterId);

  expect(
    String(claim.claim_status),
    `Claim is still in a non-workable status: ${JSON.stringify(claim, null, 2)}`,
  ).not.toMatch(/draft|on_hold|hold|validation_failed/i);

  expect(
    asArray(claim.diagnosis_codes).length,
    `Claim has no diagnosis codes: ${JSON.stringify(claim, null, 2)}`,
  ).toBeGreaterThan(0);

  if (expectedDiagnosisCode) {
    expect(asArray(claim.diagnosis_codes)).toContain(expectedDiagnosisCode);
  }

  const serviceLines = await supabaseGetMany({
    request,
    table: 'professional_claim_service_lines',
    query: `claim_id=eq.${encodeURIComponent(claimId)}`,
    select:
      'id,claim_id,line_number,procedure_code,service_date_from,charge_amount,units,diagnosis_pointers',
  });

  await testInfo.attach('professional-claim-service-lines.json', {
    body: JSON.stringify(serviceLines, null, 2),
    contentType: 'application/json',
  });

  expect(
    serviceLines.length,
    `Claim has no service lines: ${JSON.stringify(serviceLines, null, 2)}`,
  ).toBeGreaterThan(0);

  for (const line of serviceLines) {
    expect(line.procedure_code).toBeTruthy();
    expect(Number(line.charge_amount)).toBeGreaterThan(0);
    expect(Number(line.units)).toBeGreaterThan(0);
    expect(asArray(line.diagnosis_pointers).length).toBeGreaterThan(0);
  }

  if (expectedProcedureCode) {
    expect(serviceLines.map(line => line.procedure_code)).toContain(
      expectedProcedureCode,
    );
  }
});