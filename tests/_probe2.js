/* temporary diagnostic probe — single-device save path inspection */
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
          console.log('[server] upsert', row.k, Array.isArray(row.v) ? 'array[' + row.v.length + ']' : 'obj{' + Object.keys(row.v || {}).length + '}');
          const i = serverRows.findIndex(r => r.k === row.k);
          if (i >= 0) Object.assign(serverRows[i], row);
          else serverRows.push({ created_at: new Date().toISOString(), last_writer: 'unknown', ...row });
          deviceClients.forEach(c => {
            if (c !== client && c._myListeners.length) c._myListeners.forEach(fn => { try { fn(); } catch (e) { console.log('listener threw', e.message); } });
          });
          return Promise.resolve({ error: null });
        },
      };
    },
    channel() {
      const ch = { on(ev, cfg, cb) { myListeners.push(cb); return ch; }, subscribe() { return ch; } };
      return ch;
    },
    realtime: {},
  };
  deviceClients.push(client);
  return client;
}

(async () => {
  const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;
  w.alert = () => {};
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  w.supabase = { createClient: () => makeServerClient() };
  w.eval(configSrc);
  w.eval(cloudSrc);
  w.eval(appSrc);

  await w.CloudStore.ready;
  w.document.getElementById('password-input').value = 'Deepnectar@1612@';
  w.document.getElementById('login-btn').click();
  await new Promise(r => setTimeout(r, 400));

  let btn = w.document.getElementById('empty-blank-btn')
    || Array.from(w.document.querySelectorAll('button')).find(b => /Add blank day/i.test(b.textContent));
  if (!btn) {
    const host = w.document.createElement('div');
    host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
    w.document.body.appendChild(host);
    btn = w.document.getElementById('empty-blank-btn');
  }
  btn.click();
  await new Promise(r => setTimeout(r, 300));

  const pages = Array.from(w.document.querySelectorAll('.page'));
  console.log('pages:', pages.map(p => p.id).join(','));
  const d2 = w.document.getElementById('day2') || pages[pages.length - 1];
  try {
    const h = d2.outerHTML;
    console.log('outerHTML OK len', h.length);
  } catch (e) {
    console.log('outerHTML THREW', e.name, e.message, String(e));
  }
  try {
    const l = w.dhCollectFresh('days');
    console.log('collect days:', Array.isArray(l) && l.length, l && l[0] && l[0].id, l && l[0] && String(l[0].html).length);
  } catch (e) { console.log('collect days threw', e.message); }
  try {
    const f = w.dhCollectFresh('fields');
    console.log('collect fields total keys:', Object.keys(f || {}).length);
  } catch (e) { console.log('collect fields threw', e.message); }

  const inp = d2.querySelector('input[type=text]');
  if (inp) {
    inp.value = 'Rope bonding test';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  }
  w.document.getElementById('save-contract').click();
  await new Promise(r => setTimeout(r, 2500));

  console.log('server keys:', serverRows.map(r => r.k + ':' + (Array.isArray(r.v) ? ('array[' + r.v.length + ']') : ('obj{' + Object.keys(r.v || {}).length + '}'))).join(' | '));
  const daysRow = serverRows.find(r => r.k === 'days');
  console.log('days row ids:', daysRow ? daysRow.v.map(d => d.id).join(',') : 'MISSING');
  const fieldsRow = serverRows.find(r => r.k === 'fields');
  console.log('has rope value:', fieldsRow ? Object.values(fieldsRow.v).includes('Rope bonding test') : 'MISSING');
  process.exit(0);
})().catch(e => { console.log('FATAL', e.stack); process.exit(1); });
