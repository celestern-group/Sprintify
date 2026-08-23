import { db } from "@/db";

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;

function assertLocalDatabase(url: string, allowRemote: boolean) {
  const { hostname } = new URL(url);
  if (!LOCAL_HOST_PATTERN.test(hostname) && !allowRemote) {
    throw new Error(
      `Refusing to run: DATABASE_URL host "${hostname}" doesn't look like a local database. ` +
        "Pass --allow-remote if this is genuinely your dev database.",
    );
  }
}

async function getPublicTables(): Promise<string[]> {
  const result = await db.execute<{ tablename: string }>(
    `select tablename from pg_tables
     where schemaname = 'public' and tablename != '__drizzle_migrations'`,
  );
  return result.rows.map((row) => row.tablename);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  const args = process.argv.slice(2);
  assertLocalDatabase(url, args.includes("--allow-remote"));

  if (!args.includes("--yes")) {
    throw new Error(
      "This deletes every row in every table of the database. Re-run with --yes to confirm: " +
        "tsx --env-file=.env.local scripts/clean-db.ts --yes",
    );
  }

  const tables = await getPublicTables();
  if (tables.length === 0) {
    console.log("No tables found.");
    return;
  }

  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await db.execute(`truncate table ${quoted} restart identity cascade`);
  console.log(`Truncated ${tables.length} table(s): ${tables.join(", ")}`);
}

main()
  .catch((error) => {
    console.error("Failed to clean database:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
