/* ============================================================
   Cloud store — v4.1 DH
   v4.1 fixes ("AI days don't come back after re-login / save button"):
     • window.dhPersistDays() is now called BEFORE every pull (refresh /
       login replay / realtime) so the freshest DOM — including days made
       by "✨ AI Assistant — write our day" — is always in the mirror and
       reaches Supabase even if an autosave tick was missed.
     • NEW: mem.days is persisted to localStorage on EVERY change, and the
       💾 Save button also writes a 'dhContract.cloud.v41' snapshot of the
       complete cloud mirror. applyRows() merges that snapshot too, so a
       saved/AI day can NEVER disappear on reload/re-login — no auto-wipe
       path exists anywhere in the code anymore.
     • flush() now adopts the newest DOM state before pushing, so closing
       the tab right after creating an AI day still saves it.
   Cloud store — v4.0 DH
   ALL state lives in Supabase (table `contract_state`).
   Keys stored in the cloud:
     fields        → EVERY input/textarea/select value across the whole
                     contract — Pre-Scene Execution Affidavit included
     accepts       → per-area signature acceptances {area:{party:{ts}}}
     days          → EVERY day page — including the static founding Day 1
                     shipped in index.html — so a re-login on ANY device
                     rebuilds the COMPLETE contract from the cloud
     wiped         → LEGACY key, no longer honoured (v4.0 stopped the
                     auto-wipe of days). Kept readable for old rows only.
   v4.0 fixes ("saved days don't come back after re-login / auto wipe"):
     • applyRows() now falls back to localStorage (DAYS_KEY / STORE_KEY)
       when the cloud list is empty or unreachable, and MERGES local days
       into the cloud list instead of replacing it — a saved day can never
       vanish on reload/login again.
     • mem.wiped starts true (never blocks restoreDays before the first
       pull completes) and the persisted 'wiped' flag is ignored entirely.
   v3.9 fixes ("💾 Save button does nothing / data not reaching cloud"):
     • saveFields/saveAccepts/saveDays/saveWiped are now SYNCHRONOUS and
       return a Promise<boolean>. Previously they returned the raw PostgREST
       promise, which REJECTS on any network hiccup — app.js only attached
       `.then(ok => …)` with no `.catch`, so an unhandled rejection killed
       the save silently and the button looked dead. Now: never rejects,
       retries once, reports success/failure honestly.
     • pending-writes counter + awaitFlush(): the 💾 Save button awaits the
       REAL completion of every queued cloud write (fields + signatures +
       all day pages) before showing "Saved ✓", instead of firing off a
       debounced autosave and hoping it lands.
     • flush() pushes the whole mirror through the same tracked path.
   v3.8 features kept: realtime change feed, focus refresh, heartbeat retry,
   "Connected · synced Xs ago" status pill.
   ============================================================ */
