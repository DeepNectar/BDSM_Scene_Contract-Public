/* v3.6 DH — verifies the Supabase connection & sync fix:
   1. cloud.js auto-pulls state at script load (no one has to call load())
   2. CloudStore.ready resolves after the pull; mirror holds real cloud data
   3. refresh() re-pulls fresh state (multi-device sync)
   4. app.js boots AFTER the pull and replays days/fields/signatures
   Uses a fake supabase-js client backed by an in-memory "server" table. */
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

/* ---------- fake server state (stands in for the contract_state table) ---------- */
const FIELD_KEY = 'head>0.6.1.0.0';   // structural key of the first text input in #main-contract
const serverRows = [
  { k: 'fields',  v: { [FIELD_KEY]: 'from-device-B' } },
  { k: 'accepts', v: { seal: { Deep: { ts: 1 } } } },
  { k: 'wiped',   v: { flag: false } },
];
let selectCalls = 0, upsertCalls = 0;

window.supabase = {
  createClient(url, key) {
    if (!url.includes('supabase.co') || !key.startsWith('eyJ')) throw new Error('bad config');
    return {
      from(table) {
        if (table !== 'contract_state') throw new Error('wrong table ' + table);
        return {
          select() { selectCalls++; return Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }); },
          upsert(row) {
            upsertCalls++;
            const i = serverRows.findIndex(r => r.k === row.k);
            if (i >= 0) serverRows[i].v = row.v; else serverRows.push({ k: row.k, v: row.v });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
};

/* ---------- run config + cloud like the browser would ---------- */
window.eval(fs.readFileSync('js/supabase-config.js', 'utf8'));
window.eval(fs.readFileSync('js/cloud.js', 'utf8'));

(async () => {
  /* 1. auto-load happened without anyone calling load() */
  const st = await window.CloudStore.ready;
  console.log('auto-pull ran at script load:', selectCalls >= 1);
  console.log('ready resolved with state:', !!st && Object.keys(st.fields).length === 1);
  console.log('mirror fields from cloud:', window.CloudStore.fields()[FIELD_KEY] === 'from-device-B');
  console.log('mirror accepts from cloud:', !!window.CloudStore.accepts().seal.Deep);
  console.log('status pill connected:', /Connected/.test(window.document.getElementById('cloud-status').textContent));

  /* 2. refresh picks up another device's writes (simulated on the server) */
  serverRows.find(r => r.k === 'fields').v[FIELD_KEY] = 'from-device-A';
  const st2 = await window.CloudStore.refresh();
  console.log('refresh re-pulled fresh value:', window.CloudStore.fields()[FIELD_KEY] === 'from-device-A');

  /* 3. saves go to the server */
  await window.CloudStore.saveFields({ x: 'y' });
  console.log('saveFields upserted to server:', serverRows.find(r => r.k === 'fields').v.x === 'y');

  /* 4. app.js boots AFTER the pull and replays cloud values into the DOM */
  window.eval(fs.readFileSync('js/app.js', 'utf8'));
  await new Promise(r => setTimeout(r, 300));
  const el = window.document.querySelector('#main-contract input[type=text]');
  console.log('after boot, field replayed from cloud:', el.value === 'from-device-A');
  console.log('runtime errors:', errors.slice(0, 5));
  console.log('ALL CHECKS DONE');
  process.exit(0);
})().catch(e => { console.log('FATAL:', e.stack); process.exit(1); });
