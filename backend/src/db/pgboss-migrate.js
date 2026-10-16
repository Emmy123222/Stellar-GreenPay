"use strict";

const PgBoss = require("pg-boss");
const logger = require("../logger");

async function main() {
  const connectionString =
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/greenpay";

  const boss = new PgBoss(connectionString);
  await boss.start();
  await boss.stop({ graceful: false });

  logger.info({ event: "pgboss_schema_migrated" }, "[pgboss] Schema migrated successfully");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ event: "pgboss_migration_failed", err: err.message }, `[pgboss] Migration failed: ${err.message}`);
  process.exit(1);
});
