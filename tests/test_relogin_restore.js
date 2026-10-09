/* v4.0 DH — verifies: saved days + affidavit fields come back on re-login,
   and the sticky auto-wipe flag no longer blocks restoration. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.confirm = () => true;
window.alert = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));

/* fake server pre-seeded with a saved day + affidavit field + wiped=true row */
const FIELD_KEY = 'head>0.6.1.0.0';
const dayHtml = '<section id="day7" class="page"><h2>Day 7 — saved earlier</h2><input type="text"></section>';
const serverRows = [
  { k: 'fields',  v: { [FIELD_KEY]: 'affidavit value from cloud' } },
  { k: 'accepts', v: {} },
  { k: 'days',    v: [{ id: 'day7', html: dayHtml }] },
  { k: 'wiped',   v: { flag: true } },          // legacy sticky flag — must be IGNORED now
];
window.supabase = {
  createClient() {
    return {
      from(t) {
        return {
          select: () => Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }),
          upsert: (row) => { const i = serverRows.findIndex(r=>r.k===row.k); if (i>=0) serverRows[i].v=row.v; else serverRows.push({k:row.k,v:row.v}); return Promise.resolve({error:null}); },
        };
      },
    };
  },
};
window.eval(fs.readFileSync('js/supabase-config.js','utf8'));
window.eval(fs.readFileSync('js/cloud.js','utf8'));
window.eval(fs.readFileSync('js/app.js','utf8'));

(async () => {
  await window.CloudStore.ready;
  /* simulate login (unlock replays state) */
  window.window.document.getElementById('password-input').value = 'Deepnectar@1612@';
  window.window.document.getElementById('login-btn').click();
  await new Promise(r => setTimeout(r, 400));

  const checks = [];
  checks.push(['legacy wiped flag ignored (days restored anyway)', !!window.window.document.getElementById('day7')]);
  checks.push(['saved Day 7 page present after re-login', !!window.window.document.getElementById('day7')]);
  const firstInput = window.document.querySelector('#main-contract input[type=text]');
  checks.push(['affidavit field value restored from cloud', firstInput && firstInput.value === 'affidavit value from cloud']);
  checks.push(['CloudStore.wiped() neutralised (returns true → never blocks)', window.CloudStore.wiped() === true]);
  checks.push(['static Day 1 included in persisted list after save', await (async()=>{ window.dhPersistDays(); await new Promise(r=>setTimeout(r,100)); const d = serverRows.find(r=>r.k==='days').v; return d.some(x=>x.id==='day1') && d.some(x=>x.id==='day7'); })()]);
  let fail = 0;
  checks.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok?'PASS':'FAIL')+' · '+n); });
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
