"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../server/app.cjs");
const { giftInput, publicId, shopNumber } = require("../server/validation.cjs");
const { hashPassword, verifyPassword, decodeSession } = require("../server/auth.cjs");
const { safeJson, renderGift } = require("../server/render.cjs");
const { validateSchema, tableName, poolOptions } = require("../server/db.cjs");
const { createBatch } = require("../server/gifts.cjs");

test("shared database schemas must be dedicated and safe identifiers", () => {
  assert.equal(validateSchema("scanora_invites"), "scanora_invites");
  for (const schema of ["public", "pg_catalog", 'invites";DROP SCHEMA public', "", "Uppercase", "a".repeat(64)]) {
    assert.throws(() => validateSchema(schema), /DATABASE_SCHEMA/);
  }
  assert.equal(tableName("scanora_invites", "gifts"), '"scanora_invites"."gifts"');
  assert.equal(tableName(undefined, "gifts"), "gifts");
  assert.throws(() => tableName("public", "gifts"), /DATABASE_SCHEMA/);
  assert.throws(() => tableName("scanora_invites", "other"), /Unsupported application table/);
  assert.deepEqual(poolOptions("postgresql://user:pass@db.example.test/neondb", "scanora_invites"),
    { options: "-c search_path=scanora_invites" });
  assert.deepEqual(poolOptions("postgresql://user:pass@ep-pooler.example.test/neondb", "scanora_invites"), {});
});

const wedding = { names: ["Aarav", "Geetha"], occasionDate: "2027-02-14" };

test("only weddings with two names and a real 1900-2099 date are accepted", () => {
  assert.deepEqual(giftInput(wedding), wedding);
  for (const names of [[], ["One"], ["One", "Two", "Three"], ["", "Two"], ["a".repeat(31), "Two"], ["One\nTwo", "Three"]]) {
    assert.throws(() => giftInput({ ...wedding, names }));
  }
  for (const occasionDate of ["2027-02-29", "2100-01-01", "1899-12-31", "2026-13-01", "<script>"]) {
    assert.throws(() => giftInput({ ...wedding, occasionDate }));
  }
  assert.equal(giftInput({ ...wedding, occasionDate: "2028-02-29" }).occasionDate, "2028-02-29");
});

test("short public IDs retain legacy links and shop numbers preserve leading zeros", () => {
  for (const id of ["Ab_12-xy", "a".repeat(32)]) assert.equal(publicId(id), id);
  for (const id of ["a".repeat(7), "a".repeat(9), "a".repeat(31), "abcd/xyz"]) assert.throws(() => publicId(id));
  assert.equal(shopNumber("0012"), "0012");
  for (const value of [12, "", "a12", "1".repeat(21)]) assert.throws(() => shopNumber(value));
});

test("short QR collisions are retried atomically instead of losing requested cards", async () => {
  const commands = [];
  let inserts = 0;
  let collideAlways = false;
  const client = {
    query: async (sql, values) => {
      commands.push(sql);
      if (!values) return {};
      assert.ok(values[1].every((id) => /^[A-Za-z0-9_-]{8}$/.test(id)));
      inserts++;
      return { rowCount: collideAlways || inserts === 1 ? 0 : values[0].length };
    },
    release() {}
  };
  const pool = { connect: async () => client };
  const result = await createBatch(pool, 2, "0012");
  assert.equal(result.count, 2);
  assert.equal(result.batchId, "0012");
  assert.equal(inserts, 2);
  assert.equal(commands.at(-1), "COMMIT");
  collideAlways = true;
  await assert.rejects(createBatch(pool, 2, "0012"), /unique QR identifiers/);
  assert.equal(commands.at(-1), "ROLLBACK");
});

test("personalization preserves template markup and uses local assets without sample config", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "weds", "index.html"), "utf8");
  const html = renderGift({ names: ["</script><script>alert(1)</script>", "Geetha"], occasion_date: "2027-02-14" }, "test-nonce");
  assert.ok(html.includes('<script nonce="test-nonce">window.WEDS_GIFT='));
  assert.ok(html.includes('"occasion":"wedding"'));
  assert.ok(html.includes('"timezone":"Asia/Kolkata"'));
  assert.ok(!html.includes("</script><script>alert"));
  assert.ok(!html.includes("/gift.js"));
  const expected = source
    .replaceAll('src="./', 'src="/weds/').replaceAll('href="./', 'href="/weds/')
    .replace('<script src="/weds/gift.js" defer></script>', "PERSONALIZATION");
  assert.equal(html.replace(/<script nonce="test-nonce">window.WEDS_GIFT=.*?;<\/script>/, "PERSONALIZATION"), expected);
  assert.equal(safeJson("<>&"), '"\\u003c\\u003e&"');
});

test("admin passwords are salted and oversized or malformed sessions are rejected", async () => {
  const hash = await hashPassword("test-password");
  assert.notEqual(hash, await hashPassword("test-password"));
  assert.equal(await verifyPassword("test-password", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  assert.equal(await verifyPassword("x".repeat(257), hash), false);
  for (const token of [null, "", "bad.token", "a".repeat(3000)]) assert.equal(decodeSession(token, { sessionSecret: "test" }), null);
});

test("missing invitation links show a shared gratitude page, not an invalid-link error", async (t) => {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const server = createApp(pool, { adminUsername: "admin", adminPassword: "password", sessionSecret: "x".repeat(48), appUrl: "http://localhost:3001", production: false }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/g/Ab_12-xy", `/g/${"a".repeat(32)}`, "/g/bad", "/customize/bad"]) {
    const response = await fetch(base + route, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/thank-you");
  }
  const page = await fetch(base + "/thank-you");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Thank you for your warm wishes/);
  assert.equal((await fetch(base + "/api/public/gifts/Ab_12-xy")).status, 404);
});

test("HTTP guards expose no shop management and only serve approved template assets", async (t) => {
  let queries = 0;
  const pool = { query: async () => { queries++; return { rows: [], rowCount: 0 }; } };
  const app = createApp(pool, { adminUsername: "admin", adminPassword: "password", sessionSecret: "x".repeat(48), appUrl: "http://localhost:3001", production: false });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/shop/login", "/shop/dashboard", "/api/admin/shops", "/api/gifts", "/templates/birthday/birthday.js",
    "/weds/gift.js", "/weds/preview.cjs", "/weds/weds.test.cjs", "/templates/love/love.js", "/.env", "/server/config.cjs"]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(base + "/api/admin/qr-batches")).status, 401);
  assert.equal((await fetch(base + "/api/admin/qr-batches/00000000-0000-4000-8000-000000000000/download")).status, 401);
  const catalog = await (await fetch(base + "/api/public/catalog")).json();
  assert.deepEqual(catalog.templates.map((item) => item.id), ["wedding"]);
  for (const route of ["/weds/shared/calendar.js", "/weds/weds.js", "/weds/weds.css", "/weds/assets/end-frame.png"]) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  assert.equal((await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3001" }, body: "[]" })).status, 400);
  assert.equal(queries, 0);
});
