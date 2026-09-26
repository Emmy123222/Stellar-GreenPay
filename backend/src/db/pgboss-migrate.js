"use strict";

const PgBoss = require("pg-boss");

async function main() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.stop({ graceful: false });

  console.log("[pgboss] Schema migrated successfully");
  process.exit(0);
}

main().catch((err) => {
  console.error("[pgboss] Migration failed:", err.message);
  process.exit(1);
});
