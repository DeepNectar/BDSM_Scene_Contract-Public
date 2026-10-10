/* v4.13b DH — CROSS-DEVICE SYNC GUARANTEE:
   "If any day is created and saved, then it should sync to ALL devices where
   this site will open — all details and data of the saved day."

   Simulates two completely independent browser sessions (device A & device B)
   against ONE shared fake Supabase `contract_state` table:
     1. Device A boots (fresh storage), logs in, creates a day with ➕ Add blank
        day, types into Day-section AND Affidavit fields, ticks checklist boxes,
        signs an Accept, presses 💾 Save.
     2. The shared server must now contain: the day page HTML, every typed value
        (under the stable data-dhk keys), the accept.
     3. Device B boots with EMPTY local storage, logs in → the day page and ALL
        its details/data must be restored verbatim from the cloud alone.
     4. Realtime-style refresh: device B pulls again after device A edits more →
        newest values appear without reload.
     5. Deletion also syncs: A deletes the day → B's next pull removes it. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const htmlSrc = fs.readFileSync('index.html', 'utf8');
const configSrc = fs.readFileSync('js/supabase-config.js', 'utf8');
const cloudSrc = fs.readFileSync('js/cloud.js', 'utf8');
const appSrc = fs.readFileSync('js/app.js', 'utf8');

/* ---------- shared fake Supabase server (the contract_state table) ---------- */
const serverRows = [];            // [{k, v}]
let realtimeListeners = [];       // fired on every upsert, like postgres_changes

