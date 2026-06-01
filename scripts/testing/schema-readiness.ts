import { Client } from "pg";

const REQUIRED_TABLES = [
  "professional_claims",
  "professional_claim_service_lines",
  "claim_837p_batches",
  "claim_837p_batch_claims",
  "eligibility_270_batches",
  "eligibility_270_batch_requests",
  "eligibility_checks",
  "payment_import_batches",
  "payment_import_items",
  "era_posting_ledger_entries",
  "mailroom_items",
  "workqueue_items",
  "payer_profiles",
  "clearinghouse_connections",
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  professional_claims: [
    "patient_account_number",
    "claim_status",
    "diagnosis_codes",
    "total_charge",
  ],
  professional_claim_service_lines: [
    "claim_id",
    "procedure_code",
    "service_date_from",
    "charge_amount",
  ],
  payer_profiles: ["payer_id"],
  clearinghouse_connections: [
    "claims_x12_version",
    "eligibility_x12_version",
  ],
};

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL is required for schema-readiness.ts",
    );
  }
  return url;
}

async function main() {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();

  try {
    let failures = 0;

    console.log("SCHEMA TABLE CHECK");
    for (const tableName of REQUIRED_TABLES) {
      const result = await client.query(
        `select exists (
          select 1
          from information_schema.tables
          where table_schema = 'public'
            and table_name = $1
        ) as exists`,
        [tableName],
      );
      const exists = Boolean(result.rows[0]?.exists);
      console.log(`${exists ? "OK  " : "MISS"} ${tableName}`);
      if (!exists) failures += 1;
    }

    console.log("\nSCHEMA COLUMN CHECK");
    for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
      for (const columnName of columns) {
        const result = await client.query(
          `select exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = $1
              and column_name = $2
          ) as exists`,
          [tableName, columnName],
        );
        const exists = Boolean(result.rows[0]?.exists);
        console.log(`${exists ? "OK  " : "MISS"} ${tableName}.${columnName}`);
        if (!exists) failures += 1;
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} required schema item(s) are missing.`);
    }

    console.log("\nSchema readiness passed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
