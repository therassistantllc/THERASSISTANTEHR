import { Client } from "pg";

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for billing-smoke.ts");
  }
  return url;
}

async function countQuery(client: Client, label: string, sql: string): Promise<number> {
  const result = await client.query(sql);
  const value = Number(result.rows[0]?.count ?? 0);
  console.log(`${label}: ${value}`);
  return value;
}

async function main() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();

  try {
    console.log("CLAIM STATUS COUNTS");
    const claimStatuses = await client.query(
      `select claim_status, count(*)::int as count
       from public.professional_claims
       group by claim_status
       order by claim_status`,
    );
    for (const row of claimStatuses.rows) {
      console.log(`${row.claim_status}: ${row.count}`);
    }

    console.log("\n837P BATCH STATUS COUNTS");
    const batchStatuses = await client.query(
      `select batch_status, count(*)::int as count
       from public.claim_837p_batches
       group by batch_status
       order by batch_status`,
    );
    for (const row of batchStatuses.rows) {
      console.log(`${row.batch_status}: ${row.count}`);
    }

    console.log("\nELIGIBILITY BATCH STATUS COUNTS");
    const eligibilityStatuses = await client.query(
      `select batch_status, count(*)::int as count
       from public.eligibility_270_batches
       group by batch_status
       order by batch_status`,
    );
    for (const row of eligibilityStatuses.rows) {
      console.log(`${row.batch_status}: ${row.count}`);
    }

    console.log("\nREADINESS EXCEPTIONS");
    const missingPatientAccount = await countQuery(
      client,
      "Batchable claims missing patient account number",
      `select count(*)::int as count
       from public.professional_claims
       where claim_status in ('ready_for_batch', 'batched', 'submitted')
         and nullif(trim(coalesce(patient_account_number, '')), '') is null`,
    );

    const missingDiagnosis = await countQuery(
      client,
      "Batchable claims missing diagnosis codes",
      `select count(*)::int as count
       from public.professional_claims
       where claim_status in ('ready_for_batch', 'batched', 'submitted')
         and (diagnosis_codes is null or array_length(diagnosis_codes, 1) is null)`,
    );

    const missingServiceLines = await countQuery(
      client,
      "Batchable claims missing service lines",
      `select count(*)::int as count
       from public.professional_claims pc
       where pc.claim_status in ('ready_for_batch', 'batched', 'submitted')
         and not exists (
           select 1
           from public.professional_claim_service_lines sl
           where sl.claim_id = pc.id
         )`,
    );

    const zeroChargeServiceLines = await countQuery(
      client,
      "Service lines with non-positive charge amount",
      `select count(*)::int as count
       from public.professional_claim_service_lines
       where coalesce(charge_amount, 0) <= 0`,
    );

    const failures =
      missingPatientAccount + missingDiagnosis + missingServiceLines + zeroChargeServiceLines;

    if (failures > 0) {
      throw new Error(`${failures} billing readiness exception(s) found.`);
    }

    console.log("\nBilling smoke test passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
