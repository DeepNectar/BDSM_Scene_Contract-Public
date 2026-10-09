/* v4.5 DH — verifies the BDSM Log Book integration inside the day's
   "Pre-Scene Execution Affidavit":
     1. every day page gets a .lb-form injected INSIDE the affidavit block
        (after the debrief signatures, before the love stamp) with ALL
        columns of ALL 8 log book sheets;
     2. the feed slot sits right above the affidavit heading;
     3. filling fields + pressing 📤 upserts FULL-WIDTH rows into the LOG
        BOOK'S OWN cloud (log_book_data on sjaxgxsvtldcgvunzeye), merging
        with existing stored html and never touching contract_state;
     4. one row per day: pushing twice replaces our previous __dhn row. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true;
w.alert = () => {};
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

/* ---------- fake the LOG BOOK cloud (supabase project ...zeye) ---------- */
const lbRows = {
  dailyBody:  '<tr><td><input value="Oct 01, 2026"></td><td><select><option>7</option></select></td></tr>',
  sceneBody:  '',
  debriefBody:'<tr><td><input value="Oct 05, 2026"></td></tr>',
  toyBody:'', bonusBody:'', dominantBody:'', dailyFeedbackBody:'', dominantFeedbackBody:'',
  settingsBody:'<p>keep me</p>'
};
let lbUpserts = [];
let contractStateTouched = false;

w.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('sjaxgxsvtldcgvunzeye')) {                    // log book cloud
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      lbUpserts.push(body);
      lbRows[body.sheet_name] = body.html_content;
      return { ok: true, status: 204, text: async () => '' };
    }
    return { ok: true, json: async () => Object.keys(lbRows).map(k => ({ sheet_name: k, html_content: lbRows[k], updated_at: new Date().toISOString() })) };
  }
  if (u.includes('qbnxcfwwsuqfmearyris')) contractStateTouched = true;
  return { ok: true, json: async () => [] };
};
/* keep any env storage; the module reads its own key */

/* create a Day page exactly like app.js builds them (blank day) */
const dmyPill = () => `<span class="datetime-group"><input type="text" inputmode="numeric" maxlength="2" placeholder="DD"><i>/</i><input type="text" inputmode="numeric" maxlength="2" placeholder="MM"><i>/</i><input type="text" inputmode="numeric" maxlength="4" placeholder="YYYY"></span>`;
const ynPair  = (a, b) => `<label class="yn"><input type="checkbox"> ${a}</label><label class="yn"><input type="checkbox"> ${b}</label>`;
const sec = w.document.createElement('section');
sec.className = 'page';
sec.id = 'day7';
sec.innerHTML = `
  <div class="page-head"><h2>Day 7 · Fri, Oct 9, 2026 — Private Bedroom / Play Space</h2></div>
  <h3 class="section-title">Article 2 · Session Parameters</h3>
  <table><tr><th>Clause</th><th>Specification</th></tr><tr><td>2.1 Date of scene</td><td>${dmyPill()}</td></tr></table>
  <h3 class="section-title">Pre-Scene Execution Affidavit — Day 7</h3>
  <p class="exec-line"><strong>Date of execution:</strong> ${dmyPill()} <strong>Time:</strong> <span class="datetime-group time-group"><input type="text" maxlength="2" placeholder="HH"><i>:</i><input type="text" maxlength="2" placeholder="MM"></span></p>
  <h4>Scene Debrief — Day 7 (after scene)</h4>
  <div class="debrief-grid">
    <div><label>Overall satisfaction</label> <input class="inline-input score" placeholder="x/10"></div>
    <div><label>Safeword used?</label> ${ynPair('Yes', 'No')} If yes, which? <input class="inline-input sw" placeholder="RED / YELLOW"></div>
    <div class="full"><label>Debrief notes</label> <textarea class="note-box"></textarea></div>
  </div>
  <div class="sign-row"><div class="sign-field"><label>Honey's signature (debrief)</label><input type="text"></div><div class="sign-field"><label>Date</label>${dmyPill()}</div></div>
  <div class="love-stamp"><img src="img/love-stamp.png" alt="stamp"></div>`;
