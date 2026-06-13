import { expect, test } from '@playwright/test';

declare const process: {
  env: Record<string, string | undefined>;
};

const env = process.env;

function requiredEnv(name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string) {
  return env[name]?.trim() || null;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

test('SYSTEM: signed encounter creates charge and claim with codes', async ({ request }, testInfo) => {
  const organizationId = requiredEnv('SYSTEM_TEST_ORGANIZATION_ID');
  const encounterId = requiredEnv('SYSTEM_TEST_ENCOUNTER_ID');
  const userId = optionalEnv('SYSTEM_TEST_USER_ID');
  const expectedDx = optionalEnv('SYSTEM_TEST_EXPECTED_DX');
  const expectedCpt = optionalEnv('SYSTEM_TEST_EXPECTED_CPT');

  const signResponse = await request.post(`/api/encounters/${encounterId}/note`, {
    data: {
      organizationId,
      action: 'sign',
      userId,
      subjective: 'System test subjective text.',
      objective: 'System test objective text.',
      assessment: 'System test assessment text.',
      plan: 'System test plan text.',
      codingReport: { reportText: 'System test coding report.' },
    },
  });

  const signBody = objectValue(await signResponse.json().catch(async () => ({ rawText: await signResponse.text() })));
  await testInfo.attach('signed-note-response.json', {
    body: JSON.stringify(signBody, null, 2),
    contentType: 'application/json',
  });

  expect(signResponse.ok(), `Sign API failed: ${signResponse.status()} ${JSON.stringify(signBody)}`).toBe(true);
  expect(signBody.success, JSON.stringify(signBody, null, 2)).toBe(true);
  expect(signBody.status).toBe('signed');

  const chargeCapture = objectValue(signBody.chargeCapture);
  expect(chargeCapture.chargeId, JSON.stringify(signBody, null, 2)).toBeTruthy();
  expect(String(chargeCapture.status)).toMatch(/ready_for_claim|claim_created/);
  expect(arrayValue(chargeCapture.blockers)).toEqual([]);

  const claimDraft = objectValue(signBody.claimDraft);
  expect(claimDraft.claimId, JSON.stringify(signBody, null, 2)).toBeTruthy();
  expect(claimDraft.ok, JSON.stringify(claimDraft, null, 2)).toBe(true);
  expect(arrayValue(claimDraft.errors)).toEqual([]);

  const snapshotResponse = await request.get(
    `/api/testing/system-workflow/${encounterId}?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const snapshotBody = objectValue(await snapshotResponse.json().catch(async () => ({ rawText: await snapshotResponse.text() })));
  await testInfo.attach('system-workflow-snapshot.json', {
    body: JSON.stringify(snapshotBody, null, 2),
    contentType: 'application/json',
  });

  expect(snapshotResponse.ok(), `Snapshot API failed: ${snapshotResponse.status()} ${JSON.stringify(snapshotBody)}`).toBe(true);
  expect(snapshotBody.success, JSON.stringify(snapshotBody, null, 2)).toBe(true);

  const snapshot = objectValue(snapshotBody.snapshot);
  const charge = objectValue(snapshot.charge);
  const claim = objectValue(snapshot.claim);
  const serviceLines = arrayValue(snapshot.serviceLines) as Record<string, unknown>[];

  expect(charge.id, `No charge row: ${JSON.stringify(snapshot, null, 2)}`).toBeTruthy();
  expect(claim.id, `No claim row: ${JSON.stringify(snapshot, null, 2)}`).toBeTruthy();
  expect(charge.claim_id).toBe(claim.id);
  expect(charge.charge_status).toBe('claim_created');

  expect(arrayValue(charge.diagnosis_codes).length, JSON.stringify(charge, null, 2)).toBeGreaterThan(0);
  expect(arrayValue(charge.service_lines).length, JSON.stringify(charge, null, 2)).toBeGreaterThan(0);
  if (expectedDx) expect(arrayValue(charge.diagnosis_codes)).toContain(expectedDx);

  expect(claim.encounter_id).toBe(encounterId);
  expect(String(claim.claim_status), JSON.stringify(claim, null, 2)).not.toMatch(/draft|on_hold|hold|validation_failed/i);
  expect(arrayValue(claim.diagnosis_codes).length, JSON.stringify(claim, null, 2)).toBeGreaterThan(0);
  if (expectedDx) expect(arrayValue(claim.diagnosis_codes)).toContain(expectedDx);

  expect(serviceLines.length, JSON.stringify(serviceLines, null, 2)).toBeGreaterThan(0);
  for (const line of serviceLines) {
    expect(line.procedure_code).toBeTruthy();
    expect(Number(line.charge_amount)).toBeGreaterThan(0);
    expect(Number(line.units)).toBeGreaterThan(0);
    expect(arrayValue(line.diagnosis_pointers).length).toBeGreaterThan(0);
  }
  if (expectedCpt) expect(serviceLines.map(line => line.procedure_code)).toContain(expectedCpt);
});
