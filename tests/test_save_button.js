/* v3.9 DH — verifies the 💾 Save button fix:
   1. saveFields/saveAccepts/saveDays never reject, even when the network throws
      (the old code returned a raw rejected promise → unhandled rejection → dead button)
   2. failed writes are retried automatically
   3. awaitFlush() resolves only after ALL queued writes have really landed
   4. clicking #save-contract pushes fields + accepts + days to the server and
      shows the success toast with the ⏳ Saving… → 💾 Save button cycle */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.confirm = () => true;
window.alert = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){} }));

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const FIELD_KEY = 'head>0.6.1.0.0';
const serverRows = [
  { k: 'fields',  v: { [FIELD_KEY]: 'affidavit-value' } },
  { k: 'accepts', v: {} },
  { k: 'days',    v: [] },
  { k: 'wiped',   v: { flag: false } },
];
let failNextUpsert = 0;          // simulate N transient network failures
let upsertCalls = 0;

window.supabase = {
  createClient(url, key) {
    return {
      from(table) {
        return {
          select() { return Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }); },
          upsert(row) {
            upsertCalls++;
            if (failNextUpsert > 0) { failNextUpsert--; return Promise.reject(new TypeError('Failed to fetch')); }
            const i = serverRows.findIndex(r => r.k === row.k);
            if (i >= 0) serverRows[i].v = row.v; else serverRows.push({ k: row.k, v: row.v });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
};

window.eval(fs.readFileSync('js/supabase-config.js', 'utf8'));
window.eval(fs.readFileSync('js/cloud.js', 'utf8'));

(async () => {
  await window.CloudStore.ready;

  /* 1 · rejecting save must NOT throw at the caller */
  failNextUpsert = 1;                       // first attempt fails, retry succeeds
  const okRetry = await window.CloudStore.saveFields({ hello: 'cloud' });
  console.log('transient failure retried → save resolved true:', okRetry === true);
  console.log('retry actually landed on server:', serverRows.find(r => r.k === 'fields').v.hello === 'cloud');

  /* 2 · permanent failure resolves false (never rejects) */
  failNextUpsert = 5;
  const okFail = await window.CloudStore.saveFields({ nope: 1 });
  console.log('hard failure resolves false (no unhandled rejection):', okFail === false);
  failNextUpsert = 0;

  /* 3 · awaitFlush waits for in-flight writes */
  const p1 = window.CloudStore.saveAccepts({ seal: { Deep: { ts: Date.now() } } });
  const p2 = window.CloudStore.saveDays([{ id: 'day2', html: '<section class="page" id="day2"></section>' }]);
  const flushRes = await window.CloudStore.awaitFlush(8000);
  await Promise.all([p1, p2]);
  console.log('awaitFlush ok:', flushRes.ok === true);
  console.log('accepts on server:', !!serverRows.find(r => r.k === 'accepts').v.seal.Deep);
  console.log('days on server:', serverRows.find(r => r.k === 'days').v.length === 1);

  /* 4 · boot app.js and click the real Save button */
  window.eval(fs.readFileSync('js/app.js', 'utf8'));
  await new Promise(r => setTimeout(r, 300));
  const before = upsertCalls;
  const btn = window.document.getElementById('save-contract');
  btn.click();
  console.log('button showed saving state:', /Saving/.test(btn.textContent) && btn.disabled === true);
  await new Promise(r => setTimeout(r, 3000));   // let the async save finish (incl. a 600 ms retry backoff)
  const toastEl = window.document.getElementById('toast');
  console.log('save pushed to server on click:', upsertCalls > before);
  console.log('success toast shown:', /Saved ✓/.test(toastEl.textContent));
  console.log('button restored:', btn.disabled === false && /Save/.test(btn.textContent));
  console.log('runtime errors:', errors.slice(0, 5));
  console.log('ALL CHECKS DONE');
  process.exit(0);
})().catch(e => { console.log('FATAL:', e.stack); process.exit(1); });
