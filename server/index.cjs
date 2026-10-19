"use strict";

const { configuration } = require("./config.cjs");
const { createPool, tableName } = require("./db.cjs");
const { createApp } = require("./app.cjs");
const { deleteExpired } = require("./gifts.cjs");

async function main() {
  const config = configuration();
  const pool = createPool(config.databaseUrl, config.databaseSchema);
  try {
    const giftsTable = tableName(config.databaseSchema, "gifts");
    const result = await pool.query(`SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass($1) AND conname='scanora_invites_details'
      AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) AND attname='expires_at' AND NOT attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) AND attname='template_type' AND NOT attisdropped)`, [giftsTable]);
    if (!result.rowCount) throw new Error("Wrong or uninitialized database.");
    await deleteExpired(pool, config.databaseSchema);
  } catch {
    await pool.end();
    throw new Error("Scanora Celebrates database unavailable or uninitialized. Check DATABASE_URL, then run npm run migrate.");
  }
  const server = createApp(pool, config).listen(config.port, () => console.log(`Scanora Celebrates is ready at ${config.appUrl}`));
  let cleaning = false;
  const cleanup = setInterval(async () => {
    if (cleaning) return;
    cleaning = true;
    try { await deleteExpired(pool, config.databaseSchema); }
    catch (error) { console.error("Expired invitation cleanup failed:", error.message); }
    finally { cleaning = false; }
  }, 60000);
  const shutdown = () => {
    clearInterval(cleanup);
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
