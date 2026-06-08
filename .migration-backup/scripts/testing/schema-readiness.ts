import { Client } from "pg";

const REQUIRED_TABLES = [
  "professional_claims",
  "professional_claim_service_lines",
  "claim_status_events",
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
  charge_capture_items: [
    "claim_id",
    "claim_created_at",
  ],
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
  claim_status_events: [
    "claim_id",
    "source",
    "detail",
    "status",
    "status_message",
    "raw_payload",
    "created_at",
  ],
  claim_parties_snapshot: [
    "billing_provider_taxonomy",
    "submitter_id",
    "submitter_name",
    "submitter_contact_email",
  ],
  clearinghouse_connections: [
    "claims_x12_version",
    "eligibility_x12_version",
  ],
};

const REQUIRED_FUNCTIONS = [
  "billing_ready_to_generate_page",
  "create_837p_batch_atomic",
];

const REQUIRED_CODE_REFERENCES = [
  {
    tableName: "diagnosis_codes",
    code: "Z81.8",
    codeSystem: "ICD-10-CM",
  },
  {
    tableName: "procedure_codes",
    code: "90899",
    codeSystem: "CPT",
  },
] as const;

const REQUIRED_FOREIGN_KEYS = [
  {
    tableName: "charge_capture_items",
    constraintName: "charge_capture_items_claim_id_fkey",
    referencedTableName: "professional_claims",
  },
] as const;

const CODE_REFERENCE_QUERIES: Record<(typeof REQUIRED_CODE_REFERENCES)[number]["tableName"], string> = {
  diagnosis_codes: `select exists (
    select 1
    from public.diagnosis_codes
    where code = $1
      and code_system = $2
      and is_active = true
  ) as exists`,
  procedure_codes: `select exists (
    select 1
    from public.procedure_codes
    where code = $1
      and code_system = $2
      and is_active = true
  ) as exists`,
};

function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

async function main() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    console.warn(
      "SKIP schema-readiness: DATABASE_URL or POSTGRES_URL is not set.",
    );
    process.exit(0);
  }

  const client = new Client({ connectionString: databaseUrl });
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

    console.log("\nSCHEMA FUNCTION CHECK");
    for (const functionName of REQUIRED_FUNCTIONS) {
      const result = await client.query(
        `select exists (
          select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = $1
        ) as exists`,
        [functionName],
      );
      const exists = Boolean(result.rows[0]?.exists);
      console.log(`${exists ? "OK  " : "MISS"} ${functionName}()`);
      if (!exists) failures += 1;
    }

    console.log("\nBILLING CODE REFERENCE CHECK");
    for (const reference of REQUIRED_CODE_REFERENCES) {
      const result = await client.query(
        CODE_REFERENCE_QUERIES[reference.tableName],
        [reference.code, reference.codeSystem],
      );
      const exists = Boolean(result.rows[0]?.exists);
      console.log(
        `${exists ? "OK  " : "MISS"} ${reference.tableName}.${reference.codeSystem}:${reference.code}`,
      );
      if (!exists) failures += 1;
    }

    console.log("\nSCHEMA FOREIGN KEY CHECK");
    for (const foreignKey of REQUIRED_FOREIGN_KEYS) {
      const result = await client.query(
        `select exists (
          select 1
          from pg_constraint c
          join pg_class source_table on source_table.oid = c.conrelid
          join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
          join pg_class referenced_table on referenced_table.oid = c.confrelid
          join pg_namespace referenced_schema on referenced_schema.oid = referenced_table.relnamespace
          where c.contype = 'f'
            and source_schema.nspname = 'public'
            and referenced_schema.nspname = 'public'
            and source_table.relname = $1
            and c.conname = $2
            and referenced_table.relname = $3
        ) as exists`,
        [
          foreignKey.tableName,
          foreignKey.constraintName,
          foreignKey.referencedTableName,
        ],
      );
      const exists = Boolean(result.rows[0]?.exists);
      console.log(
        `${exists ? "OK  " : "MISS"} ${foreignKey.tableName}.${foreignKey.constraintName} -> ${foreignKey.referencedTableName}`,
      );
      if (!exists) failures += 1;
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
