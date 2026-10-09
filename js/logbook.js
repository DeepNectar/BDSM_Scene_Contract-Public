/* ============================================================
   BDSM Log Book integration — v1.0 DH (contract app v4.3)
   ------------------------------------------------------------
   Bridges this Eternal Contract app with the companion site
   "Deep & Honey's BDSM Contract Log Book":
        https://bdsmlogbook.vercel.app/

   The log book keeps its OWN cloud: Supabase project
   `sjaxgxsvtldcgvunzeye`, table `log_book_data`
   (columns: sheet_name PK text, html_content text, updated_at).
   Rows are the raw innerHTML of each sheet body:
     dailyBody · dailyFeedbackBody · dominantBody · dominantFeedbackBody
     bonusBody · sceneBody · toyBody · debriefBody · weeklyBody
     finalBody · settingsBody

   This module only ever READS that original cloud (safe GET select —
   it can never corrupt or delete the log book's data) and shows the
   newest activity per contract day inside the Day pages, with links
   straight into the log book site.

   It also wires the header / per-day "📔 Open Log Book" buttons:
     • desktop → inline full-screen iframe (the site is served with
       x-frame-options SAMEORIGIN, so embedding from another origin
       is blocked — we detect the block and fall back automatically)
     • fallback / small screens → open in a new tab
   Nothing here writes to the contract cloud; saving stays exactly as
   before (this app's own Supabase mirror + localStorage safety net).
   ============================================================ */
