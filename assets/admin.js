/* Fine Print Eagle — admin dashboard. Talks to the Cloudflare Worker at window.FPE_TRACK_URL. */
(function () {
  "use strict";
  var API = (window.FPE_TRACK_URL || "").replace(/\/+$/, "");
  var TOKEN_KEY = "fpe_admin_token";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = { range: "7d", tz: "America/Chicago", summary: null, signups: null, platforms: null, token: null };

  /* ---------- labels in plain English ---------- */
  var SOURCE_LABELS = {
    youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", google: "Google search",
    direct: "Direct (typed the address or a saved link)", other: "Other websites", "checklist link": "Checklist link (videos, emails)",
    "kit page": "Kit signup page", ig: "Instagram", yt: "YouTube", fb: "Facebook", tt: "TikTok",
  };
  var CLICK_LABELS = {
    follow_youtube: "Follow on YouTube", follow_instagram: "Follow on Instagram", follow_facebook: "Follow on Facebook",
    follow_tiktok: "Follow on TikTok", subscribe_youtube: "Subscribe on YouTube", watch_short: "Watch the video",
    checklist_cta: "Checklist button (after the 7 traps)", nav_checklist: "Free checklist (top menu)",
    footer_checklist: "Checklist link (footer)", footer_youtube: "YouTube (footer)", footer_instagram: "Instagram (footer)",
    footer_facebook: "Facebook (footer)", footer_tiktok: "TikTok (footer)", back_home: "Back home (404 page)",
    signup_submit: "Sent the signup form",
  };
  var DEVICE_LABELS = { phone: "Phones", tablet: "Tablets", desktop: "Computers" };
  var PAGE_LABELS = { "/": "Home page", "/privacy": "Privacy policy", "/privacy/": "Privacy policy", "/checklist": "Checklist redirect", "/checklist/": "Checklist redirect" };

  function sourceLabel(s) { s = (s || "direct").toString(); return SOURCE_LABELS[s.toLowerCase()] || cap(s); }
  function clickLabel(t) { return CLICK_LABELS[t] || cap(String(t || "").replace(/_/g, " ")); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function n(v) { return Number(v || 0).toLocaleString("en-US"); }
  function pct(r) { return r == null ? "–" : (Math.round(r * 1000) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%"; }
  function countryName(code) {
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
  }
  function fmtDate(iso, opts) {
    if (!iso) return "–";
    try { return new Date(iso).toLocaleString("en-US", Object.assign({ timeZone: state.tz, month: "short", day: "numeric", year: "numeric" }, opts || {})); } catch (e) { return iso; }
  }
  function fmtDateTime(iso) { return fmtDate(iso, { hour: "numeric", minute: "2-digit" }); }

  /* ---------- token ---------- */
  function loadToken() {
    try {
      var raw = localStorage.getItem(TOKEN_KEY); if (!raw) return null;
      var t = JSON.parse(raw);
      if (!t.token || (t.expires_at && new Date(t.expires_at) < new Date())) { localStorage.removeItem(TOKEN_KEY); return null; }
      return t.token;
    } catch (e) { return null; }
  }
  function saveToken(token, expires) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, expires_at: expires })); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} state.token = null; }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { "content-type": "application/json" };
    if (state.token) headers.authorization = "Bearer " + state.token;
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, mode: "cors", credentials: "omit" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) { var err = new Error(data.error || ("Request failed (" + res.status + ")")); err.status = res.status; err.data = data; throw err; }
          return data;
        });
      });
  }

  /* ---------- views ---------- */
  var loginEl = $("#login"), dashEl = $("#dash"), logoutBtn = $("#logout");
  var loginForm = $("#login-form"), loginMsg = $("#login-msg"), pwd = $("#password");

  function showLogin(message, ok) {
    dashEl.hidden = true; loginEl.hidden = false; logoutBtn.hidden = true;
    loginMsg.textContent = message || ""; loginMsg.classList.toggle("ok", !!ok);
    pwd.value = ""; setTimeout(function () { pwd.focus(); }, 0);
  }
  function showDash() { loginEl.hidden = true; dashEl.hidden = false; logoutBtn.hidden = false; }

  function notice(html, kind, retry) {
    var el = $("#notice");
    if (!html) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false; el.className = "notice" + (kind ? " " + kind : "");
    el.innerHTML = "<span>" + html + "</span>" + (retry ? '<button class="btn btn-ghost small" type="button" id="retry">Try again</button>' : "");
    if (retry) $("#retry").addEventListener("click", function () { loadAll(); });
  }

  if (!API) {
    showLogin("Not connected yet. The data service address is missing from assets/config.js, so there is nothing to show.");
    $("#login-btn").disabled = true;
  }

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!API) return;
    var card = loginForm; card.classList.add("is-busy"); loginMsg.textContent = ""; loginMsg.classList.remove("ok");
    api("/api/login", { method: "POST", body: { password: pwd.value } })
      .then(function (data) {
        state.token = data.token; saveToken(data.token, data.expires_at);
        showDash(); loadAll();
      })
      .catch(function (err) {
        var msg = "Something went wrong. Check the connection and try again.";
        if (err.status === 401) msg = "That password didn’t match. Try again.";
        else if (err.status === 429) { var m = Math.ceil((err.data && err.data.retry_after || 900) / 60); msg = "Too many tries. Wait about " + m + " minute" + (m === 1 ? "" : "s") + " and try again."; }
        else if (err.status === 503) msg = "The data service is not set up yet (no admin password configured).";
        else if (!err.status) msg = "Couldn’t reach the data service. Check the connection and try again.";
        loginMsg.textContent = msg; pwd.select();
      })
      .then(function () { card.classList.remove("is-busy"); });
  });

  logoutBtn.addEventListener("click", function () { clearToken(); showLogin("You are logged out.", true); });

  $$(".range button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".range button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      state.range = b.getAttribute("data-range"); loadSummary();
    });
  });

  function unauthorized(err) {
    if (err && err.status === 401) { clearToken(); showLogin("Your session ended. Log in again."); return true; }
    return false;
  }

  function loadAll() {
    notice("");
    loadSummary();
    loadSignups();
    loadPlatforms();
  }

  /* ---------- summary ---------- */
  function setLoading(on) {
    var area = $("#summary-area"); area.setAttribute("aria-busy", String(on)); area.classList.toggle("loading", on);
    if (on) {
      $$(".tile-num").forEach(function (el) { el.textContent = ""; });
      ["#trend", "#sources", "#clicks", "#devices", "#countries", "#pages"].forEach(function (s) { $(s).innerHTML = '<div class="skel"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:85%"></div>'; });
    }
  }

  function loadSummary() {
    setLoading(true);
    return api("/api/summary?range=" + encodeURIComponent(state.range)).then(function (data) {
      state.summary = data; state.tz = data.timezone || state.tz;
      renderSummary(data); setLoading(false);
    }).catch(function (err) {
      setLoading(false);
      if (unauthorized(err)) return;
      $$(".tile-num").forEach(function (el) { el.textContent = "–"; });
      ["#trend", "#sources", "#clicks", "#devices", "#countries", "#pages"].forEach(function (s) { $(s).innerHTML = ""; });
      notice("Couldn’t load the numbers. " + esc(err.status ? err.message : "The data service did not answer."), "error", true);
    });
  }

  var RANGE_WORDS = { today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days", all: "since the start" };

  function renderSummary(d) {
    var t = d.totals || {};
    $('[data-k="visitors"]').textContent = n(t.visitors);
    $('[data-k="pageviews"]').textContent = n(t.pageviews);
    $('[data-k="signups"]').textContent = n(t.signups);
    $('[data-k="rate"]').textContent = pct(t.rate);
    $("#updated").textContent = "Counted " + RANGE_WORDS[d.range] + ". Updated " + fmtDateTime(d.generated_at) + " (" + (d.timezone === "America/Chicago" ? "Central time" : d.timezone) + ").";

    var empty = !t.pageviews && !t.signups;
    $("#empty").hidden = !empty; $("#tiles").hidden = empty; $("#charts").hidden = empty;
    var emptyP = $("#empty p");
    emptyP.innerHTML = d.range === "all"
      ? "Nothing has been counted yet. Share a short link, such as <strong>fineprinteagle.com/ig</strong>, and the numbers appear here within a minute."
      : "No visits " + RANGE_WORDS[d.range] + ". Try a longer range, or share a short link such as <strong>fineprinteagle.com/ig</strong>.";
    if (empty) return;

    renderTrend(d.trend, d);
    renderRows("#sources", d.by_source, function (r) {
      return { name: sourceLabel(r.source), sub: r.signups ? n(r.signups) + " signup" + (r.signups === 1 ? "" : "s") + (r.rate != null ? " · " + pct(r.rate) : "") : "no signups yet", value: r.visitors, unit: "visitor" };
    }, "No visits counted in this range.");
    renderRows("#clicks", d.clicks, function (r) { return { name: clickLabel(r.target), value: r.clicks, unit: "click" }; }, "No button taps in this range.");
    renderRows("#devices", d.devices, function (r) { return { name: DEVICE_LABELS[r.device] || cap(r.device), value: r.visitors, unit: "visitor" }; }, "Nothing yet.");
    renderRows("#countries", d.countries, function (r) { return { name: countryName(r.country), value: r.visitors, unit: "visitor" }; }, "Countries show up once the service runs on Cloudflare.");
    renderRows("#pages", d.pages, function (r) { return { name: PAGE_LABELS[r.path] || r.path, value: r.pageviews, unit: "view" }; }, "Nothing yet.");
  }

  function renderRows(sel, rows, map, emptyText) {
    var el = $(sel); rows = rows || [];
    if (!rows.length) { el.innerHTML = '<p class="none">' + esc(emptyText) + "</p>"; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return map(r).value || 0; })) || 1;
    el.innerHTML = '<ol class="rows">' + rows.map(function (r) {
      var m = map(r); var w = Math.max(2, Math.round((m.value / max) * 100));
      return '<li class="row" style="--w:' + w + '%"><span class="name">' + esc(m.name) + (m.sub ? "<small>" + esc(m.sub) + "</small>" : "") +
        '</span><span class="num">' + n(m.value) + "<small>" + esc(m.unit + (m.value === 1 ? "" : "s")) + "</small></span></li>";
    }).join("") + "</ol>";
  }

  /* Bar chart: one series (visitors), gold, baseline, recessive grid, hover tooltip. */
  function renderTrend(trend, d) {
    var el = $("#trend"); var pts = (trend && trend.points) || []; var unit = trend && trend.unit;
    var series = [];
    if (unit === "hour") {
      var byHour = {}; pts.forEach(function (p) { byHour[p.bucket] = p; });
      for (var h = 0; h < 24; h++) series.push({ key: h, label: hourLabel(h), full: hourLabel(h) + " today", visitors: (byHour[h] || {}).visitors || 0, pageviews: (byHour[h] || {}).pageviews || 0 });
      $("#trend-hint").textContent = "Visitors per hour today.";
    } else {
      var byDay = {}; pts.forEach(function (p) { byDay[p.bucket] = p; });
      var days = [];
      if (d.since) { for (var day = d.since; day <= d.today; day = nextDay(day)) days.push(day); }
      else days = pts.map(function (p) { return p.bucket; });
      if (days.length > 60) days = days.slice(-60);
      days.forEach(function (day) {
        var p = byDay[day] || {}; var dt = new Date(day + "T12:00:00Z");
        series.push({ key: day, label: dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }), full: dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }), visitors: p.visitors || 0, pageviews: p.pageviews || 0 });
      });
      $("#trend-hint").textContent = "Visitors per day" + (d.range === "all" && days.length > 1 ? ", last " + days.length + " days with visits." : ".");
    }
    el.setAttribute("aria-label", "Visitors per " + (unit === "hour" ? "hour" : "day") + ": " + series.filter(function (s) { return s.visitors; }).map(function (s) { return s.full + " " + s.visitors; }).join(", "));

    var W = Math.max(280, Math.round(el.clientWidth || 720)), H = 220, padL = 34, padR = 8, padT = 18, padB = 28;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var max = Math.max(1, Math.max.apply(null, series.map(function (s) { return s.visitors; })));
    var step = niceStep(max); var top = Math.ceil(max / step) * step;
    var slot = innerW / Math.max(series.length, 1); var bw = Math.max(3, Math.min(28, slot - 2));
    var html = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">';
    html += '<g class="grid">';
    for (var v = 0; v <= top; v += step) {
      var y = padT + innerH - (v / top) * innerH;
      html += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      html += '<text class="axis" x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="#b3a17b" font-size="12">' + v + "</text>";
    }
    html += "</g>";
    var peakIdx = -1, peak = 0; series.forEach(function (s, i) { if (s.visitors > peak) { peak = s.visitors; peakIdx = i; } });
    series.forEach(function (s, i) {
      var x = padL + i * slot + (slot - bw) / 2; var bh = (s.visitors / top) * innerH; var y = padT + innerH - bh;
      if (s.visitors) html += '<rect class="bar" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="3"/>';
      html += '<rect class="bar-hit" data-i="' + i + '" x="' + (padL + i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + innerH + '"/>';
      if (i === peakIdx && s.visitors) html += '<text class="peak" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + s.visitors + "</text>";
    });
    // X labels: space them by how wide they are, so they never overlap on a phone (e.g. "9 pm" / "11 pm").
    var labelW = Math.max.apply(null, series.map(function (s) { return String(s.label).length; })) * 6.6 + 10;
    var every = Math.max(1, Math.ceil(labelW / slot));
    if (unit === "hour") every = [1, 2, 3, 4, 6, 8, 12].filter(function (k) { return k >= every; })[0] || 12;
    series.forEach(function (s, i) {
      var isLast = i === series.length - 1;
      // Off-step labels are skipped; the last one is kept only when it has a full label's room after the previous one.
      if (i % every !== 0 && !(isLast && (i % every) * slot >= labelW)) return;
      html += '<text class="axis" x="' + (padL + i * slot + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle" fill="#b3a17b" font-size="12">' + esc(s.label) + "</text>";
    });
    html += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) + '" stroke="rgba(217,168,74,.5)"/>';
    html += "</svg>";
    el.innerHTML = html;

    var tip = $("#tooltip"), svg = el.querySelector("svg");
    function show(i, evt) {
      var s = series[i]; if (!s) return;
      $$(".bar", svg).forEach(function (b) { b.classList.toggle("is-hot", b.getAttribute("data-i") == i); });
      tip.hidden = false; tip.innerHTML = "<strong>" + esc(s.full) + "</strong>" + n(s.visitors) + " visitor" + (s.visitors === 1 ? "" : "s") + " · " + n(s.pageviews) + " page view" + (s.pageviews === 1 ? "" : "s");
      var r = evt.target.getBoundingClientRect(); tip.style.left = (r.left + r.width / 2) + "px"; tip.style.top = (padT / H * svg.getBoundingClientRect().height + svg.getBoundingClientRect().top) + "px";
    }
    function hide() { tip.hidden = true; $$(".bar", svg).forEach(function (b) { b.classList.remove("is-hot"); }); }
    svg.addEventListener("mousemove", function (e) { var i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i != null) show(+i, e); else hide(); });
    svg.addEventListener("mouseleave", hide);
    svg.addEventListener("click", function (e) { var i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i != null) show(+i, e); });
  }
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.summary && !$("#charts").hidden) renderTrend(state.summary.trend, state.summary); }, 150);
  });
  function hourLabel(h) { return h === 0 ? "12 am" : h < 12 ? h + " am" : h === 12 ? "12 pm" : (h - 12) + " pm"; }
  function nextDay(day) { var d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  function niceStep(max) { if (max <= 5) return 1; var p = Math.pow(10, Math.floor(Math.log10(max))); var f = max / p; return (f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * p; }

  /* ---------- signups ---------- */
  function loadSignups() {
    var el = $("#signups"); el.innerHTML = '<div class="skel"></div><div class="skel" style="width:80%"></div>';
    return api("/api/signups").then(function (data) { state.signups = data; renderSignups(data); }).catch(function (err) {
      if (unauthorized(err)) return;
      el.innerHTML = '<p class="none">Couldn’t load the signup list. ' + esc(err.status ? err.message : "The data service did not answer.") + "</p>";
    });
  }

  function pill(row) {
    var cls = row.confirmed === true ? "yes" : row.kit_state === "cancelled" || row.kit_state === "bounced" || row.kit_state === "complained" ? "off" : row.confirmed === false ? "no" : "unknown";
    return '<span class="pill ' + cls + '">' + esc(row.confirmed_label || "Unknown") + "</span>";
  }

  function renderSignups(data) {
    var rows = data.signups || []; var note = $("#kit-note"); var kit = data.kit || {};
    if (!kit.configured) { note.hidden = false; note.textContent = "Kit is not connected yet, so “Confirmed” shows Unknown. Add the KIT_API_KEY secret to the data service to see who confirmed, plus anyone who signed up on Kit’s own page."; }
    else if (kit.error) { note.hidden = false; note.textContent = "Kit did not answer just now (" + kit.error + ")" + (kit.stale ? "; showing the last copy from " + fmtDateTime(kit.fetched_at) + "." : "."); }
    else { note.hidden = false; note.textContent = "Kit list: " + n(kit.total_active) + " confirmed of " + n(kit.total) + " total, checked " + fmtDateTime(kit.fetched_at) + "."; }
    $("#signups-hint").textContent = rows.length ? n(rows.length) + " signup" + (rows.length === 1 ? "" : "s") + " so far, newest first. “Confirmed” means they clicked the link in Kit’s email." : "Everyone who asks for the checklist will appear here, newest first.";
    $("#copy-emails").disabled = $("#download-csv").disabled = !rows.length;
    if (!rows.length) { $("#signups").innerHTML = '<p class="none">No signups yet.</p>'; return; }
    $("#signups").innerHTML = '<table class="data"><thead><tr><th>Email</th><th>Signed up</th><th>Came from</th><th>Confirmed</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return "<tr><td class=\"email\">" + esc(r.email) + '</td><td class="date">' + esc(fmtDate(r.first_seen)) + '</td><td class="source">' + esc(sourceLabel(r.source)) + '</td><td class="confirmed">' + pill(r) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  $("#copy-emails").addEventListener("click", function () {
    var rows = (state.signups && state.signups.signups) || []; var text = rows.map(function (r) { return r.email; }).join(", ");
    var btn = this; var done = function () { btn.textContent = "Copied " + rows.length + " email" + (rows.length === 1 ? "" : "s"); setTimeout(function () { btn.textContent = "Copy all emails"; }, 2200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  });
  function fallbackCopy(text) { var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.left = "-9999px"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); }

  $("#download-csv").addEventListener("click", function () {
    var rows = (state.signups && state.signups.signups) || [];
    var q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = ["email,signed_up,came_from,confirmed"].concat(rows.map(function (r) { return [r.email, fmtDate(r.first_seen), sourceLabel(r.source), r.confirmed_label || "Unknown"].map(q).join(","); }));
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fineprinteagle-signups-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  /* ---------- Your channels (daily platform snapshots) ---------- */
  var PLATFORMS = [
    { id: "youtube", name: "YouTube", unit: "subscriber", posts: "Videos", views: "Views", app: "https://studio.youtube.com/channel/UCFMhokGvGqSnQUtdXCFwqlg/analytics",
      profile: "https://www.youtube.com/channel/UCFMhokGvGqSnQUtdXCFwqlg", needs: "Needs a YouTube API key." },
    { id: "instagram", name: "Instagram", unit: "follower", posts: "Posts", views: "Post views", app: "https://www.instagram.com/accounts/insights/",
      profile: "https://www.instagram.com/fineprinteagle/", needs: "Needs an Instagram access token from the Meta app." },
    { id: "facebook", name: "Facebook", unit: "follower", posts: "Reels", views: "Reel views", app: "https://business.facebook.com/latest/insights/overview",
      profile: "https://www.facebook.com/fine.print.eagle", needs: "Needs the Page ID and a Page token from the Meta app." },
    { id: "tiktok", name: "TikTok", unit: "follower", posts: "Videos", views: "Views", app: "https://www.tiktok.com/tiktokstudio/analytics",
      profile: "https://www.tiktok.com/@fineprinteagle", needs: "Public numbers are switched off." },
  ];
  var PLATFORM_BY_ID = {}; PLATFORMS.forEach(function (p) { PLATFORM_BY_ID[p.id] = p; });
  function plural(v, word) { return word + (v === 1 ? "" : "s"); }
  function dayLabel(day) { return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function signed(v) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + n(Math.abs(v)); }
  function minutes(sec) { var m = Math.max(1, Math.ceil(sec / 60)); return m + " minute" + (m === 1 ? "" : "s"); }

  function loadPlatforms() {
    var el = $("#channels"); el.setAttribute("aria-busy", "true");
    el.innerHTML = PLATFORMS.map(function (p) {
      return '<article class="channel loading-card"><div class="channel-head"><h3 class="channel-name">' + esc(p.name) + '</h3></div><div class="skel" style="width:50%;height:30px!important"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:65%"></div></article>';
    }).join("");
    $("#posts").innerHTML = '<div class="skel"></div><div class="skel" style="width:80%"></div>';
    return api("/api/platforms").then(function (data) { state.platforms = data; renderPlatforms(data); }).catch(function (err) {
      if (unauthorized(err)) return;
      el.setAttribute("aria-busy", "false");
      el.innerHTML = PLATFORMS.map(function (p) { return offCard(p, "Couldn’t load", "The data service did not answer. Try again in a minute."); }).join("");
      $("#posts").innerHTML = '<p class="none">No post numbers right now.</p>';
    });
  }

  function appLink(meta) {
    return '<a class="open-app channel-app" href="' + esc(meta.app) + '" rel="noopener" target="_blank" aria-label="Open ' + esc(meta.name) + ' in its app">Open in app</a>';
  }
  function offCard(p, title, sub) {
    return '<article class="channel is-off" data-platform="' + p.id + '" data-state="off"><div class="channel-head"><h3 class="channel-name">' + esc(p.name) + "</h3></div>" +
      '<p class="off-title">' + esc(title) + '</p><p class="off-sub">' + esc(sub) + "</p>" + appLink(p) + "</article>";
  }

  function changeLine(ch, unitWord) {
    if (!ch) return null;
    var cls = ch.value > 0 ? "up" : ch.value < 0 ? "down" : "";
    var when = ch.partial ? "since " + dayLabel(ch.since) : "vs 7 days ago";
    return '<p class="change ' + cls + '"><b>' + signed(ch.value) + "</b> " + esc(unitWord ? unitWord + " " : "") + esc(when) + "</p>";
  }

  function sparkline(p, meta) {
    var pts = (p.series || []).filter(function (s) { return s.followers != null; });
    if (pts.length < 2) return "";
    var W = 200, H = 38, pad = 4;
    var t0 = Date.parse(pts[0].day + "T00:00:00Z"), t1 = Date.parse(pts[pts.length - 1].day + "T00:00:00Z");
    var span = Math.max(1, t1 - t0);
    var vals = pts.map(function (s) { return s.followers; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    var xy = pts.map(function (s) {
      var x = pad + ((Date.parse(s.day + "T00:00:00Z") - t0) / span) * (W - pad * 2);
      var y = pad + (1 - (s.followers - lo) / (hi - lo)) * (H - pad * 2);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    var line = xy.map(function (q) { return q[0] + "," + q[1]; }).join(" ");
    var area = "M" + xy[0][0] + "," + (H - 1) + " L" + line.replace(/ /g, " L") + " L" + xy[xy.length - 1][0] + "," + (H - 1) + " Z";
    var last = xy[xy.length - 1];
    var hits = xy.map(function (q, i) {
      var left = i === 0 ? 0 : (xy[i - 1][0] + q[0]) / 2, right = i === xy.length - 1 ? W : (q[0] + xy[i + 1][0]) / 2;
      return '<rect class="hit" data-i="' + i + '" x="' + left + '" y="0" width="' + Math.max(1, right - left) + '" height="' + H + '"/>';
    }).join("");
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" data-platform="' + p.id + '" role="img" aria-label="' +
      esc(meta.name + " " + meta.unit + "s per day: " + pts.map(function (s) { return dayLabel(s.day) + " " + s.followers; }).join(", ")) + '">' +
      '<path class="area" d="' + area + '"/><polyline class="line" points="' + line + '" vector-effect="non-scaling-stroke"/>' +
      '<circle class="end" cx="' + last[0] + '" cy="' + last[1] + '" r="3.5" vector-effect="non-scaling-stroke"/>' + hits + "</svg>";
  }

  function channelCard(p) {
    var meta = PLATFORM_BY_ID[p.id] || { id: p.id, name: cap(p.id), unit: "follower", posts: "Posts", views: "Views", app: "#", needs: "" };
    if (p.state === "not_connected") return offCard(meta, "Not connected yet", meta.needs);
    if (p.state === "pending") return offCard(meta, "Not connected yet", "Set up. Numbers arrive with the next check; tap Refresh now to check sooner.");
    if (p.state === "error" || !p.latest) {
      if (p.id === "tiktok") return offCard(meta, "Not connected yet", "TikTok isn’t sharing its public numbers with our server right now. Official access comes later.");
      return offCard(meta, "Not connected yet", "The last check didn’t work" + (p.last_error ? ": " + p.last_error : "."));
    }
    var L = p.latest, c7 = p.change_7d || {};
    var html = '<article class="channel" data-platform="' + p.id + '" data-state="ok"><div class="channel-head"><h3 class="channel-name">' + esc(meta.name) +
      "</h3></div>";
    html += '<p class="channel-num" data-k="followers">' + (L.followers == null ? "–" : n(L.followers)) + '</p><p class="channel-unit">' + esc(plural(L.followers, meta.unit)) + "</p>";
    html += changeLine(c7.followers) || '<p class="change">History starts ' + esc(dayLabel((p.series[0] || L).day)) + "</p>";
    html += sparkline(p, meta);
    var useLikes = L.total_views == null && L.total_likes != null;
    var bigLabel = useLikes ? "Likes" : meta.views, bigVal = useLikes ? L.total_likes : L.total_views;
    var bigCh = useLikes ? c7.total_likes : c7.total_views;
    html += '<dl class="channel-stats"><div><dt>' + esc(bigLabel) + '</dt><dd data-k="views">' + (bigVal == null ? "–" : n(bigVal)) +
      (bigCh ? "<small>" + esc(signed(bigCh.value)) + (bigCh.partial ? " since " + esc(dayLabel(bigCh.since)) : " in 7 days") + "</small>" : "") + "</dd></div>" +
      "<div><dt>" + esc(meta.posts) + '</dt><dd data-k="posts">' + (L.post_count == null ? "–" : n(L.post_count)) + "</dd></div></dl>";
    var notes = [];
    if (p.method === "public_profile") notes.push('<span class="pill unknown">Public numbers</span>may break if TikTok changes its page.');
    if (p.last_error) notes.push("Last check didn’t work (" + esc(p.last_error) + "); showing " + esc(dayLabel(L.day)) + ".");
    else if (L.day !== state.platforms.today) notes.push("Last updated " + esc(dayLabel(L.day)) + ".");
    if (p.token && p.token.expires_at) {
      var daysLeft = Math.floor((Date.parse(p.token.expires_at) - Date.now()) / 86400000);
      if (daysLeft < 10) notes.push("Access runs out " + esc(fmtDate(p.token.expires_at)) + ". Make a new token (see DEPLOY.md).");
    }
    if (notes.length) html += '<p class="channel-note">' + notes.join(" ") + "</p>";
    return html + appLink(meta) + "</article>";
  }

  function renderPlatforms(d) {
    var el = $("#channels"); el.setAttribute("aria-busy", "false");
    var list = d.platforms || [];
    el.innerHTML = list.map(channelCard).join("");
    bindSparks(el, list);

    var anyOn = list.some(function (p) { return p.state === "ok"; });
    var hint = "Followers and views on each app, checked every morning around 5 am Central.";
    if (d.last_run && d.last_run.at) hint += " Last check " + fmtDateTime(d.last_run.at) + ".";
    if (!anyOn) hint = "None of the apps are connected yet. Each card says what it needs; the steps are in the worker’s DEPLOY.md.";
    $("#channels-hint").textContent = hint;
    setRefreshButton(d.refresh_available_in || 0);

    var posts = d.top_posts || [];
    var hintEl = $("#posts-hint");
    if (!posts.length) {
      hintEl.textContent = "Most-viewed posts across the connected apps.";
      $("#posts").innerHTML = '<p class="none">' + (anyOn ? "No posts with numbers yet." : "Post numbers appear here once an app is connected.") + "</p>";
      return;
    }
    hintEl.textContent = "Most-viewed posts across the connected apps, from the latest check. “–” means the app doesn’t share that number.";
    var cell = function (v, unit) { return '<td class="num" data-unit="' + esc(v === 1 ? unit.replace(/s$/, "") : unit) + '">' + (v == null ? "–" : n(v)) + "</td>"; };
    $("#posts").innerHTML = '<table class="data posts"><thead><tr><th>Post</th><th>App</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th><th>Posted</th></tr></thead><tbody>' +
      posts.map(function (r) {
        var meta = PLATFORM_BY_ID[r.platform] || { name: cap(r.platform) };
        var title = r.title || "(no caption)";
        var link = r.url ? '<a class="post-link" href="' + esc(r.url) + '" rel="noopener" target="_blank">' + esc(title) + "</a>" : esc(title);
        return '<tr data-platform="' + esc(r.platform) + '"><td class="post">' + link + '<small class="post-meta">' + esc(meta.name) + (r.published_at ? " · " + esc(fmtDate(r.published_at, { year: undefined })) : "") + "</small></td>" +
          '<td class="platform">' + esc(meta.name) + "</td>" + cell(r.views, "views") + cell(r.likes, "likes") + cell(r.comments, "comments") +
          '<td class="date">' + esc(r.published_at ? fmtDate(r.published_at) : "–") + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function bindSparks(root, list) {
    var tip = $("#tooltip");
    $$(".spark", root).forEach(function (svg) {
      var p = list.filter(function (x) { return x.id === svg.getAttribute("data-platform"); })[0];
      var meta = PLATFORM_BY_ID[p.id];
      var pts = (p.series || []).filter(function (s) { return s.followers != null; });
      function show(e) {
        var i = e.target.getAttribute && e.target.getAttribute("data-i"); if (i == null) return hide();
        var s = pts[+i]; if (!s) return;
        tip.hidden = false; tip.innerHTML = "<strong>" + esc(dayLabel(s.day)) + "</strong>" + n(s.followers) + " " + esc(plural(s.followers, meta.unit));
        var r = svg.getBoundingClientRect(); var hit = e.target.getBoundingClientRect();
        tip.style.left = (hit.left + hit.width / 2) + "px"; tip.style.top = r.top + "px";
      }
      function hide() { tip.hidden = true; }
      svg.addEventListener("mousemove", show); svg.addEventListener("click", show); svg.addEventListener("mouseleave", hide);
    });
  }

  var refreshTimer = null;
  function setRefreshButton(waitSec) {
    var btn = $("#refresh-platforms"); clearTimeout(refreshTimer);
    btn.disabled = false; btn.textContent = "Refresh now";
    btn.title = waitSec > 0 ? "Checked recently. Available again in " + minutes(waitSec) + "." : "Check every app now";
  }
  $("#refresh-platforms").addEventListener("click", function () {
    var btn = this; btn.disabled = true; btn.textContent = "Checking…";
    api("/api/platforms/refresh", { method: "POST" }).then(function (data) {
      state.platforms = data; renderPlatforms(data);
      btn.textContent = "Checked just now"; refreshTimer = setTimeout(function () { setRefreshButton(600); }, 2500);
    }).catch(function (err) {
      if (unauthorized(err)) return;
      btn.disabled = false; btn.textContent = "Refresh now";
      if (err.status === 429) $("#channels-hint").textContent = "Checked a few minutes ago. You can refresh again in " + minutes((err.data && err.data.retry_after) || 600) + ".";
      else $("#channels-hint").textContent = "Couldn’t refresh just now. " + (err.status ? err.message : "The data service did not answer.");
    });
  });

  /* ---------- start ---------- */
  state.token = loadToken();
  if (API && state.token) { showDash(); loadAll(); }
  else if (API) showLogin("");
})();
