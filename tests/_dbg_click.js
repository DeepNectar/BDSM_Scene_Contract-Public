const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html', 'utf8');
const configSrc = fs.readFileSync('js/supabase-config.js', 'utf8');
const cloudSrc = fs.readFileSync('js/cloud.js', 'utf8');
const appSrc = fs.readFileSync('js/app.js', 'utf8');
const serverRows = [];
function makeServerClient() {
  return {
    from(table) {
      return {
        select() { return Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }); },
        upsert(row) {
          const i = serverRows.findIndex(r => r.k === row.k);
          if (i >= 0) serverRows[i].v = row.v; else serverRows.push({ k: row.k, v: row.v });
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
}
(async () => {
  const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true; w.alert = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){} }));
  try { w.localStorage.clear(); } catch {}
  w.supabase = { createClient: () => makeServerClient() };
  w.addEventListener('error', e => console.log('WINDOW ERROR:', e.message));
  w.eval(configSrc); w.eval(cloudSrc); w.eval(appSrc);
  await w.CloudStore.ready;
  w.document.querySelector('#password-input').value = 'Deepnectar@1612@';
  w.document.querySelector('#login-btn').click();
  await new Promise(r=>setTimeout(r,400));
  console.log('pages after login:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  let btn = Array.from(w.document.querySelectorAll('button')).find(b => /Add blank day/i.test(b.textContent));
  console.log('btn found in real DOM?', !!btn, btn && btn.id);
  if (!btn) {
    const host = w.document.createElement('div');
    host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
    w.document.body.appendChild(host);
    btn = w.document.getElementById('empty-blank-btn');
  }
  btn.click();
  await new Promise(r=>setTimeout(r,300));
  console.log('pages after click:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  console.log('day2 exists?', !!w.document.getElementById('day2'));
})().catch(e=>console.log('FATAL', e.stack));
