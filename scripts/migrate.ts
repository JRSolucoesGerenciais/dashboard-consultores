/**
 * Aplica as migrações em drizzle/ no banco de DATABASE_URL (Supabase/Postgres).
 *
 *   pnpm db:migrate
 *
 * Para migrar, prefira a conexão "Session pooler" (porta 5432 do pooler) ou a
 * direta; o pooler em modo transação (6543) é para a aplicação.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (ou MIGRATE_DATABASE_URL).");
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = postgres(url, { max: 1, prepare: false, ssl: local ? false : "require" });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migrações aplicadas.");
} catch (error) {
  console.error("Falha ao migrar:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
