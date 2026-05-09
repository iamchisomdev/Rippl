import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  console.log("→ Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
