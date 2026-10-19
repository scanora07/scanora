"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { inflateRawSync } = require("node:zlib");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const { Pool } = require("pg");
const { createPool, migrate } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { deleteExpired } = require("../server/gifts.cjs");

function zipEntries(buffer) {
  const entries = [];
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let index = 0; index < count; index++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(start, start + size);
    assert.ok(method === 0 || method === 8);
    entries.push({ name, data: method === 8 ? inflateRawSync(compressed) : compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("standalone admin QR workflow, decoding, database constraints and concurrent activation", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const schema = `invites_test_${randomBytes(8).toString("hex")}`;
  const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await control.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.end();
  });
  // A pre-existing Scanora-like schema must never be converted or overwritten.
  await pool.query("CREATE TABLE shops(id uuid)");
  await assert.rejects(migrate(pool), /not a Scanora Celebrates schema/);
  assert.deepEqual((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='shops'", [schema])).rows.map((row) => row.column_name), ["id"]);
  await pool.query("DROP TABLE shops");
  await migrate(pool);
  await migrate(pool);
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema])).rows;
  assert.deepEqual(tables.map((row) => row.tablename), ["gifts"]);
  // Upgrading the legacy schema removes shop storage without losing invitations.
  await pool.query("CREATE TABLE shops(id uuid PRIMARY KEY)");
  await pool.query("ALTER TABLE gifts ADD COLUMN shop_id uuid REFERENCES shops(id) CHECK (shop_id IS NULL)");
  await pool.query("ALTER TABLE gifts ADD COLUMN template_type text CONSTRAINT scanora_invites_wedding_only CHECK (template_type='wedding')");
  await pool.query("ALTER TABLE gifts ADD CONSTRAINT gifts_details_check CHECK (template_type IS NULL OR occasion_date IS NOT NULL)");
  await pool.query("ALTER TABLE gifts ALTER COLUMN batch_id TYPE uuid USING batch_id::uuid");
  await pool.query("ALTER TABLE gifts DROP CONSTRAINT gifts_public_id_check");
  await pool.query("ALTER TABLE gifts ADD CONSTRAINT gifts_public_id_check CHECK (public_id ~ '^[A-Za-z0-9_-]{32}$')");
  await pool.query("DROP TRIGGER gifts_set_expiry ON gifts");
  const legacyId = "a".repeat(32);
  await pool.query("INSERT INTO gifts(id,public_id,batch_id) VALUES ($1,$2,$1)", ["00000000-0000-4000-8000-000000000001", legacyId]);
  await pool.query(`INSERT INTO gifts(id,public_id,batch_id,template_type,names,occasion_date)
    VALUES ('00000000-0000-4000-8000-000000000002',$1,'00000000-0000-4000-8000-000000000001','wedding',ARRAY['One','Two'],'2027-01-01')`, ["b".repeat(32)]);
  await migrate(pool);
  await migrate(pool);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM gifts WHERE public_id=$1", [legacyId])).rows[0].count, 1);
  assert.equal((await pool.query("SELECT to_regclass('shops') AS name")).rows[0].name, null);
  assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='gifts' AND column_name='shop_id'", [schema])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='gifts' AND column_name='template_type'", [schema])).rowCount, 0);
  const legacySaved = (await pool.query("SELECT batch_id,expires_at FROM gifts WHERE public_id=$1", ["b".repeat(32)])).rows[0];
  assert.equal(legacySaved.batch_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(legacySaved.expires_at.toISOString(), "2027-01-07T18:30:00.000Z");
  await pool.query("DELETE FROM gifts WHERE public_id=$1", ["b".repeat(32)]);

  const config = { adminUsername: "admin", adminPassword: "test-password", sessionSecret: "x".repeat(48), production: false, appUrl: "http://localhost:3001", databaseSchema: schema };
  server = createApp(pool, config).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = "GET", body, headers = {}) => fetch(base + route, {
    method, headers: { Origin: config.appUrl, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "manual"
  });
  assert.equal((await request(`/g/${legacyId}`)).headers.get("location"), `/customize/${legacyId}`);
  assert.equal((await request(`/customize/${legacyId}`)).status, 200);
  await pool.query("DELETE FROM gifts WHERE public_id=$1", [legacyId]);
  assert.equal((await request("/health")).status, 200);
  assert.equal((await request("/api/admin/qr-batches")).status, 401);
  assert.equal((await request("/api/login", "POST", { role: "shop", identifier: "admin", password: "test-password" })).status, 401);
  assert.equal((await request("/api/login", "POST", { identifier: "admin", password: "wrong" })).status, 401);
  const login = await request("/api/login", "POST", { identifier: "admin", password: "test-password" });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.ok(cookie.startsWith("scanora_invites_session="));
  const me = await (await request("/api/me", "GET", undefined, { Cookie: cookie })).json();
  const headers = { Cookie: cookie, "X-CSRF-Token": me.csrfToken };
  assert.equal((await request("/api/admin/qr-batches", "POST", { count: 2 }, { Cookie: cookie })).status, 403);
  for (const count of [0, 1001, 1.5, "2"]) {
    assert.equal((await request("/api/admin/qr-batches", "POST", { count }, headers)).status, 400);
  }
  assert.equal((await request("/api/admin/qr-batches", "POST", { count: 1 }, headers)).status, 400);
  const created = await request("/api/admin/qr-batches", "POST", { count: 1, batchId: "0012" }, headers);
  assert.equal(created.status, 201);
  const batch = await created.json();
  assert.equal((await request("/api/admin/qr-batches", "POST", { count: 1, batchId: "0012" }, headers)).status, 201);
  const filtered = await (await request("/api/admin/qr-batches?batchId=0012", "GET", undefined, headers)).json();
  assert.equal(filtered.batches.length, 1);
  assert.equal(filtered.batches[0].count, 2);
  assert.equal(filtered.batches[0].batch_id, "0012");
  assert.equal((await (await request("/api/admin/qr-batches?batchId=999", "GET", undefined, headers)).json()).batches.length, 0);
  const cards = (await pool.query("SELECT * FROM gifts ORDER BY id")).rows;
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].public_id, cards[1].public_id);
  assert.ok(cards.every((card) => card.occasion_date === null && card.expires_at === null && card.public_id.length === 8 && !Object.hasOwn(card, "template_type") && !Object.hasOwn(card, "shop_id")));
  const download = await request(batch.downloadUrl, "GET", undefined, headers);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /application\/zip/);
  const images = zipEntries(Buffer.from(await download.arrayBuffer()));
  assert.equal(images.length, 2);
  for (const card of cards) {
    const image = images.find((entry) => entry.name === `qr-${card.public_id}.png`);
    assert.ok(image);
    const png = PNG.sync.read(image.data);
    assert.equal(png.width, 1200);
    assert.equal(png.height, 1200);
    let redPixels = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      if (png.data[index + 1] !== 255) {
        assert.deepEqual([...png.data.subarray(index, index + 4)], [255, 0, 0, 255]);
        redPixels++;
      }
    }
    assert.ok(redPixels > 0);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(decoded?.data, `${config.appUrl}/g/${card.public_id}`);
  }
  const id = cards[0].public_id;
  const url = `/g/${id}`;
  const unused = await request(url);
  assert.equal(unused.status, 302);
  assert.equal(unused.headers.get("location"), `/customize/${id}`);
  assert.equal((await request(`/customize/${id}`)).status, 200);
  const input = { names: ["Aarav", "Geetha"], occasionDate: "2027-02-14" };
  assert.equal((await request(`/api/public/gifts/${id}/activate`, "POST", { ...input, occasionDate: "2020-01-01" })).status, 400);
  assert.equal((await request(`/api/public/gifts/${id}/activate`, "POST", { ...input, occasionDate: "2027-02-29" })).status, 400);
  const outcomes = await Promise.all(["First", "Second"].map((name) => request(`/api/public/gifts/${id}/activate`, "POST", { ...input, names: [name, "Geetha"] })));
  assert.deepEqual(outcomes.map((response) => response.status).sort(), [200, 409]);
  const winner = await outcomes.find((response) => response.status === 200).json();
  assert.equal(winner.publicUrl, config.appUrl + url);
  const saved = (await pool.query("SELECT * FROM gifts WHERE public_id=$1", [id])).rows[0];
  assert.equal(saved.expires_at.toISOString(), "2027-02-20T18:30:00.000Z");
  assert.equal((await request(`/api/public/gifts/${id}/activate`, "POST", input)).status, 409);
  assert.deepEqual((await pool.query("SELECT names FROM gifts WHERE public_id=$1", [id])).rows[0].names, saved.names);
  const landing = await request(url);
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.ok(html.includes(`"partnerOneName":"${saved.names[0]}"`));
  assert.ok(html.includes('"occasion":"wedding"'));
  assert.ok(html.includes("/weds/weds.css"));
  assert.equal(landing.headers.get("cache-control"), "no-store");
  assert.match(landing.headers.get("content-security-policy"), /script-src 'self' 'nonce-/);
  assert.equal((await request(`/api/public/gifts/${cards[1].public_id}`)).status, 200);
  assert.equal((await request(`/api/public/gifts/${"x".repeat(32)}/activate`, "POST", input)).status, 404);
  const list = await (await request("/api/admin/qr-batches", "GET", undefined, headers)).json();
  assert.equal(list.batches[0].activated, 1);
  assert.equal(list.batches[0].count, 2);
  const again = await request(batch.downloadUrl, "GET", undefined, headers);
  assert.deepEqual(zipEntries(Buffer.from(await again.arrayBuffer())).map((image) => image.name), images.map((image) => image.name));
  await assert.rejects(pool.query("UPDATE gifts SET names=ARRAY['Only one'] WHERE public_id=$1", [id]), { code: "23514" });
  assert.equal((await request("/api/logout", "POST", undefined, headers)).status, 200);
  // Expired rows cannot be opened even before the periodic deletion runs.
  await pool.query("UPDATE gifts SET occasion_date='2020-01-01' WHERE public_id=$1", [id]);
  assert.equal((await request(url)).headers.get("location"), "/thank-you");
  assert.equal((await request(`/api/public/gifts/${id}`)).status, 404);
  assert.equal((await deleteExpired(pool, schema)).rowCount, 1);
  assert.equal((await request(url)).headers.get("location"), "/thank-you");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM gifts WHERE public_id=$1", [id])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT expires_at FROM gifts WHERE public_id=$1", [cards[1].public_id])).rows[0].expires_at, null);
  const isolatedSchema = `${schema}_isolated`;
  const isolated = createPool(process.env.TEST_DATABASE_URL, isolatedSchema);
  try {
    await migrate(isolated, isolatedSchema);
    await migrate(isolated, isolatedSchema);
    assert.equal((await isolated.query("SELECT current_schema() AS name")).rows[0].name, isolatedSchema);
    assert.equal((await isolated.query("SELECT count(*)::int AS count FROM gifts")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM gifts")).rows[0].count, 1);
    assert.deepEqual((await isolated.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [isolatedSchema])).rows.map((row) => row.tablename), ["gifts"]);
  } finally {
    await isolated.end();
    await control.query(`DROP SCHEMA "${isolatedSchema}" CASCADE`);
  }
});
