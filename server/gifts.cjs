"use strict";

const { randomUUID, randomBytes } = require("node:crypto");
const { integer, shopNumber, HttpError } = require("./validation.cjs");
const { tableName, transaction } = require("./db.cjs");
const calendar = require("../weds/shared/calendar.js");

async function createBatch(pool, count, batchId, schema) {
  integer(count, "QR count", 1, 1000);
  shopNumber(batchId);
  const giftsTable = tableName(schema, "gifts");
  await transaction(pool, async (db) => {
    let remaining = count;
    for (let attempt = 0; remaining && attempt < 5; attempt++) {
      const rows = Array.from({ length: remaining }, () => ({ id: randomUUID(), publicId: randomBytes(6).toString("base64url") }));
      const result = await db.query(`INSERT INTO ${giftsTable}(id,public_id,batch_id)
        SELECT id,public_id,$3 FROM unnest($1::uuid[],$2::text[]) AS cards(id,public_id)
        ON CONFLICT (public_id) DO NOTHING RETURNING id`,
      [rows.map((row) => row.id), rows.map((row) => row.publicId), batchId]);
      remaining -= result.rowCount;
    }
    if (remaining) throw new Error("Unable to generate unique QR identifiers. No cards were created.");
  });
  return { batchId, count, downloadUrl: `/api/admin/qr-batches/${batchId}/download` };
}
async function activateGift(pool, publicId, gift, appUrl, schema) {
  const giftsTable = tableName(schema, "gifts");
  const expiry = calendar.startTimestamp(gift.occasionDate, null, "Asia/Kolkata").getTime() + 7 * 86400000;
  if (expiry <= Date.now()) throw new HttpError(400, "This wedding date has already expired. Choose a date whose seven-day validity has not ended.");
  const result = await pool.query(`UPDATE ${giftsTable} SET names=$2,occasion_date=$3,venue_maps_url=$4
    WHERE public_id=$1 AND names IS NULL AND occasion_date IS NULL
    RETURNING id`, [publicId, gift.names, gift.occasionDate, gift.venueMapsUrl || null]);
  if (result.rowCount) return { publicUrl: `${appUrl}/g/${publicId}` };
  const existing = await pool.query(`SELECT id FROM ${giftsTable} WHERE public_id=$1`, [publicId]);
  if (!existing.rowCount) throw new HttpError(404, "This invitation is not available.");
  throw new HttpError(409, "This QR has already been customized. Open its invitation instead.");
}

async function deleteExpired(pool, schema) {
  return pool.query(`DELETE FROM ${tableName(schema, "gifts")} WHERE expires_at <= now()`);
}

module.exports = { createBatch, activateGift, deleteExpired };
