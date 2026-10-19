"use strict";

const { configuration } = require("./config.cjs");
const { createPool, migrate } = require("./db.cjs");

async function main() {
  const config = configuration();
  const pool = createPool(config.databaseUrl, config.databaseSchema);
  try {
    await migrate(pool, config.databaseSchema);
    console.log("Scanora Celebrates schema applied. One table: gifts.");
  } finally { await pool.end(); }
}
main().catch((error) => {
  console.error(error.code ? `Migration failed (${error.code}). ${error.code === "P0001" ? error.message : "Check database access and use a separate empty database."}` : error.message);
  process.exitCode = 1;
});
