/* minimal reproduction of bootDevice + blank day creation with tracing */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = '/workspace';
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const configSrc = fs.readFileSync(path.join(root, 'js/supabase-config.js'), 'utf8');
const cloudSrc = fs.readFileSync(path.join(root, 'js/cloud.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const serverRows = [];
let listeners = [];
function makeServerClient() {
  return { from(t){ return { select(){return Promise.resolve({data:JSON.parse(JSON.stringify(serverRows)),error:null})},
    upsert(row){ const i=serverRows.findIndex(r=>r.k===row.k); if(i>=0) Object.assign(serverRows[i],row); else serverRows.push({...row}); listeners.forEach(f=>{try{f()}catch{}}); return Promise.resolve({error:null}); } }; },
    channel(){ return { on(){return this}, subscribe(){return this} } } };
}
const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true; w.alert = () => {};
w.matchMedia = w.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));
try { w.localStorage.clear(); } catch {}
w.supabase = { createClient: () => makeServerClient() };
w.addEventListener('error', e => console.log('WINDOW ERROR:', e.message));
w.eval(configSrc); w.eval(cloudSrc); w.eval(appSrc);
(async () => {
  await w.CloudStore.ready;
  w.document.querySelector('#password-input').value = 'Deepnectar@1612@';
  w.document.querySelector('#login-btn').click();
  await new Promise(r=>setTimeout(r,500));
  console.log('overlay hidden?', w.document.querySelector('#login-overlay').classList.contains('hidden'));
  console.log('pages before:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  console.log('empty banner?', !!w.document.getElementById('days-empty'));
  let btn = w.document.getElementById('empty-blank-btn');
  console.log('banner btn found?', !!btn);
  if (!btn) {
    const host = w.document.createElement('div');
    host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
    w.document.body.appendChild(host);
    btn = w.document.getElementById('empty-blank-btn');
  }
  btn.click();
  await new Promise(r=>setTimeout(r,300));
  console.log('pages after:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
  console.log('day2?', !!w.document.getElementById('day2'));
  console.log('server rows keys:', serverRows.map(r=>r.k));
})();
