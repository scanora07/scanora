"use strict";

const calendar = require("../weds/shared/calendar.js");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function text(value, label, max) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || [...normalized].length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new HttpError(400, `${label} must contain 1-${max} characters without control characters.`);
  }
  return normalized;
}
function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label} must be an integer between ${min} and ${max}.`);
  return value;
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "Batch identifier is invalid.");
  }
  return value;
}
function publicId(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{32})$/.test(value)) throw new HttpError(404, "This invitation is not available.");
  return value;
}
function shopNumber(value) {
  if (typeof value !== "string" || !/^[0-9]{1,20}$/.test(value)) throw new HttpError(400, "Enter a shop number of 1-20 digits.");
  return value;
}
function batchId(value) {
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return value;
  return uuid(value);
}
function giftInput(body) {
  if (!Array.isArray(body.names) || body.names.length !== 2) throw new HttpError(400, "Enter both names.");
  const names = Array.from(body.names, (name, index) => text(name, index ? "Second name" : "First name", 30));
  if (typeof body.occasionDate !== "string" || !/^(19|20)\d{2}-\d{2}-\d{2}$/.test(body.occasionDate)) {
    throw new HttpError(400, "Choose a wedding date between 1900 and 2099.");
  }
  try { calendar.startTimestamp(body.occasionDate, null, "Asia/Kolkata"); }
  catch { throw new HttpError(400, "Choose a valid wedding date."); }
  let venueMapsUrl;
  try { venueMapsUrl = calendar.venueMapsUrl(body.venueMapsUrl); }
  catch (error) { throw new HttpError(400, error.message); }
  return { names, occasionDate: body.occasionDate, ...(venueMapsUrl ? { venueMapsUrl } : {}) };
}

module.exports = { HttpError, text, integer, uuid, publicId, shopNumber, batchId, giftInput };
