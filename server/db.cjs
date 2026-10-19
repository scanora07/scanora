"use strict";

const { Pool } = require("pg");
const fs = require("node:fs/promises");
const path = require("node:path");

function validateSchema(schema) {
  if (typeof schema !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(schema) || schema === "public" || schema.startsWith("pg_")) {
    throw new Error("DATABASE_SCHEMA must be a dedicated lowercase schema name, not public or pg_*.");
  }
  return schema;
}

function tableName(schema, table) {
  if (table !== "gifts") throw new Error("Unsupported application table.");
  return schema ? `"${validateSchema(schema)}"."${table}"` : table;
}

function poolOptions(connectionString, schema) {
  if (!schema) return {};
  validateSchema(schema);
  const hostname = new URL(connectionString).hostname;
  return hostname.includes("-pooler") ? {} : { options: `-c search_path=${schema}` };
}

function createPool(connectionString, schema) {
  const pool = new Pool({ connectionString, ...poolOptions(connectionString, schema), max: 10, connectionTimeoutMillis: 60000, idleTimeoutMillis: 30000 });
  pool.on("error", (error) => console.error("Database pool error.", { code: error.code || "UNKNOWN" }));
  return pool;
}

async function transaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate(pool, schema) {
  if (schema) validateSchema(schema);
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(63294072)");
    if (schema) {
      await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await db.query(`SET LOCAL search_path TO "${schema}"`);
    }
    await db.query(await fs.readFile(path.join(__dirname, "..", "migrations", "schema.sql"), "utf8"));
  });
}

module.exports = { createPool, transaction, migrate, validateSchema, tableName, poolOptions };
