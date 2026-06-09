import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Encrypt traffic in transit for remote databases (e.g. Supabase). The
// Supabase connection pooler presents a self-signed certificate chain, so we
// enable TLS without strict chain verification. Local Postgres (localhost)
// typically has no TLS, so SSL is disabled there to avoid connection errors.
const isLocalDatabase = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(
  connectionString,
);

export const pool = new Pool({
  connectionString,
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
