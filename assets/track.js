/* Fine Print Eagle: first-party, cookie-free visit counting.
   Sends tiny beacons (page view, button click, signup attempt) to our own data service.
   No cookies. sessionStorage only remembers where this visit came from. Never blocks the page. */
(function () {
  "use strict";
  var URL_BASE = (window.FPE_TRACK_URL || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(URL_BASE)) return;
  var KEY = "fpe_src";
  var ALIASES = { yt: "youtube", youtube: "youtube", ig: "instagram", instagram: "instagram",
                  fb: "facebook", facebook: "facebook", tt: "tiktok", tiktok: "tiktok" };

  function fromReferrer(ref) {
    if (!ref) return window.FPE_DEFAULT_SOURCE || "direct";
    var host;
    try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return "other"; }
    if (host === location.hostname) return window.FPE_DEFAULT_SOURCE || "direct";
    if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return "youtube";
    if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
    if (/(^|\.)(facebook\.com|fb\.com|messenger\.com)$/.test(host)) return "facebook";
    if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
    if (/(^|\.)google\./.test(host)) return "google";
    return "other";
  }

  function source() {
    var explicit = "";
    try {
      var q = new URLSearchParams(location.search);
      explicit = (q.get("src") || q.get("utm_source") || "").toLowerCase().trim();
    } catch (e) {}
    var s = "";
    if (explicit) {
      s = ALIASES[explicit] || explicit.replace(/[^a-z0-9 _.-]/g, "").slice(0, 40) || "other";
    } else {
      try { s = sessionStorage.getItem(KEY) || ""; } catch (e) {}
      if (!s) s = fromReferrer(document.referrer);
    }
    try { sessionStorage.setItem(KEY, s); } catch (e) {}
    return s;
  }

  var SRC = source();

  function post(path, data) {
    try {
      var body = JSON.stringify(data);
      if (navigator.sendBeacon && navigator.sendBeacon(URL_BASE + path, body)) return;
      fetch(URL_BASE + path, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit" }).catch(function () {});
    } catch (e) {}
  }

  function event(type, target) {
    post("/t", { t: type, p: location.pathname, s: SRC, r: (document.referrer || "").slice(0, 300), g: target || undefined });
  }

  window.fpeTrack = { event: event, source: function () { return SRC; } };

  event("pageview");

  // Buttons and links marked data-track="name" count as clicks (left, middle or keyboard).
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-track]") : null;
    if (el) event("click", el.getAttribute("data-track"));
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);

  // Signup forms marked data-track-signup: log email + source with us, then let the form post to Kit as usual.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.hasAttribute || !form.hasAttribute("data-track-signup")) return;
    var input = form.querySelector('input[type="email"], input[name="email_address"]');
    var email = input && input.value ? input.value.trim() : "";
    if (email) post("/s", { e: email.slice(0, 254), s: SRC, p: location.pathname, r: (document.referrer || "").slice(0, 300) });
  }, true);
})();
