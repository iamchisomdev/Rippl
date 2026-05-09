/* Rippl embed v1 — pure vanilla JS, no build step */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var projectId = script.getAttribute("data-project") || "";
  var apiBase = script.getAttribute("data-api") || inferApiBase(script.src);
  var userId = script.getAttribute("data-user-id") || "";
  var userEmail = script.getAttribute("data-user-email") || "";

  // Validate project id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    console.warn("[rippl] invalid data-project");
    return;
  }

  // Validate API URL
  try {
    var u = new URL(apiBase);
    if (u.protocol !== "https:") {
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
        console.warn("[rippl] data-api must be https in production");
        return;
      }
    }
  } catch (e) {
    console.warn("[rippl] invalid data-api URL");
    return;
  }

  function inferApiBase(src) {
    try {
      var url = new URL(src);
      return url.origin;
    } catch (e) {
      return "";
    }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers["x-project-id"] = projectId;
    opts.headers["x-page-url"] = location.href;
    if (opts.body && typeof opts.body !== "string") {
      opts.headers["content-type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    opts.credentials = "omit";
    return fetch(apiBase + path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw j;
        return j;
      });
    });
  }

  function fmtNGN(kobo) {
    var n = (kobo / 100).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return "₦" + n;
  }

  // capture ?ref= and store
  try {
    var params = new URLSearchParams(location.search);
    var ref = params.get("ref");
    if (ref && /^[A-Z0-9]{4,20}$/i.test(ref)) {
      localStorage.setItem("rippl_ref", ref);
    }
  } catch (e) {}

  var state = { referral: null, balance: null };

  function showSkeletons() {
    injectStyles();
    var nodes = document.querySelectorAll("[data-rippl-widget]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var kind = el.getAttribute("data-rippl-widget");
      if (kind === "referral-card") {
        el.innerHTML =
          '<div class="rippl-card">' +
          '<div class="rippl-skeleton" style="height:14px;width:60%;margin-bottom:8px"></div>' +
          '<div class="rippl-skeleton" style="height:10px;width:90%;margin-bottom:14px"></div>' +
          '<div class="rippl-skeleton" style="height:36px;width:100%;margin-bottom:12px"></div>' +
          '<div style="display:flex;gap:8px">' +
          '<div class="rippl-skeleton" style="height:54px;flex:1"></div>' +
          '<div class="rippl-skeleton" style="height:54px;flex:1"></div>' +
          "</div></div>";
      } else if (kind === "rewards") {
        el.innerHTML =
          '<div class="rippl-card">' +
          '<div class="rippl-skeleton" style="height:14px;width:50%;margin-bottom:12px"></div>' +
          '<div class="rippl-skeleton" style="height:28px;width:60%;margin-bottom:8px"></div>' +
          '<div class="rippl-skeleton" style="height:10px;width:40%"></div>' +
          "</div>";
      }
    }
  }

  function init() {
    showSkeletons();

    if (!userId) {
      // anonymous visitor — generate a stable id
      userId = localStorage.getItem("rippl_anon_id") || "";
      if (!userId) {
        userId =
          "anon_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem("rippl_anon_id", userId);
      }
    }

    // pageview tracking — fire-and-forget, never blocks the referral flow
    try {
      api("/api/track/pageview", {
        method: "POST",
        body: {
          visitorId: userId,
          path: location.pathname,
          referrerCode: localStorage.getItem("rippl_ref") || undefined,
          userAgent: navigator.userAgent,
        },
      }).catch(function () {});
    } catch (e) {}

    api("/api/identify", {
      method: "POST",
      body: { userId: userId, email: userEmail || undefined },
    })
      .then(function (res) {
        state.referral = res.referral;
        // attempt convert if a ref code was stored from a previous landing
        var stored = localStorage.getItem("rippl_ref");
        if (stored && stored !== res.referral.code) {
          api("/api/track", {
            method: "POST",
            body: {
              event: "referral.convert",
              userId: userId,
              payload: { code: stored },
            },
          })
            .then(function () {
              localStorage.removeItem("rippl_ref");
            })
            .catch(function () {});
        }
        return api("/api/balance/" + encodeURIComponent(userId));
      })
      .then(function (bal) {
        state.balance = bal;
        renderAll();
      })
      .catch(function () {});
  }

  function renderAll() {
    var nodes = document.querySelectorAll("[data-rippl-widget]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var kind = el.getAttribute("data-rippl-widget");
      if (kind === "referral-card") renderReferralCard(el);
      else if (kind === "rewards") renderRewards(el);
    }
  }

  function renderReferralCard(el) {
    if (!state.referral) return;
    injectStyles();
    el.innerHTML =
      '<div class="rippl-card">' +
      '<div class="rippl-h">Invite friends, earn rewards</div>' +
      '<div class="rippl-sub">Share your link — you both get credit when they sign up.</div>' +
      '<div class="rippl-row">' +
      '<input class="rippl-input" readonly />' +
      '<button class="rippl-btn">Copy</button>' +
      "</div>" +
      '<div class="rippl-stats">' +
      '<div class="rippl-stat">' +
      '<span class="rippl-stat-val" id="rpl-inv">0</span>' +
      '<span class="rippl-stat-key">Referrals</span>' +
      "</div>" +
      '<div class="rippl-stat">' +
      '<span class="rippl-stat-val rippl-accent" id="rpl-conv">0</span>' +
      '<span class="rippl-stat-key">Converted</span>' +
      "</div>" +
      "</div>" +
      "</div>";
    var input = el.querySelector(".rippl-input");
    var btn = el.querySelector(".rippl-btn");
    input.value = state.referral.shareUrl;
    el.querySelector("#rpl-inv").textContent = String(state.referral.stats.invited);
    el.querySelector("#rpl-conv").textContent = String(state.referral.stats.converted);
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(state.referral.shareUrl);
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = "Copy";
      }, 1500);
    });
  }

  function renderRewards(el) {
    if (!state.balance) return;
    injectStyles();
    el.innerHTML =
      '<div class="rippl-card"><div class="rippl-h">Your rewards</div>' +
      '<div class="rippl-amt"></div><div class="rippl-pending"></div></div>';
    var amt = el.querySelector(".rippl-amt");
    var pen = el.querySelector(".rippl-pending");
    amt.textContent = fmtNGN(state.balance.available);
    pen.textContent = fmtNGN(state.balance.pending) + " pending";
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var css =
      "@keyframes rippl-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}" +
      ".rippl-skeleton{background:linear-gradient(90deg,#161B24 25%,#1E2535 50%,#161B24 75%);background-size:200% 100%;animation:rippl-shimmer 1.5s ease-in-out infinite;border-radius:6px}" +
      ".rippl-card{background:#0F1117;border:1px solid #1E2535;border-radius:11px;padding:16px;color:#E8EDF5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:380px}" +
      ".rippl-h{font-size:14px;font-weight:700;color:#E8EDF5;margin-bottom:4px;letter-spacing:-0.2px}" +
      ".rippl-sub{font-size:12px;color:#5A6478;margin-bottom:12px;line-height:1.5}" +
      ".rippl-row{display:flex;gap:6px}" +
      ".rippl-input{flex:1;background:#161B24;border:1px solid #1E2535;color:#E8EDF5;padding:8px 10px;border-radius:7px;font-size:12px;font-family:'SF Mono',ui-monospace,monospace}" +
      ".rippl-btn{background:#00C27C;color:#08090C;border:none;padding:8px 12px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer}" +
      ".rippl-meta{margin-top:10px;font-size:11px;color:#5A6478}" +
      ".rippl-stats{display:flex;gap:8px;margin-top:12px}" +
      ".rippl-stat{flex:1;background:#161B24;border:1px solid #1E2535;border-radius:9px;padding:10px 12px;text-align:center}" +
      ".rippl-stat-val{display:block;font-size:18px;font-weight:800;color:#E8EDF5;letter-spacing:-0.5px}" +
      ".rippl-stat-key{display:block;font-size:10px;font-weight:600;color:#5A6478;text-transform:uppercase;letter-spacing:.5px;margin-top:3px}" +
      ".rippl-accent{color:#00C27C !important}" +
      ".rippl-amt{font-size:24px;font-weight:800;color:#00C27C;font-family:'SF Mono',ui-monospace,monospace}" +
      ".rippl-pending{font-size:11px;color:#5A6478;margin-top:4px}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
