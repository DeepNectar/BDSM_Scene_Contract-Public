/* ============================================================
   Cloud store — v3.9 DH
   ALL state lives in Supabase (table `contract_state`).
   Keys stored in the cloud:
     fields        → EVERY input/textarea/select value across the whole
                     contract — Pre-Scene Execution Affidavit included
     accepts       → per-area signature acceptances {area:{party:{ts}}}
     days          → EVERY created day page (blank or AI) [{id, html}]
     wiped         → sticky "all days cleared" flag
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

  /* ---------- in-memory mirror (never written to disk) ---------- */
  /* v3.3 DH — `wiped` is a persisted flag: once the user clears ALL days, every
     device must start with an empty contract (no old day pages re-appearing). */
  const mem = { fields: {}, accepts: {}, days: [], wiped: false };

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
        upsert('fields',  mem.fields);
        upsert('accepts', mem.accepts);
        upsert('days',    mem.days);
        upsert('wiped',   { flag: mem.wiped });
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

    saveFields(fields) { mem.fields = fields;  return upsert('fields',  fields); },
    saveAccepts(a)     { mem.accepts = a;      return upsert('accepts', a); },
    saveDays(list)     { mem.days = list;      return upsert('days',    list); },
    /* v3.3 DH — persist the "all days cleared" flag so the empty contract
       survives reloads on every device */
    saveWiped(flag)    { mem.wiped = !!flag;   return upsert('wiped',   { flag: !!flag }); },

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
