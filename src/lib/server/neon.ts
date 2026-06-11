import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Server-only Neon (Postgres) client. Reached exclusively from API route
// handlers — never imported into client components. The Vercel ↔ Neon
// integration injects DATABASE_URL (POSTGRES_URL as an alias); we accept either.
//
// The driver is created lazily on first query rather than at module load, so a
// missing connection string doesn't crash the build's page-data collection —
// it only fails the request that actually needs the database.

let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (client) return client;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    "";
  if (!connectionString) {
    throw new Error("No DATABASE_URL / POSTGRES_URL configured for Neon.");
  }
  client = neon(connectionString);
  return client;
}

// Tagged-template entry point. Interpolated values are sent as bound parameters
// (no string concatenation), so this is safe against injection. Pass a row type
// as a type argument, e.g. sql<Pro>`select * from pros`.
export const sql = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> => getClient()(strings, ...values) as Promise<T[]>;
