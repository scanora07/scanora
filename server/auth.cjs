"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { HttpError } = require("./validation.cjs");
const scrypt = promisify(crypto.scrypt);
const cookieName = "scanora_invites_session";

async function hashPassword(value) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 256) throw new HttpError(400, "Enter a password of at most 256 bytes.");
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(value, salt, 64);
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function verifyPassword(value, stored) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 256) return false;
  const [, salt, expected] = stored.split(":");
  const key = await scrypt(value, salt, 64);
  const buffer = Buffer.from(expected, "hex");
  return key.length === buffer.length && crypto.timingSafeEqual(key, buffer);
}
function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}
function fingerprint(config) {
  return sign(JSON.stringify([config.adminUsername, config.adminPasswordHash || config.adminPassword]), config.sessionSecret);
}
function decodeSession(token, config) {
  if (typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, signature] = token.split(".");
  const expected = sign(payload, config.sessionSecret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { return null; }
  if (!data || data.role !== "admin" || data.credentials !== fingerprint(config)
    || !Number.isFinite(data.expires) || data.expires <= Date.now() || typeof data.csrfToken !== "string") return null;
  return data;
}
function authentication(config) {
  return (req, res, next) => {
    const entry = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
    req.user = decodeSession(entry ? entry.slice(cookieName.length + 1) : null, config);
    next();
  };
}
function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, "Please log in as administrator."));
  next();
}
function csrf(req, res, next) {
  if (!req.user || req.get("X-CSRF-Token") !== req.user.csrfToken) return next(new HttpError(403, "Your session has changed. Refresh and try again."));
  next();
}
function newSession(res, config) {
  const payload = Buffer.from(JSON.stringify({
    role: "admin", credentials: fingerprint(config), csrfToken: crypto.randomBytes(32).toString("hex"),
    expires: Date.now() + 12 * 60 * 60 * 1000
  })).toString("base64url");
  res.cookie(cookieName, `${payload}.${sign(payload, config.sessionSecret)}`, {
    httpOnly: true, secure: config.production, sameSite: "strict", path: "/", maxAge: 12 * 60 * 60 * 1000
  });
}

module.exports = { cookieName, hashPassword, verifyPassword, decodeSession, authentication, requireAdmin, csrf, newSession };
