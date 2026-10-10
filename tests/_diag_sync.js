const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html', 'utf8');
const configSrc = fs.readFileSync('js/supabase-config.js', 'utf8');
const cloudSrc = fs.readFileSync('js/cloud.js', 'utf8');
const appSrc = fs.readFileSync('js/app.js', 'utf8');
const serverRows = [];
const deviceClients = [];
function makeServerClient() {
  const myListeners = [];
  const client = {
    _myListeners: myListeners,
    from(table) {
      return {
        select() { return Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }); },
        upsert(row) {
          console.log('[SERVER] upsert', row.k, 'shape=', Array.isArray(row.v) ? ('array[' + row.v.map(d=>d.id).join(',') + ']') : (typeof row.v === 'object' ? Object.keys(row.v).slice(0,5) : String(row.v)));
          const i = serverRows.findIndex(r => r.k === row.k);
          if (i >= 0) Object.assign(serverRows[i], row); else serverRows.push(row);
          deviceClients.forEach(c => { if (c !== client && c._myListeners.length) c._myListeners.forEach(fn => { try { fn(); } catch {} }); });
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() { const ch = { on(ev,c2,cb){ myListeners.push(cb); return ch; }, subscribe(){ return ch; } }; return ch; },
    realtime: {},
  };
  deviceClients.push(client);
  return client;
}
(async () => {
  const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true; w.alert = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));
  w.supabase = { createClient: () => makeServerClient() };
  w.eval(configSrc); w.eval(cloudSrc); w.eval(appSrc);
  await w.CloudStore.ready;
  dom.window.document.querySelector('#password-input').value = 'Deepnectar@1612@';
  dom.window.document.querySelector('#login-btn').click();
  await new Promise(r=>setTimeout(r,400));
  console.log('pages after login:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  let btn = w.document.getElementById('empty-blank-btn') || Array.from(w.document.querySelectorAll('button')).find(b=>/Add blank day/i.test(b.textContent));
  console.log('blank btn found:', !!btn);
  if (!btn) {
    const host = w.document.createElement('div');
    host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
    w.document.body.appendChild(host);
    btn = w.document.getElementById('empty-blank-btn');
  }
  btn.click();
  await new Promise(r=>setTimeout(r,300));
  console.log('pages after click:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  const day = w.document.getElementById('day2') || w.document.getElementById('day1');
  console.log('day element:', day && day.id);
  const inp = day.querySelector('input[type=text]');
  inp.value = 'Rope bonding, blindfold, slow Sunday';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  console.log('inp dhk:', inp.getAttribute('data-dhk'));
  w.document.getElementById('save-contract').click();
  await new Promise(r=>setTimeout(r,3000));
  console.log('toast:', w.document.getElementById('toast').textContent);
  console.log('server keys:', serverRows.map(r=>r.k));
  const f = serverRows.find(r=>r.k==='fields');
  if (f) console.log('field keys sample:', Object.keys(f.v).filter(k=>k.startsWith('day')).slice(0,10));
  process.exit(0);
})().catch(e=>{console.log('FATAL', e.stack); process.exit(1);});
