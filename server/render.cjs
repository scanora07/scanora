"use strict";

const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "weds", "index.html"), "utf8");

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function renderGift(gift, nonce) {
  const config = {
    partnerOneName: gift.names[0], partnerTwoName: gift.names[1],
    relationshipStartDate: gift.occasion_date, relationshipStartTime: null,
    timezone: "Asia/Kolkata", customMessage: null, occasion: "wedding",
    venueMapsUrl: gift.venue_maps_url || null,
    videoUrl: "/weds/assets/weds.mp4", startFrameUrl: "/weds/assets/start-frame.svg",
    endFrameUrl: "/weds/assets/end-frame.png"
  };
  return source
    .replaceAll('src="./', 'src="/weds/')
    .replaceAll('href="./', 'href="/weds/')
    .replace('<script src="/weds/gift.js" defer></script>',
      `<script nonce="${nonce}">window.WEDS_GIFT=${safeJson(config)};</script>`);
}

module.exports = { safeJson, renderGift };
