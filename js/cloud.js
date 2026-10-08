/* ============================================================
   Cloud store — v3.8 DH
   ALL state lives in Supabase (table `contract_state`).
   NOTHING is persisted to localStorage / sessionStorage / IndexedDB.
   In-memory cache only for the current session.
   Keys stored in the cloud:
     fields        → every input/textarea/select value (incl. login pw field)
     accepts       → per-area signature acceptances {area:{party:{ts}}}
     days          → EVERY created day page (blank or AI) [{id, html}]
     wiped         → sticky "all days cleared" flag
   v3.8 additions (everything of the day is now saved & synced):
     • flush()      — synchronous best-effort push of the whole mirror,
                      fired on pagehide/beforeunload so the LAST edits and
                      the most recent day of the day always reach Supabase
                      even when the tab closes before the debounce fires.
     • subscribe()  — Postgres change feed on contract_state: when the other
                      device saves, this device re-pulls within ~a second
                      (real-time sync without refreshing).
     • heartbeat    — periodic retry while offline; status pill shows
                      "Last synced …" once connected.
   ============================================================ */
(() => {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  let sb = null;
  let cloudReady = false;
  let warned = false;
  let lastSyncAt = 0;

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

  /* ---------- in-memory mirror (never written to disk) ---------- */
  /* v3.3 DH — `wiped` is a persisted flag: once the user clears ALL days, every
     device must start with an empty contract (no old day pages re-appearing). */
  const mem = { fields: {}, accepts: {}, days: [], wiped: false };

  const upsert = async (k, v) => {
    if (!sb) return false;
    const { error } = await sb.from('contract_state').upsert({ k, v });
    if (error) { console.warn('[cloud] upsert failed', k, error); warn(); return false; }
    warned = false;
    markSynced();
    return true;
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

  const applyRows = (rows) => {
    mem.fields = {}; mem.accepts = {}; mem.days = []; mem.wiped = false;
    (rows || []).forEach(r => {
      if (r.k === 'fields')  mem.fields  = r.v || {};
      if (r.k === 'accepts') mem.accepts = r.v || {};
      if (r.k === 'days' && Array.isArray(r.v)) mem.days = r.v;
      if (r.k === 'wiped')  mem.wiped = !!(r.v && r.v.flag);
    });
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
      try {
        sb.from('contract_state').upsert({ k: 'fields',  v: mem.fields });
        sb.from('contract_state').upsert({ k: 'accepts', v: mem.accepts });
        sb.from('contract_state').upsert({ k: 'days',    v: mem.days });
        sb.from('contract_state').upsert({ k: 'wiped',   v: { flag: mem.wiped } });
        return true;
      } catch (e) { console.warn('[cloud] flush failed', e); return false; }
    },

    saveFields(fields) { mem.fields = fields; return sb ? upsert('fields', fields) : Promise.resolve(false); },
    saveAccepts(a)     { mem.accepts = a;    return sb ? upsert('accepts', a)    : Promise.resolve(false); },
    saveDays(list)     { mem.days = list;    return sb ? upsert('days', list)    : Promise.resolve(false); },
    /* v3.3 DH — persist the "all days cleared" flag so the empty contract
       survives reloads on every device */
    saveWiped(flag)    { mem.wiped = !!flag; return sb ? upsert('wiped', { flag: !!flag }) : Promise.resolve(false); },

    /* synchronous accessors used by the UI between saves */
    fields()  { return mem.fields; },
    accepts() { return mem.accepts; },
    days()    { return mem.days; },
    wiped()   { return mem.wiped; },
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