(() => {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  let sb = null;
  let cloudReady = false;
  let warned = false;
  let lastSyncAt = 0;

  /* v3.9 — track in-flight writes so callers can await them */
  let pendingWrites = 0;
  const inflight = new Set();

  try {
    if (window.supabase && window.supabase.createClient && cfg.url && cfg.anonKey
        && !cfg.url.includes('YOUR-PROJECT-REF')) {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
  } catch (e) { console.warn('[cloud] init failed:', e); }

  const setStatus = (text, title) => {
    try {
      const t = document.getElementById('cloud-status');
      if (t) { t.textContent = text; if (title) t.title = title; }
    } catch {}
  };

  const fmtAgo = ms => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  };

  const markSynced = () => {
    lastSyncAt = Date.now();
    setStatus(`☁️ Connected · synced ${fmtAgo(lastSyncAt)}`,
              'Live Supabase store (table contract_state). Every day you create and every entry you type is saved here automatically.');
  };

  const warn = () => {
    warned = true;   // re-warn allowed after a failure; cheap to reset on success
    setStatus('☁️ Cloud offline — check Supabase project status & keys',
              'Supabase unreachable (wrong URL/key, paused free project, or no network); entries exist in this session only.');
  };

  /* ---------- in-memory mirror + localStorage safety net ---------- */
  /* v4.0 DH — the "auto wipe" bug: `wiped` used to be a STICKY cloud flag that
     made every reload/login start with an EMPTY contract. That behaviour is
     removed: the flag is never honoured again, and days are merged from the
     cloud + local copy so nothing can silently disappear. `mem.wiped` starts
     TRUE purely as a guard so restoreDays() is never blocked before the first
     pull completes (and forever after, since nothing sets it false now). */
  const mem = { fields: {}, accepts: {}, days: [], wiped: true };

  /* same keys app.js uses for its offline snapshot */
  const LS_DAYS_KEY  = 'dhContract.days.v1';
  const LS_STORE_KEY = 'dhContract.fields.v1';
  /* v4.1 DH — our OWN durable mirror copy (written on every change, so even
     if app.js's snapshot logic is bypassed, the days survive reload/login) */
  const LS_MIRROR_KEY = 'dhContract.cloud.v41';

  const writeMirrorLocal = () => {
    try {
      localStorage.setItem(LS_MIRROR_KEY, JSON.stringify({
        fields: mem.fields, accepts: mem.accepts, days: mem.days, ts: Date.now()
      }));
    } catch { /* storage full — cloud copy still authoritative */ }
  };
  const readMirrorLocal = () => {
    try {
      const m = JSON.parse(localStorage.getItem(LS_MIRROR_KEY));
      return (m && typeof m === 'object') ? m : null;
    } catch { return null; }
  };

  const readLocalDays = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_DAYS_KEY));
      return (raw && Array.isArray(raw.list)) ? raw.list : null;
    } catch { return null; }
  };
  const readLocalFields = () => {
    try { return JSON.parse(localStorage.getItem(LS_STORE_KEY)) || {}; } catch { return {}; }
  };
  /* merge two [{id,html}] lists — cloud wins on id conflicts, extras kept */
  const mergeDays = (cloudList, localList) => {
    const map = new Map();
    (Array.isArray(localList) ? localList : []).forEach(d => { if (d && d.id && d.html) map.set(d.id, d); });
    (Array.isArray(cloudList) ? cloudList : []).forEach(d => { if (d && d.id && d.html) map.set(d.id, d); });
    return Array.from(map.values())
      .sort((a, b) => ((parseInt((/^day(\d+)/.exec(a.id) || [])[1], 10) || 0) -
                       (parseInt((/^day(\d+)/.exec(b.id) || [])[1], 10) || 0)));
  };

  /* v3.9 — ONE bullet-proof write path:
     • never rejects (network exceptions are caught → resolved false)
     • retries once automatically
     • tracked via pendingWrites/inflight so 💾 Save can await real completion */
  const runWrite = async (label, fn) => {
    pendingWrites++;
    const p = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { error } = await fn();
          if (!error) { warned = false; markSynced(); return true; }
          console.warn(`[cloud] ${label} failed (attempt ${attempt + 1}):`, error);
        } catch (e) {
          console.warn(`[cloud] ${label} threw (attempt ${attempt + 1}):`, e);
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 600));  // brief backoff, then retry
      }
      warn();
      return false;
    })().finally(() => {
      pendingWrites--;
      inflight.delete(p);
    });
    inflight.add(p);
    return p;
  };

  const upsert = (k, v) => {
    if (!sb) return Promise.resolve(false);
    return runWrite('upsert ' + k, () => sb.from('contract_state').upsert({ k, v }));
  };

  /* ---------- v3.8 DH — ALL day pages are saved to the cloud ----------
     `days` rows shipped statically in index.html (STATIC_IDS, e.g. Day 1)
     are not duplicated into Supabase; every day CREATED during a session
     (blank "➕ Add blank day" or "✨ AI write a day") is stored verbatim by
     persistDays() in app.js. The mirror below therefore always contains the
     complete set of created days for the current day/period, and flush()
     guarantees the newest one reaches Supabase even if the tab closes early. */

  /* v3.6 DH — THE BUG THAT BROKE CONNECTION & SYNC:
       nothing in the app ever called CloudStore.load(). The Supabase client was
       created, but the cloud state was never pulled into the in-memory mirror,
       so `ready` stayed false forever ("not connecting") and every device only
       saw its own local copy ("not syncing"). Fixed by:
         • a single shared load promise started immediately at script load
         • `await window.CloudStore.ready` before booting the contract (app.js)
         • an explicit refresh() on login and on focus/visibility change
       load() replaces the mirror with exactly what is in Supabase right now
       (Object.assign used to MERGE stale keys instead of replacing them). */
  let loadPromise = null;

  /* v4.1 DH — adopt the freshest DOM state BEFORE any pull/replay so days that
     were just created (blank or ✨ AI) on this device can never be left out of
     the merged list. Safe to call at any time; silently no-ops before app.js
     has booted (dhPersistDays is registered by app.js). */
  const adoptDomState = () => {
    try { if (typeof window.dhPersistDays === 'function') window.dhPersistDays(); } catch { /* not booted yet */ }
  };

  const applyRows = (rows) => {
    /* v4.0 DH — MERGE, never replace-with-empty: whatever is already in the
       mirror or in this device's localStorage snapshot is preserved, so a day
       that was saved can always come back on reload/re-login. */
    const mirrorSnap  = readMirrorLocal();               // v4.1 — our own durable copy
    const localDays   = mergeDays(readLocalDays(), mirrorSnap && mirrorSnap.days);
    const localFields = Object.assign({}, (mirrorSnap && mirrorSnap.fields) || {}, readLocalFields());
    const cloud = { fields: null, accepts: null, days: null };
    (rows || []).forEach(r => {
      if (r.k === 'fields')  cloud.fields  = r.v || {};
      if (r.k === 'accepts') cloud.accepts = r.v || {};
      if (r.k === 'days' && Array.isArray(r.v)) cloud.days = r.v;
      /* NOTE: 'wiped' rows are intentionally IGNORED from now on — the
         sticky auto-wipe behaviour is removed (v4.0). */
    });
    mem.days   = mergeDays(cloud.days, mergeDays(mem.days, localDays));
    mem.fields = Object.assign({}, localFields, mem.fields || {}, cloud.fields || {});
    if (cloud.accepts) mem.accepts = cloud.accepts;
    else if (mirrorSnap && mirrorSnap.accepts) mem.accepts = mirrorSnap.accepts;
    /* v4.1 — keep the durable local mirror exactly in sync with what we know */
    writeMirrorLocal();
    /* if the cloud had nothing but we have local data, adopt it upward so the
       next save/flush re-seeds Supabase instead of leaving it empty forever */
    if (!cloud.days && mem.days.length) upsert('days', mem.days);
    if (!cloud.fields && Object.keys(mem.fields).length) upsert('fields', mem.fields);
  };

  const fetchState = async () => {
    const { data, error } = await sb.from('contract_state').select('k,v');
    if (error) throw error;
    return data;
  };

  const startLoad = () => {
    if (!sb) return Promise.resolve(null);
    if (loadPromise) return loadPromise;
    loadPromise = fetchState()
      .then(rows => {
        applyRows(rows);
        cloudReady = true;
        warned = false;
        markSynced();
        startRealtime();               // connected → open the change feed
        return { fields: mem.fields, accepts: mem.accepts, days: mem.days };
      })
      .catch(e => {
        console.warn('[cloud] load failed:', e);
        loadPromise = null;              // allow retry on next refresh()/focus
        warn();
        return null;
      });
    return loadPromise;
  };

  /* kick off the pull as soon as this script runs (in parallel with page parse) */
  const bootLoad = startLoad();

  /* ---------- v3.8 DH — real-time: hear about the OTHER device's saves ----------
     Postgres changes on contract_state trigger a debounced re-pull + onChange
     callback (wired in app.js → restoreDays/loadSaved/applySignatures). */
  let channel = null;
  let rtTimer = 0;
  const startRealtime = () => {
    if (!sb || channel || !sb.realtime || typeof sb.channel !== 'function') return;
    try {
      channel = sb.channel('contract_state_changes')
        .on('postgres_changes',
            { schema: 'public', table: 'contract_state' },
            () => {
              clearTimeout(rtTimer);
              rtTimer = setTimeout(() => {
                cloud.refresh().catch(() => {});
              }, 400);
            })
        .subscribe();
    } catch (e) { console.warn('[cloud] realtime unavailable:', e); }
  };

  const cloud = {
    /* v3.6 DH: `ready` is now a PROMISE that resolves once the first cloud
       pull has completed (connected → resolved value; offline → null).
       Old boolean-style uses like `!window.CloudStore.ready` still behave
       sanely because a pending/resolved promise is truthy. */
    get ready() { return bootLoad || Promise.resolve(null); },

    /* pull everything from Supabase; returns the state object */
    async load() {
      if (!sb) { warn(); return null; }
      return startLoad();
    },

    /* force a fresh pull (login / tab focus / realtime push) */
    async refresh() {
      if (!sb) { warn(); return null; }
      adoptDomState();                                   // v4.1 — never pull over an unsaved new day
      try {
        applyRows(await fetchState());
        cloudReady = true;
        warned = false;
        markSynced();
        startRealtime();
        return { fields: mem.fields, accepts: mem.accepts, days: mem.days };
      } catch (e) {
        console.warn('[cloud] refresh failed:', e);
        warn();
        return null;
      }
    },

    /* ---------- v3.8 DH — flush(): push the WHOLE mirror now ----------
       Called on pagehide/beforeunload and periodically while the tab is
       hidden, so everything created during the day (fields, signatures,
       every day page, the wiped flag) is guaranteed to be in Supabase
       before the app closes. Best-effort: each upsert is fired without
       awaiting (the browser keeps in-flight XHR/fetch alive briefly on
       unload), errors just surface via the status pill on next open. */
    flush() {
      if (!sb) return false;
      adoptDomState();                                   // v4.1 — newest DOM (AI days included) first
      try {
        upsert('fields',  mem.fields);
        upsert('accepts', mem.accepts);
        upsert('days',    mem.days);
        upsert('wiped',   { flag: mem.wiped });
        writeMirrorLocal();                              // v4.1 — durable local copy too
        return true;
      } catch (e) { console.warn('[cloud] flush failed', e); return false; }
    },

    /* v3.9 — await EVERY queued/running cloud write (incl. the debounced
       autosave). The 💾 Save button uses this so "Saved ✓" only appears
       after the data has genuinely landed in Supabase. */
    async awaitFlush(timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      let ok = true;
      while (pendingWrites > 0 && Date.now() < deadline) {
        const batch = Array.from(inflight);
        const results = await Promise.all(batch.map(p => p.catch(() => false)));
        ok = results.every(Boolean) && ok;
        if (batch.length === inflight.size && pendingWrites > 0) {
          await new Promise(r => setTimeout(r, 250));   // avoid spin if a new write joined mid-batch
        }
      }
      return { ok: ok && pendingWrites === 0, pending: pendingWrites };
    },

    saveFields(fields) { mem.fields = fields;  writeMirrorLocal(); return upsert('fields',  fields); },
    saveAccepts(a)     { mem.accepts = a;      writeMirrorLocal(); return upsert('accepts', a); },
    /* v4.2 DH — setMirrorDays(list): authoritative DOM snapshot from app.js's
       persistDays(). Replaces the mirror (so deletions stick) AND updates this
       device's durable local copy, then saveDays() pushes it to Supabase.
       v4.2 FIX: this method now ALSO upserts the list to 'days' immediately.
       Older browsers with a stale cached cloud.js threw
       "window.CloudStore.setMirrorDays is not a function" inside persistDays(),
       which killed the AI-apply path before saveDays() ever ran — so AI days
       never reached the cloud. The immediate upsert here guarantees that even
       if a caller's follow-up saveDays() call is missed or throws, the newest
       day list still lands in Supabase. */
    setMirrorDays(list) {
      if (!Array.isArray(list)) return Promise.resolve(false);
      mem.days = mergeDays(list.filter(d => d && d.id && d.html), []);
      writeMirrorLocal();
      return upsert('days', mem.days);
    },
    /* v4.1 DH — saveDays MERGES with the mirror instead of replacing it, so an
       AI day captured by one code path is never dropped by another path that
       ran with a slightly older DOM snapshot. */
    saveDays(list)     { mem.days = mergeDays(list, mem.days); writeMirrorLocal(); return upsert('days', mem.days); },
    /* v4.0 DH — no-op kept for backwards compatibility with app.js v3.x calls.
       The sticky "wiped" flag is dead: nothing may auto-clear days anymore. */
    saveWiped()        { return Promise.resolve(true); },

    /* synchronous accessors used by the UI between saves */
    fields()  { return mem.fields; },
    accepts() { return mem.accepts; },
    days()    { return mem.days; },
    /* v4.0 DH — always true: the sticky auto-wipe is DEAD. Days are never
       blocked from restoring on reload/login; only the explicit red
       "✖ Delete day" / manual wipe buttons can remove a day now. */
    wiped()   { return true; },
    lastSynced() { return lastSyncAt; },
  };

  /* ---------- safety nets: never lose what was created today ---------- */
  window.addEventListener('pagehide', () => cloud.flush());
  window.addEventListener('beforeunload', () => cloud.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cloud.flush();
    else cloud.refresh().catch(() => {});          // coming back → pull the other device's edits
  });
  /* heartbeat: retry the connection every 30 s while offline; keep the
     "synced Xs ago" label honest while online */
  setInterval(() => {
    if (!sb) return;
    if (!cloudReady) { loadPromise = null; startLoad(); }
    else markSyncedLabel();
  }, 30000);
  function markSyncedLabel() {
    if (lastSyncAt) setStatus(`☁️ Connected · synced ${fmtAgo(lastSyncAt)}`);
  }

  window.CloudStore = cloud;
})();
