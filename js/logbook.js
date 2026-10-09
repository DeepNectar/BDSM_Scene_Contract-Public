/* ============================================================
   BDSM Log Book integration — v3.0 DH (contract app v4.5)
   ------------------------------------------------------------
   v3 CHANGES ("all data columns should come in the day's
   Pre-Scene Execution Affidavit"):
     • The 📔 BDSM Log Book form is no longer a separate collapsed
       box under Article 2 — it is INJECTED INSIDE the "Pre-Scene
       Execution Affidavit" section of every Day page, as its own
       block titled "📔 BDSM Log Book — Pre-Scene entries".
     • EVERY column of EVERY log book sheet now appears as a field:
       Daily · Scene · Debrief · Toys · Bonus · Dominant journal ·
       both Feedback sheets — including the Date column, which is
       auto-filled from Article 2.1 / the affidavit execution date.
     • New rows are built with the FULL column count of each sheet
       (missing values become empty cells), so the stored HTML on
       bdsmlogbook.vercel.app always matches its table headers.
     • The old floating form is removed automatically on upgrade
       (cleanup), and the feed slot moved above the affidavit too.
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

   WHAT CHANGED IN v2 (fixes "log book not working"):
     1. The old build only READ the log book cloud and showed chips —
        there was nothing to actually fill in. Now every Day page has a
        full editable PRE-SCENE LOG BOOK form ("📔 BDSM Log Book —
        Pre-Scene") that pushes its data INTO THE LOG BOOK'S ORIGINAL
        CLOUD ONLY (same table, same rows the log book itself uses).
     2. Writes are surgical: we upsert ONLY the affected sheet row(s),
        merging new <tr>s into the existing stored html — never a
        whole-table overwrite, so other days / sheets can't be wiped.
     3. Read-back now parses the REAL stored format (rows start with a
        date <input value="Oct 07, 2026"> inside the saved tr HTML).
     4. Duplicate-safe: before pushing, any existing cloud row for the
        same day is replaced (kept as one row per contract day; our own
        rows carry a hidden __dhn:<YYYY-MM-DD> marker on the <tr>).
     5. After our push lands, the header status line + per-day feeds
        refresh from the cloud; the log book site shows the new entry on
        its next pull (it re-pulls on open / tab focus).

   Links to the log book site stay one-tap everywhere; the contract's
   own save flow is untouched apart from an optional log-book push when
   the user presses 📤 (app.js also calls dhLogbookAutoPush on 💾 Save
   when a day's form is dirty).
   ============================================================ */
