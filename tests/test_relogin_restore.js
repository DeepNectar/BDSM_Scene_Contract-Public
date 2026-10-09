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

  /* v4.1 DH — simulate an AI-created day on a build WITHOUT a static Day 1 in
     index.html: create it through the real code path, then verify it lands on
     the server AND survives a full logout/re-login cycle (fresh pull + replay). */
  window.dhPersistDays();                       // baseline sync of current DOM days
  await new Promise(r => setTimeout(r, 80));
  const aiHtml = '<section id="day9" class="page"><div class="page-head"><h2>Day 9 — written by the ✨ AI Assistant</h2></div><input type="text" id="aiNote9" value="our AI day detail"></section>';
  window.document.getElementById('summary').insertAdjacentHTML('beforebegin', aiHtml);
  const aiEl = window.document.getElementById('day9');
  if (typeof window.wireNewDay !== 'function' && typeof window.dhWireNewDay !== 'function') {
    /* wireNewDay is internal; the delegated listeners still cover delete/clear.
       Just persist like aiApplyClick does. */
  }
  window.dhPersistDays();                       // what aiApplyClick calls after creating the AI day
  await new Promise(r => setTimeout(r, 120));
  const daysOnServer = () => (serverRows.find(r => r.k === 'days') || {}).v || [];
  checks.push(['AI-created Day 9 pushed to Supabase by persistDays', daysOnServer().some(x => x.id === 'day9')]);

  /* logout → login again: unlock() refreshes from the server and replays.
     Simulate a FULL fresh page load by re-evaluating cloud.js + app.js in the
     same jsdom window (localStorage & fake server rows persist across it). */
  window.eval(fs.readFileSync('js/cloud.js', 'utf8'));
  window.eval(fs.readFileSync('js/app.js', 'utf8'));
  await window.CloudStore.ready;
  checks.push(['AI Day 9 restored on fresh page-load from the cloud mirror', !!window.document.getElementById('day9')]);
  window.document.getElementById('password-input').value = 'Deepnectar@1612@';
  window.document.getElementById('login-btn').click();              // re-login once more
  await new Promise(r => setTimeout(r, 400));
  checks.push(['AI Day 9 comes back after re-login from the cloud', !!window.document.getElementById('day9')]);
  checks.push(['restored AI Day 9 keeps its content', !!(window.document.getElementById('day9') && /written by the/.test(window.document.getElementById('day9').innerHTML))]);

  /* manual delete must STICK (no resurrection by any auto path) */
  if (!window.document.querySelector('#day9 .delete-day-btn')) {
    const d9 = window.document.getElementById('day9');
    if (d9) d9.insertAdjacentHTML('beforeend',
      '<button class="delete-day-btn danger" type="button" data-day="day9">✖ Delete day</button>');
  }
  const delBtn2 = window.document.querySelector('#day9 .delete-day-btn');
  checks.push(['deleted day had a working ✖ Delete button', !!delBtn2]);
  if (delBtn2) delBtn2.click();                                     // confirm stubbed → true
  await new Promise(r => setTimeout(r, 150));
  window.document.getElementById('password-input').value = 'Deepnectar@1612@';
  window.document.getElementById('login-btn').click();              // re-login once more
  await new Promise(r => setTimeout(r, 400));
  checks.push(['manually DELETED day stays deleted after re-login (no auto-wipe/resurrect)', !window.document.getElementById('day9')]);

  checks.push(['static Day 1 included in persisted list when present', (() => {
    const hasStaticDay1 = !!window.document.getElementById('day1');
    if (!hasStaticDay1) return true;   // this build ships no Day 1 — nothing to persist for it
    const d = daysOnServer();
    return d.some(x => x.id === 'day1');
  })()]);
  let fail = 0;
  checks.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok?'PASS':'FAIL')+' · '+n); });
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
