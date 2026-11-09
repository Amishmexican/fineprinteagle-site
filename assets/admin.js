/* Fine Print Eagle — admin dashboard. Talks to the Cloudflare Worker at window.FPE_TRACK_URL. */
(function () {
  "use strict";
  var API = (window.FPE_TRACK_URL || "").replace(/\/+$/, "");
  var TOKEN_KEY = "fpe_admin_token";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = { range: "7d", tz: "America/Chicago", summary: null, signups: null, youtube: null, token: null };

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
    loadYouTube();
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
    var every = series.length > 16 ? Math.ceil(series.length / 8) : (series.length > 8 ? 2 : 1);
    series.forEach(function (s, i) {
      if (i % every !== 0 && i !== series.length - 1) return;
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

  /* ---------- YouTube ---------- */
  function loadYouTube() {
    var el = $("#youtube"); el.innerHTML = '<div class="skel"></div><div class="skel" style="width:60%"></div>';
    return api("/api/youtube").then(function (data) { state.youtube = data; renderYouTube(data); }).catch(function (err) {
      if (unauthorized(err)) return;
      el.innerHTML = '<p class="none">Couldn’t load YouTube numbers right now.</p>';
    });
  }
  function renderYouTube(d) {
    var el = $("#youtube"); var vids = d.videos || [];
    var hint = $("#yt-hint");
    if (d.error && !vids.length) {
      hint.textContent = "YouTube’s public feed did not answer (" + d.error + "). Open YouTube Studio for the live numbers.";
      el.innerHTML = '<p class="none">No video numbers right now. <a href="https://studio.youtube.com/channel/' + esc(d.channel_id) + '/analytics" rel="noopener" target="_blank">Open YouTube Studio</a>.</p>';
      return;
    }
    hint.textContent = (d.channel ? d.channel + ": " : "") + n(d.total_views) + " views across " + vids.length + " video" + (vids.length === 1 ? "" : "s") + (d.subscribers != null ? ", " + n(d.subscribers) + " subscribers" : "") + ". From YouTube’s public feed, refreshed hourly" + (d.fetched_at ? " (last " + fmtDateTime(d.fetched_at) + ")" : "") + ".";
    if (!vids.length) { el.innerHTML = '<p class="none">The feed lists no videos yet. YouTube can take a while to add new Shorts.</p>'; return; }
    el.innerHTML = '<ul class="videos">' + vids.map(function (v) {
      return '<li><a class="video" href="' + esc(v.url) + '" rel="noopener" target="_blank">' + (v.thumbnail ? '<img src="' + esc(v.thumbnail) + '" alt="" loading="lazy">' : "<span></span>") +
        '<span class="t">' + esc(v.title) + "<small>" + esc(fmtDate(v.published)) + "</small></span><span class=\"v\">" + n(v.views) + "<small>views</small></span></a></li>";
    }).join("") + "</ul>";
  }

  /* ---------- start ---------- */
  state.token = loadToken();
  if (API && state.token) { showDash(); loadAll(); }
  else if (API) showLogin("");
})();