(() => {
  'use strict';

  const LB_URL = 'https://bdsmlogbook.vercel.app/';
  const LB_REST = 'https://sjaxgxsvtldcgvunzeye.supabase.co/rest/v1';
  /* anon key already public in the log book's own js/main.js — same access
     the log book site itself uses (RLS allows select+upsert on log_book_data) */
  const LB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqYXhneHN2dGxkY2d2dW56ZXllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MTQ2MjIsImV4cCI6MjEwNTE5MDYyMn0.JiKiYBGAJCMyDUiArZfRmscTK2XoypBIs1FTNLKpKUQ';

  const LB_LS = 'dhLogbook.v3';           // localStorage mirror of what we pulled/pushed

  const REFRESH_MS = 5 * 60 * 1000;       // re-pull the log book cloud every 5 min
  let lastPullAt = 0;
  let pulling = null;                     // shared in-flight promise
  let latest = {};                        // sheet_name -> {html, ts}

  try { latest = JSON.parse(localStorage.getItem(LB_LS) || '{}') || {}; } catch { latest = {}; }

  const escH = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const $  = sel => document.querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  /* v3.1 FIX: `ctl > *` is a child combinator and jsdom's CSS engine does
     not support it — every field lookup returned null, so the pre-scene
     form rendered as labels only (no inputs/selects) and pushing threw.
     Rewritten with supported combinators; identical behaviour in browsers. */
  const directChildEl = (root, parentSel, childSel) => {
    for (const c of Array.from(root.children)) {
      if (!c.matches || !c.matches(parentSel)) continue;
      for (const g of Array.from(c.children)) {
        if (!childSel || g.matches(childSel)) return g;
      }
    }
    return null;
  };
  /* the actual input/select inside a .lb-fld-ctl wrapper of a field label */
  const ctlOf = lab => directChildEl(lab, '.lb-fld-ctl', '*');

  const fmtAgo = ts => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  };

  /* ---------- option lists copied from the log book's own LISTS ----------
     (so the selects we generate match exactly what the site offers) */
  const OPTS = {
    mood: ['1','2','3','4','5','6','7','8','9','10'],
    followed: ['Yes','No','Partially','Mostly','Almost','Completely','Not Yet','Working On It','Getting There','Almost There','Absolutely','Definitely','Sometimes','Rarely','Never','Always','Consistently','Intermittently','Progressing','Struggling','Succeeding'],
    feelings: ['Loved','Safe','Happy','Grateful','Content','Anxious','Tired','Stressed','Neutral','Connected','Peaceful','Excited','Nervous','Relaxed','Empowered','Vulnerable','Strong','Beautiful','Adored','Cherished','Protected','Free','Playful','Submissive','Dominant','Proud','Thankful','Blissful','Ecstatic','Calm','Restless','Curious','Intense','Deep','Satisfied','Fulfilled','Complete','Radiant','Serene','Trusting','Brave','Surrendered','Worthy','Energized','Soothing','Passionate','Tender','Captivated','Transformed','Alive','Hopeful','Joyful','Confident','Secure','Valued','Respected','Honored','Nurtured','Inspired','Motivated','Grounded','Centered','Balanced','Harmonious','Euphoric','Rapturous','Enchanted','Mesmerized','Awestruck','Giddy','Affectionate','Devoted','Loyal','Faithful','Committed'],
    safeWords: ['No','Green','Yellow','Red','Not Needed','Not Used','Used Green','Used Yellow','Used Red','Pause','Stop','Check-in','Slow Down','Full Stop','Continue','Hold','Wait','Breathe','Time Out','Mercy','Enough','Please','Help','Need Break','Need Space','Too Much','Perfect','Good','Harder','Softer','Slower','Faster','More','Less','Keep Going','Take Control','Let Go','Trust','Safe','Unsafe','Comfort','Discomfort'],
    aftercare: ['Yes','No','Partially','Completely','Mostly','Not Yet','Extended','Short','Thorough','Minimal','Cuddled','Hydrated','Talked','Massaged','Rested','Snacked','Wrapped','Held','Soothed','Comforted','Reassured','Pampered','Nurtured','Cared For','Loved','Adored','Cherished','Protected','Safe','Warm','Cozy','Peaceful','Relaxed','Content','Happy','Tender','Gentle','Soft','Calm','Quiet','Silent','Connected','Intimate'],
    safeLoved: ['Yes','No','Somewhat','Mostly','Completely','Absolutely','Not Really','Partially','Almost','Entirely','Totally','Deeply','Fully','Wholly','Utterly','Unconditionally','Genuinely','Truly','Authentically','Profoundly','Unquestionably','Undoubtedly','Certainly'],
    whoEarned: ['Honey','Deep','Both','Mutual','Shared','Together','Each Other','Team Effort','Collaborative'],
    fulfilled: ['Yes','No','Partially','Mostly','Completely','Not Yet','Working On It','Almost','Getting There','Achieved','Exceeded','Met','In Progress','Developing','Growing','Improving','Advancing','Progressing','Succeeding','Struggling','Learning','Adapting','Overcoming','Persevering','Continuing','Dedicated','Committed','Focused','Determined','Resolute','Steadfast'],
    praise: ['Excellent','Great','Good','Needs Improvement','Keep Going','Proud of You','Amazing','Beautiful','Outstanding','Fantastic','Brilliant','Spectacular','Wonderful','Incredible','Superb','Marvelous','Terrific','Fabulous','Awesome','Perfect','Loved It','Impressive','Remarkable','Exceptional','Stellar','Magnificent','Sublime','Inspiring','Phenomenal','Extraordinary','Unforgettable','Heavenly','Divine','Radiant','Glorious','Majestic','Exquisite','Captivating','Enchanting','Mesmerizing','Awe-inspiring','Breathtaking','Transcendent','Supreme','Ultimate','Peerless','Unmatched','Incomparable']
  };

  /* ---------- field descriptors: kind + target sheet + column index ------
     col 0 is always the Date column (owned by us). These map straight onto
     the log book's own headers:
       daily   : Date Mood FollowedRules Explain FavMoment Tomorrow Feelings
       scene   : Date Duration Activities SafeWord Rating Aftercare Notes Feelings
       debrief : Date FavMoment Uncomfortable Safe&Loved WantMore WantLess Rating Notes
       toy     : Date ToysUsed NewToy ToyRefused Notes Feelings
       bonus   : Date WhoEarned Why BonusGiven Received Notes
       dom     : Date Mood LedWithCare FulfilledResp IfNoExplain ProudOf Improve Feelings
       feedback sheets: Date | Praise-select                                  */
  const FIELDS = [
    /* ---- Daily sheet ---- */
    { k:'sel',  sheet:'dailyBody', col:1, list:'mood',     label:'Mood (1–10)' },
    { k:'sel',  sheet:'dailyBody', col:2, list:'followed', label:'Followed rules?' },
    { k:'text', sheet:'dailyBody', col:3, ph:'If no, explain…', label:'If no, explain' },
    { k:'text', sheet:'dailyBody', col:4, ph:'Favorite moment', label:'Favorite moment' },
    { k:'text', sheet:'dailyBody', col:5, ph:'What I want tomorrow…', label:'Tomorrow' },
    { k:'sel',  sheet:'dailyBody', col:6, list:'feelings', label:'How I feel now' },
    /* ---- Scene sheet ---- */
    { k:'text', sheet:'sceneBody', col:1, ph:'e.g. 75 min + aftercare', label:'Duration' },
    { k:'text', sheet:'sceneBody', col:2, ph:'Planned activities…', label:'Activities' },
    { k:'sel',  sheet:'sceneBody', col:3, list:'safeWords', label:'Safe word used?' },
    { k:'sel',  sheet:'sceneBody', col:4, list:'mood', label:'Rating (1–10)' },
    { k:'sel',  sheet:'sceneBody', col:5, list:'aftercare', label:'Aftercare planned?' },
    { k:'text', sheet:'sceneBody', col:6, ph:'Notes', label:'Notes' },
    { k:'sel',  sheet:'sceneBody', col:7, list:'feelings', label:'Feelings' },
    /* ---- Debrief sheet ---- */
    { k:'text', sheet:'debriefBody', col:1, ph:'Favorite moment', label:'Favorite moment' },
    { k:'text', sheet:'debriefBody', col:2, ph:'Anything uncomfortable?', label:'Uncomfortable?' },
    { k:'sel',  sheet:'debriefBody', col:3, list:'safeLoved', label:'Felt safe & loved?' },
    { k:'text', sheet:'debriefBody', col:4, ph:'Want more of…', label:'Want more' },
    { k:'text', sheet:'debriefBody', col:5, ph:'Want less of…', label:'Want less' },
    { k:'sel',  sheet:'debriefBody', col:6, list:'mood', label:'Debrief rating' },
    { k:'text', sheet:'debriefBody', col:7, ph:'Notes', label:'Notes' },
    /* ---- Toy inventory sheet ---- */
    { k:'text', sheet:'toyBody', col:1, ph:'Toys on the shelf tonight…', label:'Toys used' },
    { k:'sel',  sheet:'toyBody', col:2, list:'followed', label:'New toy introduced?' },
    { k:'sel',  sheet:'toyBody', col:3, list:'followed', label:'Toy refused?' },
    { k:'text', sheet:'toyBody', col:4, ph:'Notes', label:'Notes' },
    { k:'sel',  sheet:'toyBody', col:5, list:'feelings', label:'Feelings' },
    /* ---- Bonus board sheet ---- */
    { k:'sel',  sheet:'bonusBody', col:1, list:'whoEarned', label:'Who earned?' },
    { k:'text', sheet:'bonusBody', col:2, ph:'Why…', label:'Why' },
    { k:'text', sheet:'bonusBody', col:3, ph:'Bonus given', label:'Bonus given' },
    { k:'sel',  sheet:'bonusBody', col:4, list:'followed', label:'Received?' },
    { k:'text', sheet:'bonusBody', col:5, ph:'Notes', label:'Notes' },
    /* ---- Dominant journal sheet ---- */
    { k:'sel',  sheet:'dominantBody', col:1, list:'mood', label:'Dom mood (1–10)' },
    { k:'sel',  sheet:'dominantBody', col:2, list:'followed', label:'Led with care?' },
    { k:'sel',  sheet:'dominantBody', col:3, list:'fulfilled', label:'Fulfilled responsibilities?' },
    { k:'text', sheet:'dominantBody', col:4, ph:'If no, explain…', label:'If no, explain' },
    { k:'text', sheet:'dominantBody', col:5, ph:'Proud of…', label:'Proud of' },
    { k:'text', sheet:'dominantBody', col:6, ph:'Improve…', label:'Improve' },
    { k:'sel',  sheet:'dominantBody', col:7, list:'feelings', label:'Feelings' },
    /* ---- Feedback sheets (single extra column each) ---- */
    { k:'sel',  sheet:'dailyFeedbackBody',    col:1, list:'praise', label:'Sub feedback to Dom' },
    { k:'sel',  sheet:'dominantFeedbackBody', col:1, list:'praise', label:'Dom feedback to Sub' }
  ];

  const SHEET_LABEL = {
    dailyBody: '📅 Daily log', sceneBody: '🎬 Scene plan', toyBody: '🧸 Toys',
    bonusBody: '🎁 Bonus', dominantBody: '👑 Dominant journal',
    debriefBody: '💞 Debrief', dailyFeedbackBody: '💌 Sub → Dom feedback',
    dominantFeedbackBody: '💌 Dom → Sub feedback'
  };

  /* v3: FULL width of each sheet (Date col + every data col). Rows we push
     always carry this many <td>s so they line up with the log book's own
     table headers even when some fields are left blank. */
  const SHEET_WIDTH = {};
  FIELDS.forEach(f => {
    SHEET_WIDTH[f.sheet] = Math.max(SHEET_WIDTH[f.sheet] || 0, f.col);
  });

  /* ---------- cloud I/O -------------------------------------------------- */
  const lbHeaders = () => ({
    'apikey': LB_KEY,
    'Authorization': 'Bearer ' + LB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
  });

  const fetchLogRows = async (cols) => {
    const res = await fetch(`${LB_REST}/log_book_data?select=${cols}`, {
      headers: { apikey: LB_KEY, Authorization: 'Bearer ' + LB_KEY },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('logbook cloud HTTP ' + res.status);
    return res.json();
  };

  const persistMirror = () => {
    try { localStorage.setItem(LB_LS, JSON.stringify(latest)); } catch { /* quota — fine */ }
  };

  const pullLogBook = (force) => {
    if (pulling) return pulling;
    if (!force && Object.keys(latest).length && Date.now() - lastPullAt < REFRESH_MS) {
      return Promise.resolve(latest);
    }
    pulling = fetchLogRows('sheet_name,html_content,updated_at').then(rows => {
      latest = {};
      (rows || []).forEach(r => {
        if (!r || !r.sheet_name) return;
        latest[r.sheet_name] = {
          html: r.html_content || '',
          ts: Date.parse(r.updated_at || '') || Date.now()
        };
      });
      lastPullAt = Date.now();
      persistMirror();
      return latest;
    }).catch(e => {
      console.warn('[logbook] cloud read failed:', e);
      return latest;                       // keep whatever we had (local mirror)
    }).finally(() => { pulling = null; });
    return pulling;
  };

  /* upsert ONE sheet row into the log book's original cloud.
     v3.3 FIX ("⚠️ Could not reach the Log Book cloud"): PostgREST needs an
     explicit `?on_conflict=sheet_name` query param for merge-duplicates —
     without it the POST hit the sheet_name unique constraint and returned
     HTTP 409, which surfaced as the "could not reach" error. The write now
     tries POST-upsert first and transparently falls back to PATCH (update
     the existing row) or INSERT (only when the row is truly missing), so a
     stale/blank mirror can never wipe another day's stored rows. */
  const writeJson = (path, method, body, prefer) => {
    const h = lbHeaders();
    if (prefer) h['Prefer'] = prefer;
    return fetch(`${LB_REST}${path}`, { method, headers: h, body: JSON.stringify(body) });
  };

  const upsertSheet = async (name, html) => {
    let res = await writeJson('/log_book_data?on_conflict=sheet_name', 'POST',
      { sheet_name: name, html_content: html },
      'resolution=merge-duplicates,return=minimal');
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      const txt = await res.text().catch(() => '');
      // 409/23505 → conflict target not honoured; 404 → row may be missing.
      // Try a targeted PATCH first (never overwrites other days' data).
      res = await writeJson(`/log_book_data?sheet_name=eq.${encodeURIComponent(name)}`,
        'PATCH', { html_content: html }, 'return=minimal');
      if (!res.ok && res.status !== 204) {
        const txt2 = await res.text().catch(() => '');
        // If nothing was updated (row absent), plain INSERT creates it.
        res = await writeJson('/log_book_data', 'POST',
          { sheet_name: name, html_content: html }, 'return=minimal');
        if (!res.ok && res.status !== 201 && res.status !== 204) {
          const txt3 = await res.text().catch(() => '');
          throw new Error('logbook cloud write HTTP ' + res.status +
            ' ' + (txt3 || txt2 || txt).slice(0, 120));
        }
      }
    }
    latest[name] = { html, ts: Date.now() };
    persistMirror();
    return true;
  };

  /* ---------- value extraction from a sheet's stored row HTML ---------- */
  const tmpHost = document.createElement('div');

  const cellText = td => {
    if (!td) return '';
    const inp = td.querySelector('input');
    if (inp) return inp.value.trim();
    const ta = td.querySelector('textarea');
    if (ta) return ta.value.trim();
    const sel = td.querySelector('select');
    if (sel) return sel.value.trim();
    return (td.textContent || '').trim();
  };

  const parseSheet = name => {
    const entry = latest[name];
    if (!entry || !entry.html) return [];
    tmpHost.innerHTML = '<table>' + entry.html + '</table>';
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

  const keyToDate = key => {
    if (!key) return null;
    const p = key.split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };

  const fmtLBDate = key => {
    const d = keyToDate(key);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  /* read a DD/MM/YYYY triple from a list of exactly three inputs */
  const keyFromTriple = ins => {
    if (!ins || ins.length !== 3) return null;
    const d = parseInt(ins[0].value, 10);
    const m = parseInt(ins[1].value, 10);
    const y = parseInt(ins[2].value, 10);
    if (!(d >= 1 && d <= 31) || !(m >= 1 && m <= 12) || !(y > 1990 && y < 3000)) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };

  /* read the exact Article 2.1 "Date of scene" pill's key (authoritative) */
  const row21Pill = page => {
    try {
      for (const tr of $$('tr', page)) {
        const th = tr.firstElementChild;
        if (!th || !/2\.1\s*Date of scene/i.test(th.textContent || '')) continue;
        const td = tr.children[1];
        if (!td) continue;
        return td.querySelector('.datetime-group');
      }
    } catch { /* ignore */ }
    return null;
  };

  const dayDateKeyFrom21 = page => {
    const g = row21Pill(page);
    return g ? keyFromTriple(Array.from(g.querySelectorAll('input'))) : null;
  };

  const dayDateKey = page => {
    /* v3.2 FIX ("⚠️ Set the day's date (Article 2.1) first." even though
       2.1 shows the same day): the old order trusted the affidavit's
       "Date of execution" pill FIRST. That pill is frequently EMPTY (or
       carries only a stale partial value), and the fallback scanned every
       .datetime-group in DOM order — which can pick up a signature/debrief
       date instead of Article 2.1. Now Article 2.1 "Date of scene" is the
       AUTHORITATIVE source (it always matches the day), the exec pill is
       only a secondary candidate, and the day heading is the last resort. */
    try {
      /* 1 · exact "2.1 Date of scene" table row */
      const rows = $$('tr', page);
      for (const tr of rows) {
        const th = tr.firstElementChild;
        if (!th || !/2\.1\s*Date of scene/i.test(th.textContent || '')) continue;
        const td = tr.children[1];
        if (!td) continue;
        const g = td.querySelector('.datetime-group');
        if (!g) continue;
        const k = keyFromTriple(Array.from(g.querySelectorAll('input')));
        if (k) return k;
        break;
      }
    } catch { /* fall through */ }
    try {
      /* 2 · affidavit "Date of execution" pill (same day by design) */
      const line = page.querySelector('.exec-line');
      if (line) {
        const g = line.querySelector('.datetime-group:not(.time-group)');
        const k = g && keyFromTriple(Array.from(g.querySelectorAll('input')));
        if (k) return k;
      }
    } catch { /* fall through */ }
    try {
      /* 3 · any complete DD/MM/YYYY pill on the day page */
      for (const g of $$('.datetime-group', page)) {
        if (g.classList.contains('time-group')) continue;
        const k = keyFromTriple(Array.from(g.querySelectorAll('input')));
        if (k) return k;
      }
    } catch { /* fall through */ }
    /* 4 · fallback: any date-looking text inside the day's heading
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

  /* ---------- pre-scene form builder ------------------------------------- */
  const selHTML = (list, val) => {
    let h = '<select><option value="">Select…</option>';
    OPTS[list].forEach(o => { h += `<option value="${escH(o)}"${String(o) === String(val) ? ' selected' : ''}>${escH(o)}</option>`; });
    return h + '</select>';
  };

  const fldHTML = f => {
    const ctrl = f.k === 'sel'
      ? `<span class="lb-fld-ctl">${selHTML(f.list, '')}</span>`
      : `<span class="lb-fld-ctl"><input type="text" placeholder="${escH(f.ph || '')}"></span>`;
    return `<label class="lb-fld" data-sheet="${f.sheet}" data-col="${f.col}" data-kind="${f.k}">${escH(f.label)}${ctrl}</label>`;
  };

  /* v3.2: every sheet group also carries its own Date column (col 0),
     shown read-only and auto-synced from Article 2.1 / the day's date —
     "the same as 2.1 Date of scene — the same as the same day". */
  const dateFldHTML = sheetName =>
    `<label class="lb-fld lb-fld-date" data-sheet="${sheetName}" data-col="0" data-kind="date">📅 Date (from 2.1)` +
    `<span class="lb-fld-ctl"><input type="text" readonly tabindex="-1" placeholder="set the day's date first"></span></label>`;

  const groupHTML = sheetName => {
    const fs = FIELDS.filter(f => f.sheet === sheetName);
    if (!fs.length) return '';
    return `<fieldset class="lb-group"><legend>${SHEET_LABEL[sheetName] || sheetName}</legend>` +
      dateFldHTML(sheetName) + fs.map(fldHTML).join('') + '</fieldset>';
  };

  const FORM_SHEETS = ['dailyBody','sceneBody','toyBody','bonusBody','dominantBody','debriefBody','dailyFeedbackBody','dominantFeedbackBody'];

  /* v3: the form is a BLOCK of the Pre-Scene Execution Affidavit itself —
     no collapsing box; every column of every log book sheet is visible. */
  const formHTML = () => `
    <h4 class="lb-aff-title">📔 BDSM Log Book — Pre-Scene entries <span class="lb-aff-daytag"></span></h4>
    <p class="lb-form-note muted">Every column of the Log Book (${FORM_SHEETS.length} sheets below) is filled right here in the affidavit.
      Press 📤 and the row for this day is pushed into <strong>bdsmlogbook.vercel.app</strong>’s
      original Supabase cloud (table <code>log_book_data</code>) — it appears on the Log Book site too,
      and nowhere else. This contract does not keep its own copy.</p>
    <div class="lb-form-grid">
      ${FORM_SHEETS.map(groupHTML).join('')}
    </div>
    <div class="lb-form-actions">
      <button class="btn btn-primary lb-push-btn" type="button">📤 Send to Log Book cloud</button>
      <span class="lb-saved-note muted"></span>
    </div>`;

  /* ---------- collect values from a form ---------------------------------- */
  const formValues = form => {
    const out = {};                       // sheet -> {col -> value}
    $$('label.lb-fld[data-sheet]', form).forEach(lab => {
      const ctl = ctlOf(lab);
      const val = ((ctl && ctl.value) || '').trim();
      if (!val) return;
      const sh = lab.dataset.sheet, col = Number(lab.dataset.col);
      (out[sh] = out[sh] || {})[col] = val;
    });
    return out;
  };

  /* ---------- build + merge a row into a sheet's stored HTML --------------
     Keeps every existing row EXCEPT ones matching the same date key or the
     same __dhn marker (our previous push for this day) — then appends ours.
     v3: rows are built at the FULL width of the sheet (SHEET_WIDTH), so
     every log book column has a cell even when left blank. */
  const buildRow = (sheetName, dateKey, vals) => {
    const cols = FIELDS.filter(f => f.sheet === sheetName);
    const maxCol = Math.max(SHEET_WIDTH[sheetName] || 0, ...cols.map(c => c.col));
    /* v3.2: the Date cell shows the day's date in the SAME format the Log
       Book site itself uses ("Oct 09, 2026") — and it always equals
       Article 2.1 / the affidavit execution date of this day. */
    let html = `<tr data-lb="__dhn:${dateKey}"><td><input type="text" value="${escH(fmtLBDate(dateKey))}" title="Same as Article 2.1 Date of scene"></td>`;
    for (let c = 1; c <= maxCol; c++) {
      const f = cols.find(x => x.col === c);
      const v = (vals && vals[c]) || '';
      if (f && f.k === 'sel') {
        let inner = '<select><option value=""></option>';
        OPTS[f.list].forEach(o => { inner += `<option value="${escH(o)}"${String(o) === String(v) ? ' selected' : ''}>${escH(o)}</option>`; });
        inner += '</select>';
        html += `<td>${inner}</td>`;
      } else {
        html += `<td><input type="text" value="${escH(v)}"></td>`;
      }
    }
    return html + '</tr>';
  };

  const mergeSheetHtml = (storedHtml, dateKey, newRowHtml) => {
    const src = String(storedHtml || '');
    const rows = [];
    const re = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
    let m, lastEnd = 0;
    while ((m = re.exec(src))) {
      const before = src.slice(lastEnd, m.index);
      if (before.trim()) rows.push({ frag: before, raw: true });
      rows.push({ frag: m[0], raw: false });
      lastEnd = m.index + m[0].length;
    }
    const tail = src.slice(lastEnd);
    const marker = '__dhn:' + dateKey;
    const kept = rows.filter(r => {
      if (r.raw) return true;
      if (r.frag.indexOf(marker) !== -1) return false;         // replace our own earlier push
      const dm = /<td[^>]*>\s*<input[^>]*value="([^"]*)"/i.exec(r.frag);
      if (dm && toKey(dm[1]) === dateKey) return false;        // one row per day, newest wins
      return true;
    });
    return kept.map(r => r.frag).join('\n') + '\n' + newRowHtml + (tail || '');
  };

  /* ---------- push a day's form into the log book's original cloud -------- */
  const pushDay = async (form) => {
    const page = form.closest('.page');
    const noteEl = form.querySelector('.lb-saved-note');
    const btn = form.querySelector('.lb-push-btn');
    /* v3.2: refresh the date mirror one last time — if 2.1 or the exec pill
       carries a complete date, the day is keyed automatically */
    syncDayDates(page);
    let key = dayDateKey(page);
    if (!key) {
      /* last resort: parse the read-only Date field shown in the form */
      const dFld = form.querySelector('label[data-kind="date"] .lb-fld-ctl input');
      if (dFld && dFld.value.trim()) key = toKey(dFld.value.trim());
    }
    if (!key) {
      if (noteEl) noteEl.textContent = '⚠️ Set the day’s date (Article 2.1) first.';
      return false;
    }
    const vals = formValues(form);
    const sheets = Object.keys(vals);
    if (!sheets.length) {
      if (noteEl) noteEl.textContent = 'Nothing filled in yet — complete at least one field.';
      return false;
    }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending…'; }
    if (noteEl) noteEl.textContent = 'Sending to the Log Book cloud…';
    try {
      /* fresh read first so we merge against the newest stored HTML */
      await pullLogBook(true);
      for (const sh of sheets) {
        const rowHtml = buildRow(sh, key, vals[sh]);
        const merged = mergeSheetHtml((latest[sh] || {}).html, key, rowHtml);
        await upsertSheet(sh, merged);
      }
      if (noteEl) noteEl.textContent = `✅ Saved to the Log Book cloud (${fmtLBDate(key)}) — visible on bdsmlogbook.vercel.app`;
      form.dataset.lbDirty = '';
      sync(true);                          // refresh feeds/header from the cloud
      try { window.dhToast && window.dhToast('📔 Sent to the BDSM Log Book cloud ✓'); } catch { /* ignore */ }
      return true;
    } catch (e) {
      console.warn('[logbook] push failed:', e);
      if (noteEl) noteEl.textContent = '⚠️ Could not reach the Log Book cloud — check connection & retry.';
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📤 Send to Log Book cloud'; }
    }
  };

  /* ---------- date sync: Article 2.1 ⇄ affidavit exec pill ⇄ form --------
     v3.2: "the same as 2.1 Date of scene — the same as the same day".
     The day's log book row is keyed by Article 2.1; the affidavit's
     "Date of execution" line always mirrors it, and both are pushed into
     every Log Book sheet's Date column automatically — so filling one
     place fills them all, and 📤 never complains about a missing date. */
  const setPillFromKey = (g, key) => {
    if (!g || !key) return;
    const ins = Array.from(g.querySelectorAll('input'));
    if (ins.length !== 3) return;
    const p = key.split('-');                          // YYYY MM DD
    ins[0].value = String(parseInt(p[2], 10));         // DD
    ins[1].value = String(parseInt(p[1], 10));         // MM
    ins[2].value = p[0];                               // YYYY
  };

  const syncDayDates = page => {
    if (!page) return;
    try {
      const key = dayDateKey(page);                    // 2.1 wins, then exec pill, then heading
      if (!key) return;
      /* mirror into the affidavit "Date of execution" pill when empty */
      const line = page.querySelector('.exec-line');
      if (line) {
        const g = line.querySelector('.datetime-group:not(.time-group)');
        if (g) {
          const ins = Array.from(g.querySelectorAll('input'));
          if (ins.length === 3 && ins.every(i => !i.value.trim())) setPillFromKey(g, key);
        }
      }
      /* show the day's date in the log book form header tag */
      const tag = page.querySelector('.lb-aff-title .lb-aff-daytag');
      if (tag) tag.textContent = '· ' + ((page.querySelector('.page-head h2')?.textContent || '').split('—')[0].trim() || page.id)
        + ' · ' + fmtLBDate(key);
      /* auto-fill every sheet's Date cell in the form (read-only, synced) */
      $$('label.lb-fld[data-kind="date"]', page).forEach(lab => {
        const ctl = ctlOf(lab);
        if (ctl) { ctl.value = fmtLBDate(key); ctl.placeholder = key || 'set the date first'; }
      });
    } catch { /* never break the page over the mirror */ }
  };

  /* ---------- render the per-day feed ------------------------------------ */
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
          `<span class="lb-feed-empty muted">No ${key ? 'entries dated ' + escH(key) : 'matching'} entries yet — fill the pre-scene form below (or write in the Log Book) and it appears here.</span>` +
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
    el.title = 'The Log Book keeps its own Supabase cloud (table log_book_data). The pre-scene forms in this contract push their entries into that original cloud — the same place the Log Book site itself saves.';
  };

  const refreshAll = () => {
    renderDayFeeds();
    renderHeaderInfo();
  };

  const sync = (force) => pullLogBook(force).then(refreshAll);

  /* ---------- wire every "open-logbook" trigger + forms ------------------- */
  const wireButtons = (root) => {
    $$('[data-open-logbook]', root || document).forEach(btn => {
      if (btn.dataset.lbWired) return;
      btn.dataset.lbWired = '1';
      btn.addEventListener('click', e => { e.preventDefault(); openLogBook(); });
    });
  };

  /* v3: pre-fill the form from this day's affidavit data — every column of
     every log book sheet gets a value derived from what the couple already
     wrote in the Day page / Pre-Scene Execution Affidavit. The user can
     still tweak anything before pressing 📤. */
  const num2 = s => String(s == null ? '' : s).replace(/[^0-9]/g, '').slice(0, 2);
  const score10 = v => { const n = parseInt(v, 10); return (!isNaN(n) && n >= 1 && n <= 10) ? String(n) : ''; };

  const fillFormFromAffidavit = (page, form) => {
    try {
      const set = (sheet, col, val) => {
        if (val == null || val === '') return;
        const lab = form.querySelector(`label.lb-fld[data-sheet="${sheet}"][data-col="${col}"]`);
        if (!lab) return;
        const ctl = ctlOf(lab);
        if (!ctl) return;
        if (ctl.tagName === 'SELECT') {
          const want = String(val).trim().toLowerCase();
          Array.from(ctl.options).forEach(o => { if (o.value.toLowerCase() === want) ctl.value = o.value; });
        } else {
          ctl.value = String(val).trim();
        }
      };
      const txt = sel => { const el = page.querySelector(sel); return el ? (el.value != null ? el.value : el.textContent).trim() : ''; };

      /* Article 7 special requests */
      const art7 = Array.from(page.querySelectorAll('h3.section-title'))
        .find(h => /Article\s*7/i.test(h.textContent));
      let subReq = '', domReq = '';
      if (art7) {
        let el = art7.nextElementSibling;
        while (el && el.tagName !== 'H3') {
          const strong = el.querySelector && el.querySelector('strong');
          if (strong) {
            const inp = el.querySelector('input');
            const v = inp ? inp.value.trim() : '';
            if (/Submissive/i.test(strong.textContent)) subReq = subReq || v;
            if (/Dominant/i.test(strong.textContent))   domReq = domReq || v;
          }
          el = el.nextElementSibling;
        }
      }

      /* debrief grid cells by their label text */
      const debriefVal = re => {
        for (const cell of page.querySelectorAll('.debrief-grid > div')) {
          const lab = cell.querySelector('label:not(.yn)');
          if (lab && re.test(lab.textContent)) {
            const yn = Array.from(cell.querySelectorAll('label.yn')).find(l => l.querySelector('input') && l.querySelector('input').checked);
            const parts = [];
            if (yn) parts.push(yn.textContent.trim());
            cell.querySelectorAll('input:not([type="checkbox"])').forEach(i => { if (i.value.trim()) parts.push(i.value.trim()); });
            const ta = cell.querySelector('textarea');
            if (ta && ta.value.trim()) parts.push(ta.value.trim());
            return parts.join(' · ');
          }
        }
        return '';
      };

      /* Article 2 duration guess from the time pill on the exec line */
      const execLine = page.querySelector('.exec-line');
      let dur = '';
      if (execLine) {
        const tg = execLine.querySelector('.datetime-group.time-group');
        if (tg) {
          const ins = Array.from(tg.querySelectorAll('input')).map(i => i.value.trim()).filter(Boolean);
          if (ins.length) dur = ins.join(':');
        }
      }

      /* v3.2: Article 2.1 "Date of scene" is authoritative for the day —
       * when it is still empty but the affidavit's "Date of execution"
       * pill carries a complete DD/MM/YYYY, mirror it INTO 2.1 so both
       * show the same day and 📤 never says "Set the day's date first". */
      try {
        if (!dayDateKeyFrom21(page) && dur !== null) {
          const line2 = execLine;
          if (line2) {
            const g2 = line2.querySelector('.datetime-group:not(.time-group)');
            const k2 = g2 && keyFromTriple(Array.from(g2.querySelectorAll('input')));
            if (k2) {
              const row21 = $$('tr', page).find(tr => tr.firstElementChild && /2\.1\s*Date of scene/i.test(tr.firstElementChild.textContent || ''));
              const td21 = row21 && row21.children[1];
              const pill21 = td21 && td21.querySelector('.datetime-group');
              if (pill21 && Array.from(pill21.querySelectorAll('input')).every(i => !i.value.trim())) {
                setPillFromKey(pill21, k2);
                try { window.dhWriteStore && window.dhWriteStore(); } catch { /* autosave will pick it up anyway */ }
              }
            }
          }
        }
      } catch { /* mirror is best-effort */ }

      /* toy table rows → Toys-used cell */
      let toysUsed = '';
      const toyTable = page.querySelector('.toy-table');
      if (toyTable) {
        toysUsed = Array.from(toyTable.querySelectorAll('tr')).slice(1)
          .map(tr => { const td = tr.querySelector('td'); return td ? td.textContent.trim() : ''; })
          .filter(Boolean).join(', ');
      }

      const lead = txt('.day-badge');
      /* --- Daily sheet --- */
      set('dailyBody', 4, subReq || debriefVal(/adjustment/i) || '');
      set('dailyBody', 5, domReq || '');
      /* --- Scene sheet --- */
      set('sceneBody', 1, dur);
      const preambleEl = Array.from(page.querySelectorAll('h3.section-title'))
        .find(h => /Article\s*1/i.test(h.textContent));
      const preambleTxt = preambleEl && preambleEl.nextElementSibling
        ? (preambleEl.nextElementSibling.textContent || '').trim() : '';
      set('sceneBody', 2, preambleTxt.slice(0, 180));
      set('sceneBody', 6, lead ? ('Day contract drafted in-app · ' + lead.replace(/\s+·\s+/g, ' / ')) : '');
      /* --- Debrief sheet --- */
      const swCell = debriefVal(/safeword used/i);
      const swMatch = /(RED|YELLOW|GREEN)/i.exec(swCell);
      set('debriefBody', 2, debriefVal(/adjustment/i));
      set('debriefBody', 3, swMatch ? swMatch[1].replace(/^./, c => c.toUpperCase()) : (swCell ? 'Yes' : ''));
      set('debriefBody', 4, debriefVal(/adjustments for next/i));
      set('debriefBody', 6, score10(debriefVal(/overall satisfaction/i)));
      set('debriefBody', 7, debriefVal(/debrief notes/i));
      /* --- Toy sheet --- */
      set('toyBody', 1, toysUsed);
      set('toyBody', 4, debriefVal(/aftercare effectiveness/i) ? ('Aftercare effectiveness ' + debriefVal(/aftercare effectiveness/i) + '/10') : '');
      /* --- Dominant journal --- */
      set('dominantBody', 5, debriefVal(/overall satisfaction/i) ? ('Session rated ' + debriefVal(/overall satisfaction/i) + '/10') : '');
    } catch (e) { console.warn('[logbook] affidavit prefill skipped:', e); }
  };

  const wireForms = (root) => {
    $$('.lb-form', root || document).forEach(form => {
      if (form.dataset.lbFormWired) return;
      form.dataset.lbFormWired = '1';
      form.innerHTML = formHTML();
      const page = form.closest('.page');
      if (page) {
        const tag = form.querySelector('.lb-aff-daytag');
        if (tag) tag.textContent = '· ' + ((page.querySelector('.page-head h2')?.textContent || '').split('—')[0].trim() || page.id);
        fillFormFromAffidavit(page, form);
        syncDayDates(page);                       // v3.2: date fields show the day's date
      }
      form.addEventListener('submit', e => { e.preventDefault(); pushDay(form); });
      form.addEventListener('input',  e => {
        /* v3.2: editing Article 2.1 / exec-date pills bubbles up to the day
           page (capture listener below) — keep every Date display in the
           form in lock-step with the day */
        const t = e.target;
        if (t && t.closest && t.closest('.datetime-group') && !t.closest('.lb-form')) syncDayDates(form.closest('.page'));
        form.dataset.lbDirty = '1';
      });
      form.addEventListener('change', () => { form.dataset.lbDirty = '1'; });
      const btn = form.querySelector('.lb-push-btn');
      if (btn) btn.addEventListener('click', () => pushDay(form));
    });
  };

  /* ---------- locate the day's "Pre-Scene Execution Affidavit" block ------ */
  const findAffidavitAnchor = page => {
    const heads = $$('h3,h4,.section-title', page);
    return heads.find(h => /pre-scene execution affidavit/i.test(h.textContent)) || null;
  };

  /* every section title inside a day page, in document order */
  const sectionTitles = page => $$('h3.section-title', page);

  /* insert `node` after the last element of the affidavit block — i.e. just
     before the first heading that is NOT part of the affidavit (the debrief
     h4 and signature rows stay inside it). */
  const insertAtAffidavitEnd = (page, anchor, node) => {
    const all = sectionTitles(page);
    const idx = all.indexOf(anchor);
    let stop = null;
    for (let i = idx + 1; i < all.length; i++) {
      if (!/scene debrief/i.test(all[i].textContent)) { stop = all[i]; break; }
    }
    if (stop) stop.before(node); else page.append(node);
  };

  /* ---------- inject the per-day feed slot + pre-scene form -------------- */
  const ensureFeedSlots = () => {
    $$('.page').filter(p => /^day\d+$/.test(p.id)).forEach(page => {
      const anchor = findAffidavitAnchor(page);
      if (anchor) {
        /* v3 cleanup: remove any stale log book nodes from previous builds
           (Article-2 details box, old feed slot) — they are re-created
           inside the Pre-Scene Execution Affidavit below. */
        page.querySelectorAll('.lb-form').forEach(f => f.remove());
        const oldFeed = page.querySelector('.logbook-feed');
        if (oldFeed && oldFeed.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) oldFeed.remove();

        /* the full-column log book form lives INSIDE the affidavit block */
        const form = document.createElement('form');
        form.className = 'lb-form';
        insertAtAffidavitEnd(page, anchor, form);

        /* live cloud feed sits right above the affidavit heading */
        if (!page.querySelector('.logbook-feed')) {
          const slot = document.createElement('div');
          slot.className = 'logbook-feed';
          anchor.before(slot);
        }
      } else {
        /* legacy page without an affidavit — keep the old placement so the
           integration still exists somewhere on the day */
        if (!page.querySelector('.logbook-feed')) {
          const slot = document.createElement('div');
          slot.className = 'logbook-feed';
          const tools = page.querySelector('.day-finished');
          if (tools && tools.parentNode === page) tools.after(slot);
          else {
            const head = page.querySelector('.page-head');
            if (head) head.after(slot); else page.prepend(slot);
          }
        }
        if (!page.querySelector('.lb-form')) {
          const form = document.createElement('form');
          form.className = 'lb-form';
          const tables = $$('table', page);
          const t21 = tables.find(t => /2\.1\s*Date of scene/i.test(t.textContent));
          if (t21) t21.after(form);
          else {
            const feed = page.querySelector('.logbook-feed');
            if (feed) feed.after(form); else page.append(form);
          }
        }
      }
    });
  };

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

    const openExternally = () => {
      try { window.open(LB_URL, '_blank', 'noopener'); } catch { location.href = LB_URL; }
    };

    v.querySelector('.lb-viewer-close').addEventListener('click', closeViewer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !v.classList.contains('hidden')) closeViewer();
    });
    v.querySelector('.lb-viewer-open').addEventListener('click', () => closeViewer());

    v._openFrame = () => {
      blocked.classList.add('hidden');
      frame.src = LB_URL + '#from-contract';
      setTimeout(() => {
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

  /* ---------- boot ---------- */
  const start = () => {
    ensureFeedSlots();
    wireForms();
    wireButtons();
    refreshAll();
    sync(false);
    /* v3.2: any edit inside a day's DD/MM/YYYY pills (Article 2.1, exec
       date, signature dates) instantly re-syncs the Log Book form's Date
       fields + the empty exec pill — one shared "same day" everywhere. */
    const ds = document.documentElement && document.documentElement.dataset;
    if (ds && !ds.lbDateSyncWired) {
      ds.lbDateSyncWired = '1';
      document.addEventListener('input', e => {
        const t = e.target;
        if (!t || !t.closest) return;
        const g = t.closest('.datetime-group');
        if (!g) return;
        const page = t.closest('.page');
        if (page && /^day\d+$/.test(page.id || '')) syncDayDates(page);
      }, true);
    }
    setInterval(() => { if (document.visibilityState === 'visible') sync(true); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync(true);
    });
  };

  /* ---------- v3.4: email-export snapshot of every Log Book column --------
     Called by app.js (💌 HTML email) for each finished day page. Returns the
     FULL contents of the day's "📔 BDSM Log Book — Pre-Scene entries" form —
     one row per field, carrying EVERY data column of ALL sheets, plus a
     per-sheet summary and the cloud status. Purely local DOM read: nothing
     here touches or duplicates the Log Book's original Supabase cloud. */
  const fieldTitle = lab => {
    /* label text minus the 📅 glyph and minus the <select>/<input> wrapper's
       own text (option lists) — clone so the live form is untouched */
    const c = lab.cloneNode(true);
    const ctl = c.querySelector('.lb-fld-ctl');
    if (ctl) ctl.remove();
    return (c.textContent || '').replace(/📅/g, '').replace(/\s+/g, ' ').trim();
  };

  window.dhLogbookEmailRows = (pageEl) => {
    const rows = [];
    if (!pageEl) return rows;
    const add = (label, value) => {
      value = String(value == null ? '' : value).trim();
      if (value) rows.push({ label, value });
    };

    /* the day's date exactly as 📤 pushes it to the Log Book cloud */
    let key = null;
    try { syncDayDates(pageEl); key = dayDateKey(pageEl); } catch { /* ignore */ }

    const form = pageEl.querySelector('.lb-form');
    if (form) {
      /* every filled field, grouped by sheet, in Date → col order */
      $$('label.lb-fld[data-sheet]', form).forEach(lab => {
        const ctl = ctlOf(lab);
        const val = ((ctl && ctl.value) || '').trim();
        if (!val) return;
        const sh   = lab.dataset.sheet;
        const colN = Number(lab.dataset.col);
        const name = fieldTitle(lab);
        const sheetTitle = SHEET_LABEL[sh] || sh;
        add(`LB · ${sheetTitle} · ${colN === 0 ? 'Date' : name}`, val);
      });

      /* one compact row per sheet so the whole column set is visible at once */
      FORM_SHEETS.forEach(sh => {
        const labs = $$('.lb-group', form)
          .find(g => { const lg = g.querySelector('legend'); return lg && lg.textContent.trim() === (SHEET_LABEL[sh] || sh); });
        if (!labs) return;
        const cells = $$('label.lb-fld[data-sheet]', labs).map(lab => {
          const ctl = ctlOf(lab);
          const v = ((ctl && ctl.value) || '').trim();
          const nm = fieldTitle(lab);
          return `${nm}: ${v || '—'}`;
        });
        if (cells.length) add(`LB sheet · ${SHEET_LABEL[sh] || sh}`, cells.join('  ·  '));
      });
    }

    /* what actually lives in the Log Book cloud for this day (read-only mirror) */
    try {
      if (key) {
        const lbDate = fmtLBDate(key);
        let found = false;
        Object.keys(latest).forEach(sh => {
          const html = (latest[sh] || {}).html || '';
          const own = html.indexOf('__dhn:' + key) !== -1;
          const has = own || (/value="[^"]*"/i.test(html) && new RegExp(escH(lbDate).replace(/[&<>]/g, '') , 'i').test(html));
          if (!has) return;
          found = true;
          add('LB cloud · ' + (SHEET_LABEL[sh] || sh), `Entry dated ${lbDate} present in the Log Book cloud${own ? ' (sent from this affidavit)' : ''}`);
        });
        if (!found) add('LB cloud status', key ? `No entry dated ${lbDate} in the Log Book cloud yet — press 📤 Send to Log Book cloud after filling the pre-scene form` : '');
      }
    } catch { /* snapshot is best-effort */ }

    add('LB link', LB_URL);
    return rows;
  };

  /* hooks so app.js keeps NEW/AI-created days integrated too */
  window.dhLogbookSync = () => { ensureFeedSlots(); wireForms(); wireButtons(); sync(true); };
  window.dhLogbookRefreshDom = () => { ensureFeedSlots(); wireForms(); wireButtons(); refreshAll(); };
  /* called by app.js after 💾 Save: pushes a day's form if it is dirty */
  window.dhLogbookAutoPush = (pageEl) => {
    const form = pageEl && pageEl.querySelector('.lb-form');
    if (form && form.dataset.lbDirty === '1') return pushDay(form);
    return Promise.resolve(false);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
