/* ============================================================
   Cloud store — v1.9 DH
   ALL state lives in Supabase (table `contract_state`).
   NOTHING is persisted to localStorage / sessionStorage / IndexedDB.
   In-memory cache only for the current session.
   Keys stored in the cloud:
     fields        → every input/textarea/select value (incl. login pw field)
     accepts       → per-area signature acceptances {area:{party:{ts}}}
     days          → AI-created day pages [{id, html}]
   ============================================================ */
(() => {
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  let sb = null;
  let cloudReady = false;
  let warned = false;

  try {
    if (window.supabase && window.supabase.createClient && cfg.url && cfg.anonKey
        && !cfg.url.includes('YOUR-PROJECT-REF')) {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
  } catch (e) { console.warn('[cloud] init failed:', e); }

  const warn = () => {
    if (warned) return;
    warned = true;
    try {
      const t = document.getElementById('cloud-status');
      if (t) { t.textContent = '☁️ Cloud offline — set js/supabase-config.js'; t.title = 'Supabase not configured; entries exist in this session only.'; }
    } catch {}
  };

  /* ---------- in-memory mirror (never written to disk) ---------- */
  /* v3.3 DH — `wiped` is a persisted flag: once the user clears ALL days, every
     device must start with an empty contract (no old day pages re-appearing). */
  const mem = { fields: {}, accepts: {}, days: [], wiped: false };

  const upsert = async (k, v) => {
    if (!sb) return false;
    const { error } = await sb.from('contract_state').upsert({ k, v });
    if (error) { console.warn('[cloud] upsert failed', k, error); warn(); return false; }
    return true;
  };

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
          const t = document.getElementById('cloud-status');
          if (t) { t.textContent = '☁️ Connected · synced'; t.title = 'Live Supabase store (table contract_state).'; }
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

      /* force a fresh pull (login / tab focus) and re-sync the UI via callback */
      async refresh() {
        if (!sb) { warn(); return null; }
        try {
          applyRows(await fetchState());
          cloudReady = true;
          const t = document.getElementById('cloud-status');
          if (t) { t.textContent = '☁️ Connected · synced'; t.title = 'Live Supabase store (table contract_state).'; }
          return { fields: mem.fields, accepts: mem.accepts, days: mem.days };
        } catch (e) {
          console.warn('[cloud] refresh failed:', e);
          warn();
          return null;
        }
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
  };

  window.CloudStore = cloud;
})();
