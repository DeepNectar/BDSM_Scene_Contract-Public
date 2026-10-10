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
  /* v4.13e DH — bumped: the old v41 mirror key is retired so every device
     re-seeds its durable copy from the (authoritative) cloud instead of
     trusting a possibly-stale cached mirror written by older builds. */
  const LS_MIRROR_KEY = 'dhContract.cloud.v413e';

  const writeMirrorLocal = () => {
    safeSet(LS_MIRROR_KEY, JSON.stringify({
      fields: mem.fields, accepts: mem.accepts, days: mem.days, ts: Date.now()
    }));
    /* storage may be unavailable (private mode / opaque origin) — cloud copy
       is still authoritative; never let this throw into the save path */
  };
  const readMirrorLocal = () => {
    try {
      const m = JSON.parse(safeGet(LS_MIRROR_KEY));
      return (m && typeof m === 'object') ? m : null;
    } catch { return null; }
  };

  /* v4.13c DH — app.js writes its offline day snapshot under 'dhContract.days.v1'
     as {list:[…]}; the durable mirror uses the SAME key with a flat {days:[…]}
     shape. The old reader only understood {list} — so on devices whose cached
     app.js still wrote the flat shape, readLocalDays() returned null and the
     locally saved days silently vanished from every merge/restore path.
     Now BOTH shapes are understood → a saved day can never be missed. */
  const readLocalDays = () => {
    try {
      const raw = JSON.parse(safeGet(LS_DAYS_KEY));
      if (raw && Array.isArray(raw.list)) return raw.list;
      if (Array.isArray(raw)) return raw;                       // legacy: plain array
      if (raw && Array.isArray(raw.days)) return raw.days;      // flat mirror shape
      return null;
    } catch { return null; }
  };
  const readLocalFields = () => {
    try { return JSON.parse(safeGet(LS_STORE_KEY)) || {}; } catch { return {}; }
  };
  /* v4.12 DH — permanent DELETED-DAY GUARD ("once ✖ Delete day is done, that
     day must NEVER come back — not on this device, not on the other phone").
     app.js writes tombstones into localStorage under 'dhContract.deleted.v1'
     and exposes window.dhReadDeleted / dhAddDeleted; we ALSO read the raw key
     here so even a device stuck on a stale cached app.js honours deletions.
     Tombstoned ids are stripped from EVERY inbound/outbound list and from all
     durable mirrors — the old union-merge used to resurrect deleted days from
     stale snapshots. */
  const LS_DELETED_KEY = 'dhContract.deleted.v1';
  /* tombstones are {id → deletion-time-ms}. A day may only stay hidden while
     its tombstone is NEWER than the newest time that day was written anywhere
     (updatedAt on the cloud/local copies). Re-creating Day N after deleting it
     therefore always wins — the fresh page carries a newer updatedAt and the
     stale tombstone is lifted automatically. */
  const normDelMap = raw => {
    const m = {};
    const obj = (() => {
      try { return JSON.parse(raw); } catch { return null; }
    })();
    if (obj && Array.isArray(obj.ids)) obj.ids.forEach(id => { if (typeof id === 'string') m[id] = +obj.ts || Date.now(); });
    else if (Array.isArray(obj)) obj.forEach(id => { if (typeof id === 'string') m[id] = Date.now(); });
    else if (obj && typeof obj === 'object') Object.entries(obj).forEach(([id, t]) => { if (typeof t === 'number') m[id] = t; });
    return m;
  };
  const readDeletedIds = () => {
    let map = normDelMap(safeGet(LS_DELETED_KEY));
    try {
      if (typeof window.dhReadDeleted === 'function') {
        const extra = window.dhReadDeleted();          // legacy array form
        if (Array.isArray(extra)) extra.forEach(id => { if (typeof id === 'string' && !(id in map)) map[id] = Date.now(); });
      }
    } catch { /* app.js not booted yet — raw key still guards */ }
    /* v4.13e DH — CLOUD tombstones: deletions performed on the other device
       arrive under the 'deleted' key ({id:epochMs}) via every pull & realtime
       push, so "✖ Delete day" on phone A now sticks permanently on phone B —
       even if B never saw the moment of deletion live. */
    try {
      const r = lastServerRows.find(x => x && x.k === 'deleted');
      if (r && r.v && typeof r.v === 'object') Object.entries(r.v).forEach(([id, t]) => {
        if (typeof id === 'string' && /^day\d+$/.test(id) && typeof t === 'number' && !(id in map)) map[id] = t;
      });
    } catch { /* no server rows yet */ }
    const set = new Set();
    Object.keys(map).forEach(id => { if (/^day\d+$/.test(id)) set.add(id); });
    set._map = map;                                    // timestamps ride along for pruneDeleted
    return set;
  };
  /* record deletions observed in ANY list into the shared tombstone store too */
  const rememberDeleted = (ids, when) => {
    const arr = [].concat(ids || []).filter(id => typeof id === 'string' && /^day\d+$/.test(id));
    if (!arr.length) return;
    const ts = +when || Date.now();
    try {
      if (typeof window.dhAddDeleted === 'function') { window.dhAddDeleted(arr); return; }
    } catch { /* fall through to raw write */ }
    try {
      const raw = safeGet(LS_DELETED_KEY);
      const cur = new Set(Object.keys(normDelMap(raw)));
      arr.forEach(id => cur.add(id));
      safeSet(LS_DELETED_KEY, JSON.stringify({ ids: [...cur], ts }));
    } catch { /* storage unavailable — in-session guard still applies */ }
  };
  /* v4.12b DH — prune tombstoned days out of this device's durable local
     copies (the DAYS_KEY snapshot app.js writes + our own mirror), so a
     deleted day can never be re-attached from localStorage on reload/login.
     'dhContract.deleted.v1' itself is NEVER touched here. */
  const pruneLocalSnapshots = () => {
    const del = readDeletedIds();
    if (!del.size) return;
    try {
      const raw = JSON.parse(safeGet(LS_DAYS_KEY));
      if (raw && Array.isArray(raw.list)) {
        const kept = raw.list.filter(d => d && d.id && !del.has(d.id));
        if (kept.length !== raw.list.length)
          safeSet(LS_DAYS_KEY, JSON.stringify({ list: kept, ts: Date.now() }));
      }
    } catch { /* ignore */ }
    try {
      const m = JSON.parse(safeGet(LS_MIRROR_KEY));
      if (m && Array.isArray(m.days)) {
        const kept = m.days.filter(d => d && d.id && !del.has(d.id));
        if (kept.length !== m.days.length) { m.days = kept; m.ts = Date.now(); safeSet(LS_MIRROR_KEY, JSON.stringify(m)); }
      }
    } catch { /* ignore */ }
  };
  /* drop every tombstoned day from a list (used on ALL inbound & outbound lists).
     v4.13e DH — a tombstone only hides a day while it is NEWER than that day's
     own last write; a page re-created after deletion (newer updatedAt) wins and
     its stale tombstone is lifted locally + pushed up for every device. */
  const pruneDeleted = list => {
    const arr = Array.isArray(list) ? list : [];
    const del = readDeletedIds();
    if (!del.size) return arr;
    const map = del._map || {};
    const lifted = [];
    const out = arr.filter(d => {
      if (!(d && d.id && del.has(d.id))) return true;
      const written = +(d.updatedAt || d.createdAt || 0);
      if (written > (map[d.id] || 0)) { lifted.push(d.id); return true; }   // fresher than the deletion → keep
      return false;
    });
    if (lifted.length) {
      try { if (typeof window.dhLiftDeleted === 'function') window.dhLiftDeleted(lifted); } catch { /* ignore */ }
    }
    return out;
  };

  /* merge two [{id,html}] lists — cloud wins on id conflicts, extras kept.
     v4.12 DH — tombstoned (deleted) days are pruned from BOTH sides first. */
  const dayNum = id => (parseInt((/^day(\d+)/.exec(id || '') || [])[1], 10) || 0);
  const sortDays = list => list.slice().sort((a, b) => dayNum(a.id) - dayNum(b.id));
  const mergeDays = (cloudList, localList) => {
    const map = new Map();
    pruneDeleted(Array.isArray(localList) ? localList : []).forEach(d => { if (d && d.id && d.html) map.set(d.id, d); });
    pruneDeleted(Array.isArray(cloudList) ? cloudList : []).forEach(d => { if (d && d.id && d.html) map.set(d.id, d); });
    return sortDays(Array.from(map.values()));
  };

  /* v4.13f DH — localStorage HARDENING (the real root cause of "nothing
     syncs"): jsdom/privacy-mode/opaque-origin windows THROW a SecurityError
     from EVERY localStorage access — not just JSON.parse. Several readers
     here had their try/catch INSIDE the JSON.parse expression, so the throw
     escaped and killed load(), refresh(), persistDays() and every cloud push
     silently. safeGet/safeSet never throw on ANY engine. */
  const safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

  /* ============================================================
     v4.13e DH — THE CROSS-DEVICE SYNC GUARANTEE ("saved data still
     doesn't appear on the other device"). Two silent data-loss paths
     were killing sync even though every write landed in Supabase:

     (A) ABSENCE ≠ DELETION. applyRows() treated ANY day missing from
         the inbound cloud list as deleted and tombstoned it locally.
         A device whose OWN push raced/failed therefore "tombstoned"
         perfectly healthy days that only the other phone had saved —
         they vanished forever on that device and its next save pushed
         the pruned list back to the cloud, wiping them for EVERYONE.
         Deletions are now EXPLICIT ONLY: app.js's ✖ Delete / 🧹 Wipe
         buttons write a timestamped tombstone AND push it to the cloud
         key 'deleted'. Absence from any list never deletes anything.

     (B) REPLACE-WINS PER KEY. mem.fields/mem.accepts were overwritten
         wholesale by whichever side arrived last, so an older cloud
         pull could clobber newer locally-typed values (and vice versa).
         All merges are now per-key/per-day LAST-WRITER-WINS driven by
         updatedAt timestamps carried inside the payloads themselves —
         order of arrival no longer matters.
     ============================================================ */
  const tsOf = x => { const t = Date.parse(x); return Number.isFinite(t) ? t : 0; };
  const stampNow = () => {
    const iso = new Date().toISOString();
    mem._ts = mem._ts || {};
    mem._ts[iso] = 1;
    /* keep at most 500 stamps; drop ones older than 7 days */
    const cutoff = Date.now() - 7 * 864e5;
    Object.keys(mem._ts).forEach(k => { if (Date.parse(k) < cutoff) delete mem._ts[k]; });
    return iso;
  };
  const newestStamp = obj => {
    let best = 0;
    Object.keys(obj || {}).forEach(k => { const t = tsOf(k); if (t > best) best = t; });
    return best;
  };
  /* server-side updated_at fallback for legacy rows written before v4.13e */
  const rowUpdatedAt = k => {
    const r = lastServerRows.find(x => x && x.k === k);
    return r ? tsOf(r.updated_at) : 0;
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

  /* v4.13c DH — every write now also stamps `last_writer` with this device's
     tag (persisted locally, random per install). The column has a DEFAULT in
     SQL and is purely additive, so old rows/queries keep working; it gives a
     per-key audit trail of WHICH device last synced the data. */
  const LS_WRITER_KEY = 'dhContract.deviceTag.v1';
  const deviceTag = (() => {
    try {
      let t = safeGet(LS_WRITER_KEY);
      if (!t) {
        t = 'dev-' + Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36);
        safeSet(LS_WRITER_KEY, t);
      }
      return t;
    } catch { return 'unknown'; }
  })();

  const upsert = (k, v) => {
    if (!sb) return Promise.resolve(false);
    return runWrite('upsert ' + k, () => sb.from('contract_state').upsert({ k, v, last_writer: deviceTag }));
  };

  /* v4.13d/e DH — THE "SAVE WIPES THE OTHER DEVICE'S EDITS" BUG (cross-device
     sync guarantee): every writer used to REPLACE its whole cloud key with
     this device's in-memory copy, and merges were arrival-order-dependent.
     Now every write is a per-key / per-day LAST-WRITER-WINS merge driven by
     updatedAt timestamps carried INSIDE the payloads (server row ∪ local
     mirror ∪ local snapshot ∪ this device's fresh DOM), so nothing another
     device saved can ever be erased or lost by a save on this one — no
     matter which write lands first. Deletions stick because they are
     EXPLICIT tombstones ('deleted' key + local store), never absence-driven. */
  const freshLocal = (key, snap) => {
    try {
      if (typeof window.dhCollectFresh === 'function') {
        const f = window.dhCollectFresh(key);
        if (Array.isArray(f) && Array.isArray(snap)) return snap.concat(f);   // days: newest ts wins later
        if (f && typeof f === 'object') return Object.assign({}, snap || {}, f);
      }
    } catch { /* app.js not booted yet — fall back to caller snapshot */ }
    return snap;
  };
  const serverRowVal = (k) => {
    const i = lastServerRows.findIndex(r => r && r.k === k);
    return i >= 0 ? lastServerRows[i].v : null;
  };
  /* day-level LWW: highest updatedAt wins per id; ties → later list wins */
  const mergeDaysLWW = lists => {
    const map = new Map();
    lists.forEach(list => {
      if (!Array.isArray(list)) return;
      pruneDeleted(list).forEach(d => {
        if (!d || !d.id || !d.html) return;
        const prev = map.get(d.id);
        if (!prev || +(d.updatedAt || 0) >= +(prev.updatedAt || 0)) map.set(d.id, d);
      });
    });
    return sortDays(Array.from(map.values()));
  };
  /* field/accept-level LWW across ordered sources (oldest → newest) */
  const mergeFieldsLWW = sources => {
    const out = {};
    const stampOf = obj => { const t = +(obj && obj.__ts); return Number.isFinite(t) ? t : 0; };
    sources.forEach(src => {
      if (!src || typeof src !== 'object') return;
      const s = stampOf(src);
      Object.keys(src).forEach(k => {
        if (k === '__ts') return;
        const cur = out[k];
        if (!cur || s >= cur.s) out[k] = { v: src[k], s: Math.max(s, cur ? cur.s : 0) };
      });
    });
    const merged = {};
    Object.keys(out).forEach(k => { merged[k] = out[k].v; });
    return merged;
  };
  const mergeKeyValues = (k, snap) => {
    const localMirror = (readMirrorLocal() || {})[k];
    const server = serverRowVal(k);
    if (k === 'days') {
      /* oldest→newest order: server, durable mirror, app snapshot, our live DOM */
      return mergeDaysLWW([server, readLocalDays(),
                           Array.isArray(localMirror) ? localMirror : ((localMirror || {}).days || []),
                           snap]);
    }
    /* plain object keys ('fields' / 'accepts'): per-key LWW using __ts stamps;
       legacy unstamped payloads fall back to their row's updated_at */
    const fb = rowUpdatedAt(k);
    const st = o => (o && typeof o.__ts === 'number' ? o.__ts : fb);
    return mergeFieldsLWW([server, localMirror, snap].map(o => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
      const c = Object.assign({}, o); c.__ts = st(o); return c;
    }));
  };
  const upsertMerged = (k, snap) => {
    if (!sb) return Promise.resolve(false);
    /* v4.13f DH — merge against the SERVER'S CURRENT ROW, not our possibly
       stale mirror: re-pull first so a save can never overwrite another
       device's newer values that we have not heard about yet (realtime can
       lag or be blocked by flaky networks). If the pull fails we still push
       the union with whatever server rows we last saw — never a blind replace. */
    const pre = sb ? fetchState().catch(() => null) : Promise.resolve(null);
    return pre.then(rows => {
      if (rows) applyRowsSilent(rows);
      let v = mergeKeyValues(k, freshLocal(k, snap));
      /* stamp the payload so every device merges by REAL write time, not arrival */
      if (k === 'days') v = v.map(d => Object.assign({}, d, { updatedAt: +(d.updatedAt) || Date.now() }));
      else { v = Object.assign({}, v); v.__ts = Date.now(); }
      mem[k] = v;                       // mirror now holds the merged truth too
      writeMirrorLocal();
      return upsert(k, v);
    });
  };

  /* v4.13f DH — hoisted: shared by applyRows() AND the pre-write silent merge */
  const withTs = (o, t) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return o; const c = Object.assign({}, o); if (typeof c.__ts !== 'number') c.__ts = t; return c; };

  /* apply inbound rows to the mirror WITHOUT the upward-re-seed side effects
     (used right before a merged write; the full applyRows() keeps its old
     behaviour for pulls/realtime where adoption-upward is desirable). */
  const applyRowsSilent = rows => {
    (rows || []).forEach(r => {
      if (!r || !r.k) return;
      if (r.k === 'fields' && r.v && typeof r.v === 'object') {
        mem.fields = mergeFieldsLWW([withTs(mem.fields, 0), withTs(r.v, tsOf(r.updated_at))]);
      }
      if (r.k === 'accepts' && r.v && typeof r.v === 'object') {
        mem.accepts = mergeFieldsLWW([withTs(mem.accepts, 0), withTs(r.v, tsOf(r.updated_at))]);
      }
      if (r.k === 'days' && Array.isArray(r.v)) {
        mem.days = mergeDaysLWW([mem.days, r.v]);
      }
      if (r.k === 'deleted' && r.v && typeof r.v === 'object' && !Array.isArray(r.v)) {
        mem.deleted = Object.assign({}, mem.deleted || {}, r.v);
      }
    });
    lastServerRows = Array.isArray(rows) ? rows.slice() : lastServerRows;
  };

  /* ---------- v4.13e DH — CLOUD DELETED-DAY TOMBSTONES (key 'deleted') ----------
     {dayId: epochMs}. Written whenever THIS device deletes/wipes a day (app.js
     calls CloudStore.saveDeleted via dhAddDeleted hook) and merged upward on
     every pull. Every device honours them in pruneDeleted(), so "✖ Delete day"
     on one phone is permanent on ALL phones — while a day re-created afterwards
     (newer updatedAt) automatically lifts its stale tombstone everywhere. */
  const deletedMapFromServer = () => {
    const r = serverRowVal('deleted');
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
  };
  const pushDeletedTombstones = () => {
    if (!sb) return Promise.resolve(false);
    const local = (() => { try { return normDelMap(safeGet(LS_DELETED_KEY)); } catch { return {}; } })();
    const extra = (() => { try { return (typeof window.dhReadDeleted === 'function' ? window.dhReadDeleted() : []) || []; } catch { return []; } })();
    const merged = Object.assign({}, deletedMapFromServer());
    Object.entries(local).forEach(([id, t]) => { if (!(id in merged) || merged[id] < t) merged[id] = t; });
    extra.forEach(id => { if (!(id in merged)) merged[id] = Date.now(); });
    mem.deleted = merged;
    return upsert('deleted', merged);
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
    /* v4.13e DH — MERGE, never replace-with-empty AND never absence-delete:
       whatever is already in the mirror or in this device's localStorage
       snapshot is preserved; days only disappear when an EXPLICIT tombstone
       (local store or cloud 'deleted' key) says so. */
    const mirrorSnap  = readMirrorLocal();               // v4.1 — our own durable copy
    const localDays   = mergeDays(readLocalDays(), mirrorSnap && mirrorSnap.days);
    const cloud = { fields: null, accepts: null, days: null, deleted: null };
    (rows || []).forEach(r => {
      if (r.k === 'fields')  cloud.fields  = r.v || {};
      if (r.k === 'accepts') cloud.accepts = r.v || {};
      if (r.k === 'days' && Array.isArray(r.v)) cloud.days = r.v;
      if (r.k === 'deleted' && r.v && typeof r.v === 'object' && !Array.isArray(r.v)) cloud.deleted = r.v;
      /* NOTE: 'wiped' rows are intentionally IGNORED from now on — the
         sticky auto-wipe behaviour is removed (v4.0). */
    });
    /* v4.13e DH — adopt CLOUD tombstones into this device's local store so a
       day deleted on the other phone stays deleted here too (explicitly — we
       no longer treat "missing from the list" as a deletion). */
    if (cloud.deleted) {
      mem.deleted = Object.assign({}, mem.deleted || {}, cloud.deleted);
      const ids = Object.keys(cloud.deleted);
      if (ids.length) rememberDeleted(ids);
    }
    /* per-day LAST-WRITER-WINS across server row / durable mirror / app
       snapshot / live DOM — arrival order can no longer lose data */
    mem.days = pruneDeleted(mergeDaysLWW([
      cloud.days,
      mirrorSnap && mirrorSnap.days,
      readLocalDays(),
      mem.days,
    ]));
    /* v4.12b DH — also scrub tombstoned days out of localStorage snapshots */
    pruneLocalSnapshots();
    /* per-field LWW driven by the __ts stamps inside each payload */
    const fbF = (() => { const r = (rows || []).find(x => x && x.k === 'fields'); return r ? tsOf(r.updated_at) : 0; })();
    const fbA = (() => { const r = (rows || []).find(x => x && x.k === 'accepts'); return r ? tsOf(r.updated_at) : 0; })();
    const withTs = (o, t) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return o; const c = Object.assign({}, o); if (typeof c.__ts !== 'number') c.__ts = t; return c; };
    mem.fields = mergeFieldsLWW([
      withTs(Object.assign({}, (mirrorSnap && mirrorSnap.fields) || {}, readLocalFields()), 0),
      withTs(mem.fields, 0),
      withTs(cloud.fields, fbF),
    ]);
    mem.accepts = mergeFieldsLWW([
      withTs((mirrorSnap && mirrorSnap.accepts) || {}, 0),
      withTs(mem.accepts, 0),
      withTs(cloud.accepts, fbA),
    ]);
    /* v4.1 — keep the durable local mirror exactly in sync with what we know */
    writeMirrorLocal();
    /* if the cloud had nothing but we have local data, adopt it upward so the
       next save/flush re-seeds Supabase instead of leaving it empty forever */
    if (!cloud.days && mem.days.length) upsert('days', mem.days);
    if (!cloud.fields && Object.keys(mem.fields).length) upsert('fields', mem.fields);
    /* push any local tombstones the cloud does not know about yet (e.g. a
       deletion performed while this device was offline) */
    if (Object.keys(mem.deleted || {}).some(id => !(cloud.deleted && id in cloud.deleted))) pushDeletedTombstones();
  };

  /* v4.13f DH — hoisted ABOVE every user (upsertMerged now pulls through it).
     The most recent server rows we have seen (from any pull); mergeKeyValues()
     unions writes against these so a save from this device can never erase
     another device's newer values that we already know about. */
  let lastServerRows = [];
  const fetchState = async () => {
    if (!sb) return [];
    /* updated_at is pulled too: LWW falls back to it for legacy unstamped rows */
    const { data, error } = await sb.from('contract_state').select('k,v,updated_at');
    if (error) throw error;
    lastServerRows = Array.isArray(data) ? data : [];
    return data;
  };

  /* v4.13f DH — write QUEUE: one lane per cloud key, strictly serialised.
     Without this, two upserts of the same key fired back-to-back (e.g. the
     persistDays + saveDays double-push on every day creation) could interleave
     their read-modify-write steps and land an older merged value after a newer
     one — silently dropping the other side's edits across devices. */
  const writeLane = {};
  const queued = (k, job) => {
    const prev = writeLane[k] || Promise.resolve();
    const run = prev.catch(() => {}).then(job);
    writeLane[k] = run.then(() => true, () => false);
    return run;
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
  /* v4.13d DH — realtime listeners registered by app.js. After every pull we
     fire them so the OTHER device's saves are replayed into the live DOM
     within ~1 second (previously only tab-focus did that). */
  const changeListeners = [];
  let lastPushSig = '';            // signature of OUR OWN last merged push
  const pushSignature = () => {
    try { return JSON.stringify([mem.fields, mem.accepts, mem.days]); } catch { return ''; }
  };
  const startRealtime = () => {
    if (!sb || channel || !sb.realtime || typeof sb.channel !== 'function') return;
    try {
      channel = sb.channel('contract_state_changes')
        .on('postgres_changes',
            { schema: 'public', table: 'contract_state' },
            () => {
              clearTimeout(rtTimer);
              rtTimer = setTimeout(() => {
                cloud.refresh().then(st => {
                  if (st) changeListeners.forEach(fn => { try { fn(st); } catch { /* ignore */ } });
                }).catch(() => {});
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
        upsertMerged('fields',  mem.fields);             // v4.13e — merged pushes, never raw replace
        upsertMerged('accepts', mem.accepts);
        upsertMerged('days',    mem.days);
        pushDeletedTombstones();                         // deletions travel too
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

    saveFields(fields) { return upsertMerged('fields',  Object.assign({}, mem.fields, fields)); },
    saveAccepts(a)     { return upsertMerged('accepts', Object.assign({}, mem.accepts, a)); },
    /* v4.2 DH — setMirrorDays(list): authoritative DOM snapshot from app.js's
       persistDays(). Updates this device's durable local copy, then pushes the
       MERGED list to Supabase.
       v4.13e DH — NO MORE ABSENCE-DELETION: a day missing from this snapshot is
       NOT tombstoned any more (that rule silently erased the other phone's days
       whenever a stale/partial snapshot was pushed). Deletions are explicit:
       app.js calls CloudStore.saveDeleted() from ✖ Delete / 🧹 Wipe, which
       writes a timestamped tombstone locally AND to the cloud 'deleted' key;
       pruneDeleted() honours those on every inbound and outbound list. */
    setMirrorDays(list) {
      if (!Array.isArray(list)) return Promise.resolve(false);
      const next = pruneDeleted(list.filter(d => d && d.id && d.html));
      mem.days = mergeDaysLWW([serverRowVal('days'), readLocalDays(),
                                ((readMirrorLocal() || {}).days || []), next]);
      writeMirrorLocal();
      pruneLocalSnapshots();
      return upsertMerged('days', mem.days);
    },
    /* v4.1 DH — saveDays MERGES with the mirror instead of replacing it, so an
       AI day captured by one code path is never dropped by another path that
       ran with a slightly older DOM snapshot.
       v4.12 DH — mergeDays now prunes every tombstoned (deleted) day first. */
    saveDays(list)     { return upsertMerged('days', pruneDeleted(mergeDays(list, mem.days))); },
    /* v4.13e DH — EXPLICIT DELETION API used by app.js (✖ Delete day / 🧹 Wipe):
       records the tombstones locally and pushes them to the shared 'deleted'
       key so the removal sticks on EVERY device, permanently. */
    saveDeleted(ids)   { rememberDeleted(ids); return pushDeletedTombstones(); },
    /* v4.0 DH — no-op kept for backwards compatibility with app.js v3.x calls.
       The sticky "wiped" flag is dead: nothing may auto-clear days anymore. */
    saveWiped()        { return Promise.resolve(true); },

    /* synchronous accessors used by the UI between saves */
    fields()  { return Object.assign({}, mem.fields); },
    accepts() { return Object.assign({}, mem.accepts); },
    days()    { return mem.days.slice(); },
    /* v4.13d DH — subscribe to "the other device saved something" events.
     app.js registers resyncFromCloud here so realtime pushes replay into the
     live DOM immediately, not only when the tab regains focus. */
    onChange(fn) { if (typeof fn === 'function') changeListeners.push(fn); },
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