w.document.querySelector('#main-contract') ? w.document.querySelector('#main-contract').appendChild(sec) : w.document.body.appendChild(sec);

/* load the log book module (it self-boots) */
w.eval(fs.readFileSync('js/logbook.js', 'utf8'));

const results = [];
const check = (name, cond) => results.push([name, !!cond]);
const $ = s => sec.querySelector(s);

setTimeout(() => {
  /* 1 · form is INSIDE the affidavit, not under Article 2 */
  const form = $('.lb-form');
  check('form injected in the day page', !!form);
  const affHead = Array.from(sec.querySelectorAll('h3')).find(h => /pre-scene execution affidavit/i.test(h.textContent));
  const stamp = $('.love-stamp');
  const pos = form && affHead ? (affHead.compareDocumentPosition(form) & w.Node.DOCUMENT_POSITION_FOLLOWING) : 0;
  const beforeStamp = form && stamp ? (form.compareDocumentPosition(stamp) & w.Node.DOCUMENT_POSITION_FOLLOWING) : 0;
  check('form sits AFTER the affidavit heading', !!pos);
  check('form sits BEFORE the love stamp (inside affidavit)', !!beforeStamp);

  /* 2 · all 8 sheets × every column present */
  const sheets = new Set(Array.from(form.querySelectorAll('label.lb-fld')).map(l => l.dataset.sheet));
  check('all 8 log book sheets present', sheets.size === 8);
  const dailyCols = Array.from(form.querySelectorAll('label[data-sheet="dailyBody"]'));
  check('daily sheet exposes every data column (6)', dailyCols.length === 6);
  const sceneCols = Array.from(form.querySelectorAll('label[data-sheet="sceneBody"]')).length;
  check('scene sheet exposes every data column (7)', sceneCols === 7);

  /* 3 · feed slot directly above the affidavit heading */
  const feed = $('.logbook-feed');
  check('feed slot right above affidavit heading', !!feed && feed.nextElementSibling === affHead);

  /* 4 · push: fill exec date + one field per a few sheets */
  const [dd, mm, yy] = $('.exec-line').querySelectorAll('.datetime-group input');
  dd.value = '9'; mm.value = '10'; yy.value = '2026';
  const setF = (sheet, col, val) => {
    const lab = form.querySelector(`label[data-sheet="${sheet}"][data-col="${col}"]`);
    const ctl = lab.querySelector('.lb-fld-ctl > *');
    ctl.value = val;
    ctl.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  setF('dailyBody', 1, '8');
  setF('dailyBody', 4, 'Cuddles after');
  setF('sceneBody', 2, 'Bondage + massage');
  setF('debriefBody', 7, 'Loved every minute');

  form.querySelector('.lb-push-btn').click();

  setTimeout(() => {
    check('upserts reached the LOG BOOK cloud only', lbUpserts.length >= 3 && !contractStateTouched);
    const daily = lbUpserts.find(u => u.sheet_name === 'dailyBody');
    check('daily row full width (7 tds incl. Date)', daily && (daily.html_content.match(/<td/g) || []).filter((_, i, a) => true).length >= 7 && /__dhn:2026-10-09/.test(daily.html_content));
    check('existing other-day rows preserved', /Oct 01, 2026/.test(lbRows.dailyBody));
    check('date cell uses the affidavit exec date', /value="Oct 09, 2026"/.test(daily ? daily.html_content : ''));

    /* second push must REPLACE our row (one row per day) */
    lbUpserts = [];
    setF('dailyBody', 5, 'More tea tomorrow');
    form.querySelector('.lb-push-btn').click();
    setTimeout(() => {
      const ours = (lbRows.dailyBody.match(/__dhn:2026-10-09/g) || []).length;
      check('re-push keeps exactly ONE row for the day', ours === 1);
      let pass = 0;
      results.forEach(([n, ok]) => { console.log((ok ? '✅' : '❌') + ' ' + n); if (ok) pass++; });
      console.log(`\n${pass}/${results.length} checks passed`);
      process.exit(pass === results.length ? 0 : 1);
    }, 300);
  }, 400);
}, 300);
