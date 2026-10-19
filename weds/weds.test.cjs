const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseDate, startTimestamp, duration, anniversary, countdown, heartbeatCount, validateGift } = require("./weds.js");

test("calendar duration uses real months and updates seconds", () => {
  assert.deepEqual(duration(parseDate("2021-02-14"), new Date("2026-10-12T11:07:35Z")), {
    years: 5, months: 7, days: 28, hours: 11, minutes: 7, seconds: 35
  });
});

test("month ends and leap years are clamped rather than overflowing", () => {
  assert.deepEqual(duration(parseDate("2024-01-31"), parseDate("2024-02-29")), {
    years: 0, months: 1, days: 0, hours: 0, minutes: 0, seconds: 0
  });

  assert.equal(duration(parseDate("2024-02-29"), parseDate("2025-02-28")).years, 1);
});

test("countdowns retain the starting clock time across month boundaries", () => {
  assert.deepEqual(duration(new Date("2026-10-12T11:07:35Z"), parseDate("2027-02-14")), {
    years: 0, months: 4, days: 1, hours: 12, minutes: 52, seconds: 25
  });
  assert.deepEqual(duration(new Date("2026-10-12T23:59:59Z"), parseDate("2026-10-13")), {
    years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 1
  });
});

test("anniversary countdown rolls forward after the anniversary start time", () => {
  const result = anniversary(parseDate("2021-02-14"), new Date("2026-02-14T23:59:59Z"));
  assert.equal(result.today, true);
  assert.equal(result.date.toISOString(), "2027-02-14T00:00:00.000Z");
  const exact = anniversary(parseDate("2021-02-14"), parseDate("2026-02-14"));
  assert.equal(exact.date.toISOString(), "2026-02-14T00:00:00.000Z");
  assert.equal(countdown(exact.date, exact.date).seconds, 0);
});

test("next anniversary rolls over and progress uses the real interval", () => {
  const result = anniversary(parseDate("2021-02-14"), parseDate("2026-10-12"));
  assert.equal(result.date.toISOString(), "2027-02-14T00:00:00.000Z");
  assert.ok(result.progress > 65 && result.progress < 67);
  assert.equal(anniversary(parseDate("2021-02-14"), parseDate("2026-02-15")).today, false);
});

test("February 29 anniversaries fall on February 28 in non-leap years", () => {
  assert.equal(anniversary(parseDate("2024-02-29"), parseDate("2025-02-28")).today, true);
  assert.equal(anniversary(parseDate("2024-02-29"), parseDate("2027-03-01")).date.toISOString(), "2028-02-29T00:00:00.000Z");
});

test("future weddings count toward the wedding and never yield negative heartbeats", () => {
  const start = parseDate("2026-12-14");
  const now = parseDate("2026-10-12");
  assert.deepEqual(anniversary(start, now), { date: start, today: false, progress: 0 });
  assert.equal(heartbeatCount(start, now, 2), 0);
  assert.throws(() => duration(start, now), /must not precede/);
});

test("heartbeat estimate distinguishes one heart from two", () => {
  const start = parseDate("2026-01-01");
  const now = new Date("2026-01-01T00:01:00Z");
  assert.equal(heartbeatCount(start, now, 1), 72);
  assert.equal(heartbeatCount(start, now, 2), 144);
  assert.equal(heartbeatCount(start, now, 2, 70), 140);
  assert.throws(() => heartbeatCount(start, now, 1, -1));
});

test("date-only gifts start at midnight in their configured timezone", () => {
  assert.equal(startTimestamp("2021-02-14", null, "Asia/Kolkata").toISOString(), "2021-02-13T18:30:00.000Z");
  assert.equal(startTimestamp("2021-02-14", "15:45:12", "Asia/Kolkata").toISOString(), "2021-02-14T10:15:12.000Z");
  assert.throws(() => startTimestamp("2021-02-14", "25:00", "UTC"));
  assert.throws(() => startTimestamp("2021-02-14", null, "Invalid/Timezone"));
});

test("calendar durations account for daylight-saving days", () => {
  const start = startTimestamp("2026-03-08", null, "America/New_York");
  const end = startTimestamp("2026-03-09", null, "America/New_York");
  assert.equal(end - start, 23 * 60 * 60 * 1000);
  assert.deepEqual(duration(start, end, "America/New_York"), {
    years: 0, months: 0, days: 1, hours: 0, minutes: 0, seconds: 0
  });
  assert.deepEqual(countdown(end, start), { days: 0, hours: 23, minutes: 0, seconds: 0 });
});

test("nonexistent start times are rejected and ambiguous times use the earlier instant", () => {
  assert.throws(() => startTimestamp("2026-03-08", "02:30", "America/New_York"), /does not exist/);
  assert.equal(startTimestamp("2026-11-01", "01:30", "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
});

test("anniversaries preserve local time across DST and year boundaries", () => {
  const start = startTimestamp("2025-03-08", "02:30", "America/New_York");
  assert.equal(anniversary(start, parseDate("2026-03-01"), "America/New_York").date.toISOString(), "2026-03-08T07:30:00.000Z");
  const december = startTimestamp("2020-12-31", "23:00", "Asia/Kolkata");
  assert.equal(anniversary(december, parseDate("2026-01-01"), "Asia/Kolkata").date.toISOString(), "2026-12-31T17:30:00.000Z");
});

test("a newly started relationship counts to its first anniversary", () => {
  const start = startTimestamp("2026-10-12", null, "Asia/Kolkata");
  assert.equal(anniversary(start, start, "Asia/Kolkata").date.toISOString(), "2027-10-11T18:30:00.000Z");
});

test("countdown displays actual total days and clock remainder", () => {
  assert.deepEqual(countdown(parseDate("2026-10-14"), new Date("2026-10-12T11:07:35Z")), {
    days: 1, hours: 12, minutes: 52, seconds: 25
  });
  assert.deepEqual(countdown(parseDate("2026-10-12"), parseDate("2026-10-14")), {
    days: 0, hours: 0, minutes: 0, seconds: 0
  });
});

test("missing and invalid personalization produce explicit errors", () => {
  const gift = {
    partnerOneName: "Aarav", partnerTwoName: "Geetha", timezone: "Asia/Kolkata",
    relationshipStartDate: "2021-02-14", occasion: "anniversary",
    videoUrl: "./assets/weds.mp4", startFrameUrl: "./assets/start-frame.svg", endFrameUrl: "./assets/end-frame.png",
    averageHeartRate: 72, estimatedHearts: 1
  };
  assert.equal(validateGift(gift).toISOString(), "2021-02-13T18:30:00.000Z");
  assert.throws(() => validateGift(null), /missing/);
  assert.throws(() => validateGift({ ...gift, partnerOneName: "" }), /partnerOneName/);
  assert.throws(() => validateGift({ ...gift, customMessage: 12 }), /must be text/);
  assert.throws(() => validateGift({ ...gift, relationshipStartDate: "2025-02-29" }), /valid calendar/);
});

test("invalid dates are reported explicitly", () => {
  for (const date of ["2025-02-29", "2026-13-01", "2026-04-31", "not-a-date"]) {
    assert.throws(() => parseDate(date));
  }
});
