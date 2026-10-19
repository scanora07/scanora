"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateSchema } = require("./db.cjs");
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

function configuration() {
  const appUrl = new URL(process.env.APP_URL || "http://localhost:3001");
  if (!["http:", "https:"].includes(appUrl.protocol) || appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password) {
    throw new Error("APP_URL must be an HTTP(S) origin without a path or credentials.");
  }
  const production = process.env.NODE_ENV === "production";
  if (production && appUrl.protocol !== "https:") throw new Error("Production APP_URL must use HTTPS.");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL and use a dedicated database or DATABASE_SCHEMA.");
  const databaseSchema = process.env.DATABASE_SCHEMA ? validateSchema(process.env.DATABASE_SCHEMA) : undefined;
  if (!process.env.ADMIN_USERNAME || (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH)) {
    throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH).");
  }
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD_HASH) throw new Error("Use only one administrator password setting.");
  if (process.env.ADMIN_PASSWORD && Buffer.byteLength(process.env.ADMIN_PASSWORD) > 256) throw new Error("ADMIN_PASSWORD must be at most 256 bytes.");
  if (process.env.ADMIN_PASSWORD_HASH && !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(process.env.ADMIN_PASSWORD_HASH)) {
    throw new Error("ADMIN_PASSWORD_HASH must be a valid scrypt password hash.");
  }
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid.");
  return {
    databaseUrl: process.env.DATABASE_URL, databaseSchema, appUrl: appUrl.origin, production, port,
    adminUsername: process.env.ADMIN_USERNAME, adminPassword: process.env.ADMIN_PASSWORD,
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH, sessionSecret: process.env.SESSION_SECRET
  };
}

module.exports = { configuration };
