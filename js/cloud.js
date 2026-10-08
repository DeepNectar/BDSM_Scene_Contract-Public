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

  const cloud = {
    get ready() { return cloudReady; },

    /* pull everything from Supabase; returns the state object */
    async load() {
      if (!sb) { warn(); return null; }
      try {
        const { data, error } = await sb.from('contract_state').select('k,v');
        if (error) throw error;
        (data || []).forEach(r => {
          if (r.k === 'fields')  Object.assign(mem.fields, r.v || {});
          if (r.k === 'accepts') Object.assign(mem.accepts, r.v || {});
          if (r.k === 'days' && Array.isArray(r.v)) mem.days = r.v;
          if (r.k === 'wiped')  mem.wiped = !!(r.v && r.v.flag);
        });
        cloudReady = true;
        return { fields: mem.fields, accepts: mem.accepts, days: mem.days };
      } catch (e) {
        console.warn('[cloud] load failed:', e);
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
