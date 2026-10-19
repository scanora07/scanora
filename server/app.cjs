"use strict";

const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const QRCode = require("qrcode");
const { ZipFile } = require("yazl");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const auth = require("./auth.cjs");
const v = require("./validation.cjs");
const gifts = require("./gifts.cjs");
const { tableName } = require("./db.cjs");
const { renderGift } = require("./render.cjs");

function createApp(pool, config) {
  const app = express();
  app.disable("x-powered-by");
  const giftsTable = tableName(config.databaseSchema, "gifts");
  const publicRoot = path.join(__dirname, "..", "public");
  const templateRoot = path.join(__dirname, "..", "weds");
  const adminPassword = config.adminPasswordHash ? Promise.resolve(config.adminPasswordHash) : auth.hashPassword(config.adminPassword);
  app.use((req, res, next) => { res.locals.nonce = randomBytes(18).toString("base64"); next(); });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"], imgSrc: ["'self'", "data:"],
        mediaSrc: ["'self'"], connectSrc: ["'self'"], frameSrc: ["'self'"],
        frameAncestors: ["'self'"], formAction: ["'self'"],
        upgradeInsecureRequests: config.production ? [] : null
      }
    },
    strictTransportSecurity: config.production ? undefined : false,
    referrerPolicy: { policy: "no-referrer" }
  }));
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin") !== config.appUrl) {
      return next(new v.HttpError(403, "Request origin is not allowed."));
    }
    if (req.path.startsWith("/api/") && req.path !== "/api/logout" && ["POST", "PUT", "PATCH"].includes(req.method)
      && (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
      return next(new v.HttpError(400, "Send a valid request object."));
    }
    next();
  });
  app.get("/health", async (req, res) => { await pool.query("SELECT 1"); res.json({ status: "ok" }); });
  app.use("/api", auth.authentication(config));
  app.use("/api", rateLimit({ windowMs: 60000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Too many requests. Wait a minute and try again." } }));
  app.post("/api/login", rateLimit({ windowMs: 15 * 60000, limit: 15,
    message: { error: "Too many login attempts. Please try again in 15 minutes." } }), async (req, res) => {
    const { identifier, password, role } = req.body;
    const valid = await auth.verifyPassword(password, await adminPassword);
    if ((role !== undefined && role !== "admin") || typeof identifier !== "string"
      || identifier.trim() !== config.adminUsername || !valid) throw new v.HttpError(401, "Invalid administrator credentials.");
    auth.newSession(res, config);
    res.json({ role: "admin" });
  });
  app.get("/api/me", auth.requireAdmin, (req, res) => res.json({ role: "admin", csrfToken: req.user.csrfToken }));
  app.post("/api/logout", auth.requireAdmin, auth.csrf, (req, res) => {
    res.clearCookie(auth.cookieName, { path: "/", httpOnly: true, sameSite: "strict", secure: config.production });
    res.json({ ok: true });
  });
  app.get("/api/public/catalog", (req, res) => res.json({
    templates: [{ id: "wedding", name: "Wedding invitation", family: "weds", dateLabel: "Wedding date" }]
  }));
  app.get("/api/public/gifts/:publicId", async (req, res) => {
    const id = v.publicId(req.params.publicId);
    const row = (await pool.query(`SELECT occasion_date FROM ${giftsTable} WHERE public_id=$1 AND (expires_at IS NULL OR expires_at > now())`, [id])).rows[0];
    if (!row) throw new v.HttpError(404, "This invitation is not available.");
    res.json({ unused: row.occasion_date === null, publicUrl: `${config.appUrl}/g/${id}` });
  });
  app.post("/api/public/gifts/:publicId/activate",
    rateLimit({ windowMs: 60000, limit: 30, message: { error: "Too many submissions. Try again in a minute." } }),
    async (req, res) => res.json(await gifts.activateGift(pool, v.publicId(req.params.publicId), v.giftInput(req.body), config.appUrl, config.databaseSchema)));
  app.get("/api/public/gifts/:publicId/edit", async (req, res) => {
    const id = v.publicId(req.params.publicId);
    const row = (await pool.query(`SELECT names,to_char(occasion_date,'YYYY-MM-DD') AS occasion_date,venue_maps_url FROM ${giftsTable} WHERE public_id=$1 AND occasion_date IS NOT NULL AND expires_at > now()`, [id])).rows[0];
    if (!row) throw new v.HttpError(404, "This invitation is not available.");
    res.set("Cache-Control", "no-store").json({ names: row.names, occasionDate: row.occasion_date, venueMapsUrl: row.venue_maps_url });
  });
  app.put("/api/public/gifts/:publicId",
    rateLimit({ windowMs: 60000, limit: 30, message: { error: "Too many submissions. Try again in a minute." } }),
    async (req, res) => res.json(await gifts.updateGift(pool, v.publicId(req.params.publicId), v.giftInput(req.body), config.appUrl, config.databaseSchema)));
  app.get("/api/admin/qr-batches", auth.requireAdmin, async (req, res) => {
    const page = v.integer(Number(req.query.page || 1), "Page", 1, 100000);
    const batchId = req.query.batchId === undefined ? null : v.batchId(req.query.batchId);
    const rows = (await pool.query(`SELECT batch_id,count(*)::int AS count,
      count(*) FILTER (WHERE occasion_date IS NOT NULL)::int AS activated,min(created_at) AS created_at
      FROM ${giftsTable} WHERE ($2::text IS NULL OR batch_id=$2)
      AND (expires_at IS NULL OR expires_at > now())
      GROUP BY batch_id ORDER BY min(created_at) DESC,batch_id LIMIT 51 OFFSET $1`, [(page - 1) * 50, batchId])).rows;
    res.json({ batches: rows.slice(0, 50), hasMore: rows.length > 50, page });
  });
  app.post("/api/admin/qr-batches", auth.requireAdmin, auth.csrf, async (req, res) =>
    res.status(201).json(await gifts.createBatch(pool, req.body.count, req.body.batchId, config.databaseSchema)));
  app.get("/api/admin/qr-batches/:id/download", auth.requireAdmin, async (req, res) => {
    const id = v.batchId(req.params.id);
    const rows = (await pool.query(`SELECT public_id FROM ${giftsTable} WHERE batch_id=$1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY id`, [id])).rows;
    if (!rows.length) throw new v.HttpError(404, "QR batch not found.");
    const images = [];
    for (const row of rows) {
      images.push({
        publicId: row.public_id,
        png: await QRCode.toBuffer(`${config.appUrl}/g/${row.public_id}`, {
          errorCorrectionLevel: "M", margin: 4, width: 1200, color: { dark: "#ff0000", light: "#ffffff" }
        })
      });
    }
    const zip = new ZipFile();
    const buffers = [];
    zip.outputStream.on("data", (chunk) => buffers.push(chunk));
    const completed = new Promise((resolve, reject) => {
      zip.outputStream.once("end", resolve);
      zip.outputStream.once("error", reject);
      zip.once("error", reject);
    });
    for (const image of images) zip.addBuffer(image.png, `qr-${image.publicId}.png`);
    zip.end();
    await completed;
    res.set("Content-Disposition", `attachment; filename="scanora-celebrates-qr-${id}.zip"`);
    res.type("application/zip").send(Buffer.concat(buffers));
  });
  app.get("/g/:publicId", async (req, res) => {
    const id = v.publicId(req.params.publicId);
    const row = (await pool.query(`SELECT *,to_char(occasion_date,'YYYY-MM-DD') AS occasion_date FROM ${giftsTable} WHERE public_id=$1 AND (expires_at IS NULL OR expires_at > now())`, [id])).rows[0];
    if (!row) return res.redirect("/thank-you");
    if (row.occasion_date === null) return res.redirect(`/customize/${id}`);
    res.type("html").send(renderGift(row, res.locals.nonce));
  });
  app.use("/weds", (req, res, next) => {
    if (!/^\/(?:shared\/calendar\.js|weds\.(?:css|js)|assets\/[a-z-]+\.(?:png|jpg|svg|mp4))$/.test(req.path)) {
      return next(new v.HttpError(404, "Not found."));
    }
    next();
  }, express.static(templateRoot, { dotfiles: "deny", maxAge: "1d" }));
  app.use(express.static(publicRoot, { index: false, dotfiles: "deny", maxAge: 0 }));
  app.get("/", (req, res) => res.redirect("/admin/login"));
  app.get("/thank-you", (req, res) => res.sendFile(path.join(publicRoot, "thank-you.html")));
  app.get(["/admin/login", "/admin/dashboard", "/admin/qr-batches"], (req, res) => res.sendFile(path.join(publicRoot, "index.html")));
  app.get(/^(?:\/customize\/(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{32})|\/g\/(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{32})\/edit)$/, (req, res) => res.sendFile(path.join(publicRoot, "index.html")));
  app.use((req, res, next) => next(new v.HttpError(404, "Page not found.")));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const expected = error instanceof v.HttpError;
    const badBody = error.type === "entity.parse.failed" || error.type === "entity.too.large";
    const status = expected ? error.status : badBody ? 400 : 500;
    if (status === 404 && /^\/(?:g|customize)\/[^/]+(?:\/edit)?\/?$/.test(req.path)) return res.redirect("/thank-you");
    const message = expected ? error.message : badBody ? "The request is invalid or too large." : "Something went wrong. Please try again; contact the administrator if it continues.";
    if (status >= 500) console.error("Request failed.", { method: req.method, route: req.route?.path?.toString() || "unmatched", code: error.code || "INTERNAL" });
    res.set("Cache-Control", "no-store").status(status);
    if (req.path.startsWith("/api/") || req.path === "/health") return res.json({ error: message });
    const escaped = message.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    res.type("html").send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scanora Celebrates</title><link rel="stylesheet" href="/portal.css"><main class="shell"><h1>Unable to open this page</h1><p>${escaped}</p></main></html>`);
  });
  return app;
}

module.exports = { createApp };
