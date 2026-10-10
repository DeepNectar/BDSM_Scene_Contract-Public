const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html','utf8');
const serverRows = [];
const dom = new JSDOM(htmlSrc, { runScripts:'outside-only', pretendToBeVisual:true });
const w = dom.window;
w.confirm=()=>true; w.alert=()=>{}; w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));
try{w.localStorage.clear()}catch{}
w.supabase={createClient:()=>({
  from:t=>({select:()=>Promise.resolve({data:JSON.parse(JSON.stringify(serverRows)),error:null}),
            upsert:r=>{const i=serverRows.findIndex(x=>x.k===r.k); if(i>=0)Object.assign(serverRows[i],r); else serverRows.push({...r, updated_at:new Date().toISOString()}); return Promise.resolve({error:null});}}),
  channel:()=>({on:()=>({subscribe:()=>({})}),subscribe:()=>({})}), realtime:{} })};
w.eval(fs.readFileSync('js/supabase-config.js','utf8'));
w.eval(fs.readFileSync('js/cloud.js','utf8'));
w.eval(fs.readFileSync('js/app.js','utf8'));
(async()=>{
  await w.CloudStore.ready;
  w.document.getElementById('password-input').value='Deepnectar@1612@';
  w.document.getElementById('login-btn').click();
  await new Promise(r=>setTimeout(r,400));
  const btn = Array.from(w.document.querySelectorAll('button')).find(b=>/Add blank day/i.test(b.textContent));
  btn.click();
  await new Promise(r=>setTimeout(r,300));
  const day = w.document.querySelector('.page[id^="day"]');
  const el = day.querySelector('input[type="text"], textarea');
  el.value = 'ROPE TEST SENTENCE';
  el.dispatchEvent(new w.Event('input',{bubbles:true}));
  console.log('AFTER TYPING  DOM VALUE:', el.value);
  await new Promise(r=>setTimeout(r,2500));   // autosave + merged write complete
  console.log('AFTER WRITE   DOM VALUE:', el.value, 'same node?', w.document.contains(el));
  const f = serverRows.find(r=>r.k==='fields');
  console.log('SERVER has typed value?', Object.values(f.v).includes('ROPE TEST SENTENCE'));
  process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1)});
