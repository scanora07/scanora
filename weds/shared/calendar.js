"use strict";

// Timezone- and DST-aware calendar math shared by every gift template.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GiftCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const formatters = new Map();

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a date in YYYY-MM-DD format.");
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error("The gift date is not a valid calendar date.");
    }
    return date;
  }

  function localParts(date, timezone) {
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp.");
    if (!formatters.has(timezone)) {
      formatters.set(timezone, new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
      }));
    }
    const parts = {};
    for (const part of formatters.get(timezone).formatToParts(date)) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    return parts;
  }

  function wallTimestamp(parts) {
    const result = new Date(0);
    result.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    result.setUTCHours(parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
    return result.getTime();
  }

  // Resolve wall-clock values using the offsets on both sides of a DST change.
  function fromLocal(parts, timezone, allowGap = false) {
    const wall = wallTimestamp(parts);
    const candidates = new Set();
    for (const shift of [-2, -1, 0, 1, 2]) {
      const probe = wall + shift * DAY;
      const offset = wallTimestamp(localParts(new Date(probe), timezone)) - probe;
      candidates.add(wall - offset);
    }
    const matching = [...candidates].filter((candidate) =>
      wallTimestamp(localParts(new Date(candidate), timezone)) === wall).sort((a, b) => a - b);
    if (matching.length) return new Date(matching[0]);
    if (allowGap) {
      const later = [...candidates].filter((candidate) =>
        wallTimestamp(localParts(new Date(candidate), timezone)) > wall).sort((a, b) => a - b);
      if (later.length) return new Date(later[0]);
    }
    throw new Error("This local time does not exist because of a timezone clock change. Choose another start time.");
  }

  function startTimestamp(date, time = null, timezone = "UTC") {
    const parsed = parseDate(date);
    const clock = time == null ? "00:00:00" : time;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock)) {
      throw new Error("Use a valid start time in HH:mm or HH:mm:ss format.");
    }
    const [hour, minute, second = 0] = clock.split(":").map(Number);
    return fromLocal({
      year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate(), hour, minute, second
    }, timezone);
  }

  function daysInMonth(year, month) {
    const date = new Date(0);
    date.setUTCFullYear(year, month, 0);
    return date.getUTCDate();
  }

  function addMonths(date, months, timezone) {
    const parts = localParts(date, timezone);
    const index = parts.month - 1 + months;
    const year = parts.year + Math.floor(index / 12);
    const month = ((index % 12) + 12) % 12 + 1;
    const result = fromLocal({ ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) }, timezone, true);
    result.setUTCMilliseconds(date.getUTCMilliseconds());
    return result;
  }

  function addDays(date, days, timezone) {
    const parts = localParts(date, timezone);
    const shifted = new Date(wallTimestamp(parts) + days * DAY);
    const result = fromLocal({
      ...parts, year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate()
    }, timezone, true);
    result.setUTCMilliseconds(date.getUTCMilliseconds());
    return result;
  }

  function duration(start, end, timezone = "UTC") {
    if (end < start) throw new Error("Duration end must not precede its start.");
    const first = localParts(start, timezone);
    const last = localParts(end, timezone);
    let months = (last.year - first.year) * 12 + last.month - first.month;
    if (addMonths(start, months, timezone) > end) months -= 1;
    const anchor = addMonths(start, months, timezone);
    let days = Math.max(0, Math.floor((wallTimestamp(last) - wallTimestamp(localParts(anchor, timezone))) / DAY));
    while (addDays(anchor, days + 1, timezone) <= end) days += 1;
    while (addDays(anchor, days, timezone) > end) days -= 1;
    const rest = end - addDays(anchor, days, timezone);
    return {
      years: Math.floor(months / 12), months: months % 12, days,
      hours: Math.floor(rest / HOUR), minutes: Math.floor((rest % HOUR) / MINUTE),
      seconds: Math.floor((rest % MINUTE) / SECOND)
    };
  }

  function anniversary(start, now, timezone = "UTC") {
    if (start > now) return { date: start, today: false, progress: 0 };
    const first = localParts(start, timezone);
    const current = localParts(now, timezone);
    const occurrence = (year) => fromLocal({
      ...first, year, day: Math.min(first.day, daysInMonth(year, first.month))
    }, timezone, true);
    const thisYear = occurrence(current.year);
    const today = current.year > first.year && current.month === first.month &&
      current.day === Math.min(first.day, daysInMonth(current.year, first.month));
    let year = current.year;
    if (thisYear < now || year === first.year) year += 1;
    const next = occurrence(year);
    const previous = occurrence(year - 1);
    return {
      date: next, today,
      progress: Math.max(0, Math.min(100, (now - previous) / (next - previous) * 100))
    };
  }

  function countdown(target, now) {
    const rest = Math.max(0, target - now);
    return {
      days: Math.floor(rest / DAY), hours: Math.floor((rest % DAY) / HOUR),
      minutes: Math.floor((rest % HOUR) / MINUTE), seconds: Math.floor((rest % MINUTE) / SECOND)
    };
  }

  function heartbeatCount(start, now, hearts = 1, averageHeartRate = 72) {
    if (!Number.isFinite(averageHeartRate) || averageHeartRate <= 0 || !Number.isInteger(hearts) || hearts < 1) {
      throw new Error("Heartbeat assumptions must be positive numbers, with a whole number of hearts.");
    }
    return Math.floor(Math.max(0, now - start) / MINUTE * averageHeartRate * hearts);
  }


  function venueMapsUrl(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a Maps link of at most 2048 characters.");
    const trimmed = value.trim();
    if (!trimmed) return null;
    let url;
    try { url = new URL(trimmed); }
    catch { throw new Error("Enter a valid HTTPS Google Maps or Apple Maps link."); }
    const allowed = url.hostname === "maps.app.goo.gl" || url.hostname === "maps.apple.com"
      || url.hostname === "maps.google.com"
      || (["google.com", "www.google.com", "goo.gl"].includes(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname));
    if (url.protocol !== "https:" || !allowed || url.username || url.password || url.port) {
      throw new Error("Enter a valid HTTPS Google Maps or Apple Maps link.");
    }
    return url.href;
  }

  return { parseDate, startTimestamp, duration, anniversary, countdown, heartbeatCount, venueMapsUrl };
});