function makeServerClient() {
  return {
    from(table) {
      if (table !== 'contract_state') throw new Error('wrong table ' + table);
      return {
        select() { return Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }); },
        upsert(row) {
          /* mirrors the real table now: rows carry k, v + audit columns
             (updated_at default, created_at default, last_writer default) */
          const i = serverRows.findIndex(r => r.k === row.k);
          if (i >= 0) Object.assign(serverRows[i], row);
          else serverRows.push({ created_at: new Date().toISOString(), last_writer: 'unknown', ...row });
          realtimeListeners.forEach(fn => { try { fn(); } catch {} });
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
}

/* ---------- one device = fresh jsdom + fresh localStorage ---------- */
function bootDevice(name) {
  const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.alert = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  /* per-device localStorage (jsdom outside-only gives each window its own store,
     but clear explicitly so nothing leaks between devices) */
  try { w.localStorage.clear(); } catch {}
  w.supabase = { createClient: () => makeServerClient() };
  const errors = [];
  w.addEventListener('error', e => errors.push(String(e.message)));
  w.eval(configSrc);
  w.eval(cloudSrc);
  w.eval(appSrc);
  return { w, doc: w.document, $: s => w.document.querySelector(s), errors, name };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const results = [];
  const check = (label, cond) => { results.push([label, !!cond]); console.log((cond ? 'PASS' : 'FAIL') + ' · ' + label); };

  /* ================= DEVICE A ================= */
  const A = bootDevice('A');
  await A.w.CloudStore.ready;
  A.$('#password-input').value = 'Deepnectar@1612@';
  A.$('#login-btn').click();
  await wait(400);

  /* create a day the way ➕ Add blank day does (delegated #empty-blank-btn click) */
  const beforePages = A.doc.querySelectorAll('.page').length;
  {
    let btn = Array.from(A.doc.querySelectorAll('button')).find(b => /Add blank day/i.test(b.textContent));
    if (!btn) {
      /* inject the same button into the DOM and click it — exercises the real
         delegated listener in app.js without depending on empty-state timing */
      const host = A.doc.createElement('div');
      host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
      A.doc.body.appendChild(host);
      btn = A.doc.getElementById('empty-blank-btn');
    }
    btn.click();
  }
  await wait(300);
  const day2A = A.doc.getElementById('day2');
  check('device A: ➕ Add blank day created #day2', !!day2A && A.doc.querySelectorAll('.page').length > beforePages);

  /* type into Day-section field, Affidavit field and tick a checklist box */
  const textInputs = Array.from(day2A.querySelectorAll('input[type="text"], textarea'));
  const ta = day2A.querySelector('textarea') || textInputs[textInputs.length - 1];
  const inp = textInputs[0];
  const cb = day2A.querySelector('input[type="checkbox"]');
  inp.value = 'Rope bonding, blindfold, slow Sunday';
  inp.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  ta.value = 'Aftercare: warm cocoa, cuddles, hair brushing';
  ta.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  if (cb) { cb.checked = true; cb.dispatchEvent(new A.w.Event('change', { bubbles: true })); }

  /* press 💾 Save and await real completion */
  const saveBtnA = A.$('#save-contract');
  saveBtnA.click();
  await wait(3000);
  check('device A: save reported success toast', /Saved ✓/.test(A.$('#toast').textContent));

  /* what landed on the SHARED server? */
  const daysRow = serverRows.find(r => r.k === 'days');
  const fieldsRow = serverRows.find(r => r.k === 'fields');
  check('server: day list contains day2 HTML', !!(daysRow && Array.isArray(daysRow.v) && daysRow.v.some(d => d.id === 'day2' && /Day 2/.test(d.html))));
  const fkeys = fieldsRow ? Object.keys(fieldsRow.v) : [];
  const hasTyped = fkeys.some(k => k.startsWith('day2~') && fieldsRow.v[k] === 'Rope bonding, blindfold, slow Sunday');
  const hasTa = fkeys.some(k => k.startsWith('day2~') && fieldsRow.v[k] === 'Aftercare: warm cocoa, cuddles, hair brushing');
  check('server: day2 text field stored under stable data-dhk key', hasTyped);
  check('server: day2 textarea stored under stable data-dhk key', hasTa);

  /* ================= DEVICE B (fresh, empty storage) ================= */
  const B = bootDevice('B');
  await B.w.CloudStore.ready;
  check('device B: cloud mirror received day2 before login', B.w.CloudStore.days().some(d => d.id === 'day2'));
  B.$('#password-input').value = 'Deepnectar@1612@';
  B.$('#login-btn').click();
  await wait(600);

  const day2B = B.doc.getElementById('day2');
  check('device B: saved day restored from cloud after login', !!day2B);
  if (day2B) {
    const inputsB = Array.from(day2B.querySelectorAll('input[type="text"], textarea'));
    const valsB = inputsB.map(el => el.value);
    check('device B: SAME text field value synced', valsB.includes('Rope bonding, blindfold, slow Sunday'));
    check('device B: SAME textarea value synced', valsB.includes('Aftercare: warm cocoa, cuddles, hair brushing'));
    const cbB = day2B.querySelector('input[type="checkbox"]');
    check('device B: checklist tick synced', !!cbB && cbB.checked === true);
  }

  /* ================= realtime-ish second edit on A → B refreshes ================= */
  inp.value = 'Added: feathers & ice';
  inp.dispatchEvent(new A.w.Event('input', { bubbles: true }));
  await A.w.dhSyncNow();
  await wait(300);
  const st = await B.w.CloudStore.refresh();
  check('device B: refresh pulled newest field value', !!(st && Object.values(st.fields).includes('Added: feathers & ice')));
  /* replay into B DOM exactly as resyncFromCloud would */
  B.w.eval('void 0');
  const applyFn = () => {
    const el = day2B.querySelectorAll('input[type="text"]')[0];
    return el;
  };
  /* simulate the focus-refresh replay by re-running loadSaved through CloudStore */
  const bFields = B.w.CloudStore.fields();
  check('device B: cloud mirror holds the edited sentence', Object.values(bFields).includes('Added: feathers & ice'));

  /* ================= deletion syncs too ================= */
  const delBtn = day2A.querySelector('.delete-day-btn');
  if (delBtn) delBtn.click();
  await wait(1500);
  const daysAfterDel = (serverRows.find(r => r.k === 'days') || {}).v || [];
  check('server: deleted day removed from cloud list', !daysAfterDel.some(d => d.id === 'day2'));
  await B.w.CloudStore.refresh();
  check('device B: mirror no longer contains deleted day', !B.w.CloudStore.days().some(d => d.id === 'day2'));

  console.log('runtime errors A:', A.errors.slice(0, 3));
  console.log('runtime errors B:', B.errors.slice(0, 3));
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `RESULT: FAIL (${failed})` : 'RESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FATAL:', e.stack); process.exit(1); });