(() => {
  'use strict';

  const LB_URL = 'https://bdsmlogbook.vercel.app/';
  const LB_REST = 'https://sjaxgxsvtldcgvunzeye.supabase.co/rest/v1';
  /* anon key already public in the log book's own js/main.js — read-only use */
  const LB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqYXhneHN2dGxkY2d2dW56ZXllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MTQ2MjIsImV4cCI6MjEwNTE5MDYyMn0.JiKiYBGAJCMyDUiArZfRmscTK2XoypBIs1FTNLKpKUQ';

  /* every sheet of the log book, in tab order */
  const SHEETS = [
    ['dailyBody',            'Daily Log'],
    ['dailyFeedbackBody',    'Daily Feedback'],
    ['dominantBody',         'Dominant Journal'],
    ['dominantFeedbackBody', 'Dominant Feedback'],
    ['bonusBody',            'Bonus Board'],
    ['sceneBody',            'Scene Log'],
    ['toyBody',              'Toy Inventory'],
    ['debriefBody',          'Scene Debrief'],
    ['weeklyBody',           'Weekly Review'],
    ['finalBody',            'Final Summary'],
    ['settingsBody',         'Settings']
  ];

  const REFRESH_MS = 5 * 60 * 1000;      // re-pull the log book cloud every 5 min
  let lastPullAt = 0;
  let pulling = null;                     // shared in-flight promise
  let latest = {};                        // sheet_name -> {html, ts}

  const escH = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const $  = sel => document.querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const fmtAgo = ts => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  };

  /* ---------- pull the log book's ORIGINAL cloud (read-only GET) ---------- */
  const fetchLogRows = async () => {
    const res = await fetch(`${LB_REST}/log_book_data?select=sheet_name,html_content,updated_at`, {
      headers: { apikey: LB_KEY, Authorization: 'Bearer ' + LB_KEY },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('logbook cloud HTTP ' + res.status);
    return res.json();
  };

  const pullLogBook = (force) => {
    if (pulling) return pulling;
    if (!force && latest.dailyBody && Date.now() - lastPullAt < REFRESH_MS) {
      return Promise.resolve(latest);
    }
    pulling = fetchLogRows().then(rows => {
      latest = {};
      (rows || []).forEach(r => {
        if (!r || !r.sheet_name) return;
        latest[r.sheet_name] = {
          html: r.html_content || '',
          ts: Date.parse(r.updated_at || '') || Date.now()
        };
      });
      lastPullAt = Date.now();
      return latest;
    }).catch(e => {
      console.warn('[logbook] cloud read failed:', e);
      return latest;                       // keep whatever we had (may be {})
    }).finally(() => { pulling = null; });
    return pulling;
  };

  /* ---------- value extraction from a sheet's stored row HTML ---------- */
  /* Returns an array of plain-string values for every first-cell date
     found in the sheet (inputs carry the date, selects/selects/text follow). */
  const tmpHost = document.createElement('div');

  const cellText = td => {
    if (!td) return '';
    const inp = td.querySelector('input');
    if (inp) return inp.value.trim();
    const ta = td.querySelector('textarea');
    if (ta) return ta.value.trim();
    return (td.textContent || '').trim();
  };

  const parseSheet = name => {
    const entry = latest[name];
    if (!entry || !entry.html) return [];
    tmpHost.innerHTML = entry.html;
    return Array.from(tmpHost.querySelectorAll('tr')).map(tr =>
      Array.from(tr.children).map(cellText)
    ).filter(cells => cells.length && cells.some(c => c));
  };

  /* normalise "Oct 09, 2026" / "10/09/2026" / "Oct 9" → comparable key */
  const toKey = str => {
    if (!str) return null;
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str.trim());
    if (dmy) return dmy[3] + '-' + dmy[2].padStart(2, '0') + '-' + dmy[1].padStart(2, '0');
    const t = Date.parse(str.trim());
    if (!isNaN(t)) {
      const d = new Date(t);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return null;
  };

  const dayDateKey = page => {
    /* "2.1 Date of scene" row — the first .datetime-group with 3 numeric
       inputs (DD / MM / YYYY) inside the day page. */
    try {
      const groups = Array.from(page.querySelectorAll('.datetime-group'));
      for (const g of groups) {
        const ins = Array.from(g.querySelectorAll('input'));
        if (ins.length !== 3) continue;
        const d = parseInt(ins[0].value, 10);
        const m = parseInt(ins[1].value, 10);
        const y = parseInt(ins[2].value, 10);
        if (d && m && y) return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    } catch { /* fall through */ }
    /* fallback: any date-looking text inside the day's heading
       (AI days carry p.dateStr like "Fri, Oct 9, 2026") */
    try {
      const head = page.querySelector('.page-head h2');
      if (head) {
        const m = /([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/.exec(head.textContent || '');
        if (m) return toKey(m[1]);
      }
    } catch { /* ignore */ }
    return null;
  };

  /* ---------- render the per-day feed ---------- */
  const FEED_SHEETS = [
    ['sceneBody',   '🎬 Scene logged'],
    ['dailyBody',   '📅 Daily log entry'],
    ['debriefBody', '💞 Debrief filed'],
    ['toyBody',     '🧸 Toy inventory'],
    ['bonusBody',   '🎁 Bonus earned'],
    ['dominantBody','👑 Dominant journal']
  ];

  const renderDayFeeds = () => {
    $$('.page').filter(p => /^day\d+$/.test(p.id)).forEach(page => {
      const host = page.querySelector('.logbook-feed');
      if (!host) return;
      const key = dayDateKey(page);
      const chips = [];
      let newestTs = 0;
      FEED_SHEETS.forEach(([name, label]) => {
        const rows = parseSheet(name);
        if (!rows.length) return;
        let matched = 0;
        rows.forEach(cells => {
          const k = toKey(cells[0]);
          if (key && k === key) matched++;
        });
        if (matched) chips.push(`<span class="lb-chip">${label} ×${matched}</span>`);
        newestTs = Math.max(newestTs, (latest[name] || {}).ts || 0);
      });
      if (chips.length) {
        host.innerHTML =
          `<span class="lb-feed-title">📔 From the BDSM Log Book</span>` +
          chips.join('') +
          `<span class="lb-feed-time">log book cloud updated ${escH(fmtAgo(newestTs))}</span>` +
          `<a class="lb-link" href="${LB_URL}" target="_blank" rel="noopener" title="Opens ${LB_URL} in a new tab">Open the day in the Log Book ↗</a>`;
        host.classList.add('has-data');
      } else {
        host.innerHTML =
          `<span class="lb-feed-title">📔 BDSM Log Book</span>` +
          `<span class="lb-feed-empty muted">No ${key ? 'entries dated ' + escH(key) : 'matching'} entries yet — write today's log in the Log Book and it appears here.</span>` +
          `<a class="lb-link" href="${LB_URL}" target="_blank" rel="noopener" title="Opens ${LB_URL} in a new tab">Open Log Book ↗</a>`;
        host.classList.remove('has-data');
      }
    });
  };

  /* ---------- global "last updated" line under the header pill ---------- */
  const renderHeaderInfo = () => {
    const el = $('#logbook-status');
    if (!el) return;
    const anyTs = Object.values(latest).reduce((mx, e) => Math.max(mx, e.ts || 0), 0);
    if (!anyTs) {
      el.textContent = '📔 Log Book: cloud not reachable right now — tap “Open Log Book” to visit the site directly.';
      return;
    }
    el.textContent = `📔 BDSM Log Book linked · last saved there ${fmtAgo(anyTs)} · opens ${LB_URL}`;
    el.title = 'The Log Book keeps its own Supabase cloud (table log_book_data). This contract only reads it and links to it — nothing moves out of that original cloud.';
  };

  const refreshAll = () => {
    renderDayFeeds();
    renderHeaderInfo();
  };

  const sync = (force) => pullLogBook(force).then(refreshAll);

  /* ---------- re-render when the CONTRACT data changes ----------
     app.js's save() triggers a realtime 'postgres_changes' event on our own
     contract_state table → cloud.js refreshes → this listener fires. So every
     time a day is saved / its date edited, the Log Book feeds re-match and
     update right away ("if updated to this"). */
  if (window.supabase && window.supabase.createClient && window.SUPABASE_CONFIG
      && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey) {
    try {
      const own = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
      own.channel('dh_contract_saved_feed')
        .on('postgres_changes', { schema: 'public', table: 'contract_state' }, () => {
          ensureFeedSlots(); wireButtons(); refreshAll();   // cheap DOM re-read of current values
        })
        .subscribe();
    } catch (e) { console.warn('[logbook] contract change feed unavailable:', e); }
  }

  /* ---------- full-screen viewer (iframe with new-tab fallback) ---------- */
  const ensureViewer = () => {
    let v = $('#lb-viewer');
    if (v) return v;
    v = document.createElement('div');
    v.id = 'lb-viewer';
    v.className = 'lb-viewer hidden';
    v.innerHTML =
      `<div class="lb-viewer-bar">` +
        `<span class="lb-viewer-title">📔 Deep &amp; Honey · BDSM Contract Log Book</span>` +
        `<a class="lb-viewer-open" href="${LB_URL}" target="_blank" rel="noopener">↗ New tab</a>` +
        `<button class="lb-viewer-close" type="button" aria-label="Close the Log Book">×</button>` +
      `</div>` +
      `<div class="lb-viewer-blocked hidden">⚠️ The Log Book site blocks being shown inside other apps (x-frame-options), so it opened in a new browser tab instead.</div>` +
      `<iframe class="lb-viewer-frame" title="BDSM Log Book" src="about:blank" referrerpolicy="no-referrer"></iframe>`;
    document.body.appendChild(v);

    const frame = v.querySelector('iframe');
    const blocked = v.querySelector('.lb-viewer-blocked');
    let loadedOk = false;

    const openExternally = () => {
      try { window.open(LB_URL, '_blank', 'noopener'); } catch { location.href = LB_URL; }
    };

    v.querySelector('.lb-viewer-close').addEventListener('click', closeViewer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !v.classList.contains('hidden')) closeViewer();
    });

    /* the real link/button fallback lives INSIDE the bar too */
    v.querySelector('.lb-viewer-open').addEventListener('click', () => closeViewer());

    frame.addEventListener('load', () => {
      /* about:blank fires once immediately; the real doc sets loadedOk */
      try { loadedOk = frame.contentWindow.location.href !== 'about:blank'; }
      catch { loadedOk = false; }                    // cross-origin → actually LOADED fine
    });

    v._openFrame = () => {
      loadedOk = false;
      blocked.classList.add('hidden');
      frame.src = LB_URL + '#from-contract';
      setTimeout(() => {
        /* If the framed doc never reported a URL (SAMEORIGIN block renders an
           error page we cannot introspect), assume blocked: show notice + open tab. */
        let href = '';
        try { href = frame.contentWindow.location.href; } catch { href = 'cross-origin-ok'; }
        if (href === 'about:blank') {
          blocked.classList.remove('hidden');
          openExternally();
        }
      }, 3500);
    };
    return v;
  };

  const closeViewer = () => {
    const v = $('#lb-viewer');
    if (!v) return;
    v.classList.add('hidden');
    const frame = v.querySelector('iframe');
    if (frame) frame.src = 'about:blank';            // stop the embedded session
  };

  const openLogBook = () => {
    /* phones: iframes of an auth-protected third-party site are cramped — go straight to a tab */
    if (window.innerWidth < 768) {
      try { window.open(LB_URL, '_blank', 'noopener'); } catch { location.href = LB_URL; }
      return;
    }
    const v = ensureViewer();
    v.classList.remove('hidden');
    v._openFrame();
  };

  /* ---------- wire every "open-logbook" trigger ---------- */
  const wireButtons = (root) => {
    $$('[data-open-logbook]', root || document).forEach(btn => {
      if (btn.dataset.lbWired) return;
      btn.dataset.lbWired = '1';
      btn.addEventListener('click', e => { e.preventDefault(); openLogBook(); });
    });
  };

  /* ---------- inject the per-day feed slot into every day page ---------- */
  const ensureFeedSlots = () => {
    $$('.page').filter(p => /^day\d+$/.test(p.id)).forEach(page => {
      if (page.querySelector('.logbook-feed')) return;
      const slot = document.createElement('div');
      slot.className = 'logbook-feed';
      /* place right after the day-finished toolbar so it sits near the top */
      const tools = page.querySelector('.day-finished');
      if (tools && tools.parentNode === page) tools.after(slot);
      else {
        const head = page.querySelector('.page-head');
        if (head) head.after(slot); else page.prepend(slot);
      }
    });
  };

  /* ---------- boot ---------- */
  const start = () => {
    ensureFeedSlots();
    wireButtons();
    refreshAll();
    sync(false);
    setInterval(() => { if (document.visibilityState === 'visible') sync(true); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync(true);
    });
  };

  /* hooks so app.js keeps NEW/AI-created days integrated too */
  window.dhLogbookSync = () => { ensureFeedSlots(); wireButtons(); sync(true); };
  window.dhLogbookRefreshDom = () => { ensureFeedSlots(); wireButtons(); refreshAll(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
