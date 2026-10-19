"use strict";

const WedsCalendar = (() => {
  const calendar = typeof module !== "undefined" && module.exports
    ? require("./shared/calendar.js") : globalThis.GiftCalendar;
  const { startTimestamp } = calendar;

  function validateGift(gift) {
    if (!gift || typeof gift !== "object") throw new Error("Gift personalization is missing.");
    for (const field of ["partnerOneName", "partnerTwoName", "timezone", "videoUrl", "startFrameUrl", "endFrameUrl"]) {
      if (typeof gift[field] !== "string" || !gift[field].trim()) throw new Error(`Missing ${field}.`);
    }
    if (!["valentine", "wedding", "anniversary"].includes(gift.occasion)) {
      throw new Error("This romantic template supports Valentine's Day, weddings and anniversaries.");
    }
    if (gift.customMessage != null && typeof gift.customMessage !== "string") throw new Error("The closing message must be text.");
    const start = startTimestamp(gift.relationshipStartDate, gift.relationshipStartTime, gift.timezone);
    calendar.venueMapsUrl(gift.venueMapsUrl);
    return start;
  }

  return { ...calendar, validateGift };
})();

if (typeof module !== "undefined" && module.exports) module.exports = WedsCalendar;

if (typeof document !== "undefined") {
  const element = (id) => document.getElementById(id);
  const video = element("romantic-video");
  const frame = element("end-frame");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = [];
  let interval;
  let stallTimeout;
  let revealed = false;
  let failed = false;
  let disposed = false;
  let gift;
  let start;

  function listen(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }

  function fitNames() {
    if (disposed) return;
    for (const id of ["opening-partner-one", "opening-partner-two", "names"]) {
      const name = element(id);
      name.style.removeProperty("font-size");
      if (!name.clientWidth || name.scrollWidth <= name.clientWidth) continue;
      let low = 1;
      let high = parseFloat(getComputedStyle(name).fontSize);
      for (let step = 0; step < 12; step++) {
        const size = (low + high) / 2;
        name.style.fontSize = `${size}px`;
        if (name.scrollWidth <= name.clientWidth) low = size;
        else high = size;
      }
      name.style.fontSize = `${low}px`;
    }
  }

  function showError(error) {
    console.error("Love keepsake:", error);
    element("error").textContent = `This keepsake could not open: ${error.message}`;
    element("error").hidden = false;
    element("keepsake").hidden = true;
    element("gift").classList.remove("is-opening");
    clearInterval(interval);
    clearTimeout(stallTimeout);
    video.pause();
    failed = true;
  }

  function showFallback(message, canPlay) {
    if (revealed || failed || disposed) return;
    console.warn("Love keepsake playback:", message);
    element("playback-message").textContent = message;
    element("play").hidden = !canPlay;
    element("playback-fallback").hidden = false;
  }

  function reveal(useStill = false) {
    if (revealed || failed || disposed) return;
    revealed = true;
    clearTimeout(stallTimeout);
    video.pause();
    if (useStill) frame.hidden = false;
    const surface = element("video-surface");
    const before = surface.getBoundingClientRect();
    const focusWasInFallback = element("playback-fallback").contains(document.activeElement);
    element("gift").classList.remove("is-opening");
    fitNames();
    element("keepsake").inert = false;
    element("keepsake").removeAttribute("aria-hidden");
    element("opening-copy").setAttribute("aria-hidden", "true");
    element("playback-fallback").hidden = true;
    const after = surface.getBoundingClientRect();
    if (!motion.matches) {
      surface.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width})` },
        { transform: "translate(0, 0) scale(1)" }
      ], { duration: 850, easing: "cubic-bezier(.22,.61,.36,1)" });
    }
    if (focusWasInFallback) {
      element("names").tabIndex = -1;
      element("names").focus({ preventScroll: true });
    }
  }

  async function play() {
    if (revealed || failed || disposed) return;
    element("playback-fallback").hidden = true;
    try {
      await video.play();
    } catch (error) {
      if (revealed || disposed) return;
      clearTimeout(stallTimeout);
      if (error.name === "NotAllowedError") {
        showFallback("Tap to play your little moment, or open the keepsake.", true);
      } else {
        console.error("Video playback failed:", error);
        showFallback("The animation couldn't play. Your personalized keepsake is still available.", false);
      }
    }
  }

  function tick() {
    const now = new Date();
    const remaining = WedsCalendar.countdown(start, now);
    for (const [unit, value] of Object.entries(remaining)) {
      element(unit).textContent = ["hours", "minutes", "seconds"].includes(unit) ? String(value).padStart(2, "0") : String(value);
    }
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: gift.timezone, year: "numeric", month: "2-digit", day: "2-digit"
    });
    const today = date.format(now) === date.format(start);
    element("wedding-status").textContent = start > now ? "Counting down to our wedding"
      : today ? "Today is our wedding day!" : "Our wedding day";
  }

  function safeTick() {
    try { tick(); } catch (error) { showError(error); }
  }

  function dispose() {
    disposed = true;
    clearInterval(interval);
    clearTimeout(stallTimeout);
    video.pause();
    for (const remove of listeners) remove();
  }

  try {
    gift = window.WEDS_GIFT;
    start = WedsCalendar.validateGift(gift);
    const names = `${gift.partnerOneName.trim()} & ${gift.partnerTwoName.trim()}`;
    element("opening-partner-one").textContent = gift.partnerOneName.trim();
    element("opening-partner-two").textContent = gift.partnerTwoName.trim();
    element("names").append(document.createTextNode(gift.partnerOneName.trim()));
    const ampersand = document.createElement("span");
    ampersand.textContent = " & ";
    element("names").append(ampersand, document.createTextNode(gift.partnerTwoName.trim()));
    fitNames();
    listen(window, "resize", fitNames);
    listen(document.fonts, "loadingdone", fitNames);
    document.fonts.ready.then(fitNames);
    element("quote").textContent = gift.customMessage?.trim()
      || "With hearts full of love, we invite you to witness our vows and bless the beginning of our forever.";
    element("wedding-date").textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: gift.timezone, day: "numeric", month: "long", year: "numeric"
    }).format(start);
    element("wedding-date").dateTime = gift.relationshipStartDate;
    const mapsUrl = WedsCalendar.venueMapsUrl(gift.venueMapsUrl);
    if (mapsUrl) {
      element("venue-link").href = mapsUrl;
      element("venue-link").hidden = false;
    } else {
      element("venue-heading").textContent = "Celebrate our forever";
      element("venue-blessings").hidden = false;
    }
    element("venue").hidden = false;
    document.title = `${names} | Wedding invitation`;
    video.muted = true;
    video.poster = gift.startFrameUrl;
    video.src = gift.videoUrl;
    frame.src = gift.endFrameUrl;
    listen(frame, "error", () => {
      console.error("The final-frame image could not load:", gift.endFrameUrl);
      frame.hidden = true;
      element("error").textContent = "The final illustration couldn't load. The keepsake details remain available.";
      element("error").hidden = false;
    });
    listen(video, "ended", () => reveal(true));
    listen(video, "error", () => {
      clearTimeout(stallTimeout);
      showFallback("The animation couldn't load. You can still open your keepsake.", false);
    });
    listen(video, "waiting", () => {
      clearTimeout(stallTimeout);
      stallTimeout = setTimeout(() => showFallback("The animation is taking a little longer to load.", true), 10000);
    });
    listen(video, "playing", () => {
      clearTimeout(stallTimeout);
      element("playback-fallback").hidden = true;
    });
    listen(element("play"), "click", play);
    listen(element("continue"), "click", () => reveal(true));
    listen(motion, "change", () => { if (motion.matches) reveal(true); });
    listen(document, "visibilitychange", () => { if (!document.hidden && !failed) safeTick(); });
    listen(window, "pagehide", (event) => { if (!event.persisted) dispose(); });
    listen(window, "pageshow", () => { if (!disposed && !failed) safeTick(); });
    tick();
    interval = setInterval(safeTick, 1000);
    if (motion.matches) {
      reveal(true);
    } else {
      stallTimeout = setTimeout(() => showFallback("The animation is taking a little longer to load.", true), 10000);
      play();
    }
  } catch (error) { showError(error); }
}
