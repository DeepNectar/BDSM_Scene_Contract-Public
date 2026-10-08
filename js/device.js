/* ============================================================
   Deep & Honey · Eternal Contract — device / resolution adapter
   Runs BEFORE js/app.js (both are `defer`, so order is kept) and
   before paint, because it is also inlined in <head>.

   What it does
   • detects the device class (phone / tablet / desktop) from UA +
     touch points + viewport width + pixel ratio
   • writes that class on <html> as data-device → CSS switches to a
     compact, high-legibility profile for phones
   • sets --vmin-h/--vmin-w (real viewport size, immune to the
     on-screen keyboard) and --dpr
   • offers an override chip row (Phone · Tablet · Desktop) plus a
     "Fit text" control that changes the base font scale — the
     detected value stays the default
   • remembers the choice per device class in localStorage
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var LS_PROFILE = 'dhContract.profile.v1';
  var LS_FONTSIZE = 'dhContract.fontsize.v1';

  /* ---------- environment probes ---------- */
  function uaInfo() {
    var ua = navigator.userAgent || '';
    var uaData = navigator.userAgentData || null;
    var platform = (uaData && uaData.platform) || navigator.platform || '';
    var iosUA = /iP(hone|ad|od|uch)/.test(ua);
    var iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    var androidUA = /Android/i.test(ua);
    var mobileUA = /Mobile|iP(hone|od)|BlackBerry|IEMobile|Opera Mini|Opera Mobi|webOS|CrMo|Windows Phone|iPhone|Pod/i.test(ua);
    return {
      ua: ua, uaData: uaData, platform: String(platform),
      iosUA: iosUA, iPadOS: iPadOS, androidUA: androidUA, mobileUA: mobileUA,
      tabletUA: /iPad|Tablet|PlayBook|Silk|Acer Iconia|Nexus 7|SM-T|GT-P|L-05D/i.test(ua)
    };
  }

  function coarse(kind) {
    try {
      if (!window.matchMedia) return false;
      return window.matchMedia('(pointer: ' + kind + ')').matches ||
             window.matchMedia('(any-pointer: ' + kind + ')').matches;
    } catch (e) { return false; }
  }

  function mm(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  }

  function vw() { return Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0); }
  function dpr() { return Math.max(1, Math.min(4, window.devicePixelRatio || 1)); }

  /* ---------- classification ---------- */
  function detect() {
    var env = uaInfo();
    var w = vw();
    var touchPts = navigator.maxTouchPoints || 0;
    var touchy = touchPts > 0 || coarse('coarse');
    var fine = coarse('fine');
    var standalone = mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || !!navigator.standalone;

    /* native app shells sometimes strip/alter the UA → trust the hints we were given */
    var injected = null;
    try {
      var p = new URLSearchParams(location.search);
      var v = (p.get('device') || '').toLowerCase();
      if (v === 'phone' || v === 'tablet' || v === 'desktop') injected = v;
      if (!injected && /;wv|WebView|FBAN|FBAV|Instagram|GSA|Electron|CoinBase/i.test(env.ua)) injected = 'phone';
    } catch (e) { /* ignore */ }

    var osName = 'other';
    if (env.iosUA || env.iPadOS || /iPhone|iPad|iPod/i.test(env.platform)) osName = 'iOS';
    else if (env.androidUA || /Android/i.test(env.platform)) osName = 'Android';
    else if (/Win/i.test(env.platform) || /Windows/i.test(env.ua)) osName = 'Windows';
    else if (/Mac/i.test(env.platform) || /Macintosh/i.test(env.ua)) osName = 'macOS';
    else if (/Linux/i.test(env.platform) || /Linux/i.test(env.ua)) osName = 'Linux';

    var phoneOS = (env.iosUA && !env.iPadOS) || (env.androidUA && env.mobileUA);
    var tabletOS = env.tabletUA || env.iPadOS || (env.androidUA && !env.mobileUA);
    var desktopOS = !phoneOS && !tabletOS;

    var cls, why;
    if (injected) { cls = injected; why = 'forced by URL/device hint'; }
    else if (phoneOS) { cls = 'phone'; why = 'mobile OS signature'; }
    else if (w <= 600 && touchy) { cls = 'phone'; why = 'viewport ≤ 600px + touch'; }
    else if (w <= 720 && touchy && !fine) { cls = 'phone'; why = 'narrow touch viewport'; }
    else if (tabletOS) { cls = 'tablet'; why = 'tablet signature'; }
    else if (w <= 1024 && touchy) { cls = 'tablet'; why = 'mid-size touch viewport'; }
    else if (w <= 900 && !touchy) { cls = 'tablet'; why = 'small non-touch window'; }
    else { cls = 'desktop'; why = 'wide viewport'; }

    /* a phone-classed device with a very wide viewport is probably just a small
       desktop window — keep the phone look only when touch/mobile agrees */
    if (cls === 'phone' && !touchy && !phoneOS && w > 820) { cls = 'desktop'; why = 'wide window, no touch'; }

    return {
      cls: cls, reason: why, os: osName, standalone: standalone,
      width: w, height: window.innerHeight || 0, dpr: dpr(),
      touchPts: touchPts, touchy: touchy, fine: fine,
      mobileUA: env.mobileUA, screenW: (screen && screen.width) || 0,
      screenH: (screen && screen.height) || 0
    };
  }

  /* ---------- stored preferences ---------- */
  function readLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var detected = detect();
  var manual = null;                       // explicit override (device class)
  var savedProfile = readLS(LS_PROFILE);
  if (savedProfile) {
    try {
      var sp = JSON.parse(savedProfile);
      if (sp && sp.clsFor === detected.cls && ['phone', 'tablet', 'desktop'].indexOf(sp.cls) >= 0) manual = sp.cls;
    } catch (e) { /* ignore */ }
  }
  var fontSize = parseFloat(readLS(LS_FONTSIZE)) || 100;   // percent of the profile default

  var current = function () { return manual || detected.cls; };

  /* ---------- apply ---------- */
  function setVars() {
    var h = window.visualViewport ? window.visualViewport.height : (window.innerHeight || 0);
    h = Math.max(h, 1);
    root.style.setProperty('--vmin-h', h + 'px');
    root.style.setProperty('--vmin-w', vw() + 'px');
    root.style.setProperty('--dpr', String(dpr()));
    root.style.setProperty('--font-scale', (fontSize / 100).toFixed(3));
  }

  function apply(reasonLabel) {
    var cls = current();
    root.dataset.device = cls;
    root.dataset.detected = detected.cls;
    root.dataset.os = detected.os;
    root.classList.toggle('is-phone', cls === 'phone');
    root.classList.toggle('is-tablet', cls === 'tablet');
    root.classList.toggle('is-desktop', cls === 'desktop');
    root.classList.toggle('is-standalone', detected.standalone);
    setVars();
    refreshUI(cls, reasonLabel);
    try {
      var m = window.matchMedia('(max-width: 600px)');
      if (m.addEventListener) m.addEventListener('change', onBreakpoint);
      else if (m.addListener) m.addListener(onBreakpoint);
    } catch (e) { /* ignore */ }
  }
  function onBreakpoint() {
    var fresh = detect();
    var changed = fresh.cls !== detected.cls;
    detected = fresh;
    if (changed && !manual) apply('auto');
    else { setVars(); refreshUI(current(), 'resize'); }
  }

  /* ---------- UI wiring (safe whether DOM is ready or not) ---------- */
  function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function qa(sel) { try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }

  function refreshUI(cls, reasonLabel) {
    var chips = qa('#device-chips .dev-chip');
    chips.forEach(function (b) {
      var on = b.dataset.set === cls;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var info = q('#device-info');
    if (info) {
      var parts = [
        'Detected: ' + detected.cls + ' (' + detected.os + ', ' + detected.width + '×' + detected.height + '@' + detected.dpr + 'x)',
        'Reason: ' + detected.reason,
        'Using: ' + cls + (manual ? ' (your choice)' : ''),
        detected.standalone ? 'Running as installed app ♥' : 'Running in browser tab',
        reasonLabel ? 'Update: ' + reasonLabel : ''
      ].filter(Boolean);
      info.textContent = parts.join(' · ');
    }
    var fit = q('#fit-range');
    if (fit && document.activeElement !== fit) fit.value = String(fontSize);
    var fitOut = q('#fit-out');
    if (fitOut) fitOut.textContent = fontSize + '%';
    var reset = q('#fit-reset');
    if (reset) reset.hidden = (fontSize === 100 && !manual);
  }

  function wire() {
    qa('#device-chips .dev-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.dataset.set;
        manual = (v === detected.cls) ? null : v;              // tapping the detected class clears the override
        writeLS(LS_PROFILE, JSON.stringify({ cls: current(), clsFor: detected.cls }));
        apply('manual');
        if (typeof window.scheduleAutoGrowAll === 'function') window.scheduleAutoGrowAll();
      });
    });
    var fit = q('#fit-range');
    if (fit) {
      fit.addEventListener('input', function () {
        fontSize = parseInt(fit.value, 10) || 100;
        writeLS(LS_FONTSIZE, String(fontSize));
        setVars();
        refreshUI(current(), 'text size');
        if (typeof window.scheduleAutoGrowAll === 'function') window.scheduleAutoGrowAll();
      });
    }
    var reset = q('#fit-reset');
    if (reset) reset.addEventListener('click', function () {
      manual = null; fontSize = 100;
      writeLS(LS_PROFILE, ''); writeLS(LS_FONTSIZE, '100');
      apply('reset');
      if (typeof window.scheduleAutoGrowAll === 'function') window.scheduleAutoGrowAll();
    });
    var dbg = q('#device-debug-btn');
    if (dbg) dbg.addEventListener('click', function () {
      detected = detect();
      var lines = [
        'device class .......... ' + current() + (manual ? ' (override; detected ' + detected.cls + ')' : ''),
        'platform .............. ' + (detected.os || '?'),
        'userAgentData mobile .. ' + (detected.uaData ? String(!!detected.uaData.mobile) : 'unsupported'),
        'userAgentData platform  ' + (detected.uaData ? (detected.uaData.platform || '-') : '-'),
        'viewport .............. ' + detected.width + ' × ' + detected.height + ' px',
        'screen ................ ' + detected.screenW + ' × ' + detected.screenH + ' px',
        'devicePixelRatio ...... ' + detected.dpr,
        'maxTouchPoints ........ ' + detected.touchPts,
        'pointer coarse/fine ... ' + (detected.touchy ? 'coarse' : '-') + ' / ' + (detected.fine ? 'fine' : '-'),
        'display mode .......... ' + (detected.standalone ? 'standalone (installed app)' : 'browser'),
        'reason ................ ' + detected.reason
      ];
      var body = q('#debug-body');
      if (body) body.textContent = lines.join('\n') + '\n\nUA: ' + detected.ua;
      var modal = q('#debug-modal');
      if (modal) modal.classList.add('active');
    });
    var closeDbg = q('#debug-close-btn');
    if (closeDbg) closeDbg.addEventListener('click', function () {
      var modal = q('#debug-modal'); if (modal) modal.classList.remove('active');
    });
    var dm = q('#debug-modal');
    if (dm) dm.addEventListener('click', function (e) { if (e.target === dm) dm.classList.remove('active'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { var m = q('#debug-modal'); if (m) m.classList.remove('active'); }
    });
  }

  /* ---------- listeners ---------- */
  var rafPending = false;
  function onViewChange() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      onBreakpoint();
    });
  }
  window.addEventListener('resize', onViewChange);
  window.addEventListener('orientationchange', function () { setTimeout(onViewChange, 180); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewChange);
    window.visualViewport.addEventListener('scroll', function () { setVars(); });
  }

  /* first paint must already know the profile */
  apply('boot');

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  /* public helpers used by js/pdf.js and js/app.js */
  window.DHDevice = {
    detect: detect,
    current: current,
    get detected() { return detected; },
    get manual() { return manual; },
    recheck: function () { detected = detect(); apply('recheck'); return detected; }
  };
  /* tiny global shorthands (kept namespaced-ish on purpose) */
  window.isIOS = function () { return detected.os === 'iOS'; };
  window.isAndroid = function () { return detected.os === 'Android'; };
  window.isTouch = function () { return detected.touchy; };
  window.isPhone = function () { return current() === 'phone'; };
  window.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 4000);
    }, 300);
    /* iOS Safari ignores <a download> outside its own gesture flow → open the blob instead */
    if (window.isIOS()) {
      try { window.open(url, '_blank'); } catch (e) { /* popup blocked: the download above still stands */ }
    }
  };
})();
