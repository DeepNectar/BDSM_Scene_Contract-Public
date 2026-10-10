const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html','utf8');
const configSrc = fs.readFileSync('js/supabase-config.js','utf8');
const cloudSrc = fs.readFileSync('js/cloud.js','utf8');
const appSrc = fs.readFileSync('js/app.js','utf8');
const serverRows = []; 
function makeServerClient(){ return { from(t){ return { select(){return Promise.resolve({data:JSON.parse(JSON.stringify(serverRows)),error:null});}, upsert(row){ const i=serverRows.findIndex(r=>r.k===row.k); if(i>=0)Object.assign(serverRows[i],row); else serverRows.push({...row}); return Promise.resolve({error:null}); } }; }, channel(){return{on(){return this;},subscribe(){return this;}};} }; }
const dom = new JSDOM(htmlSrc,{runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window; w.confirm=()=>true; w.alert=()=>{}; w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));
w.supabase={createClient:()=>makeServerClient()};
w.eval(configSrc); w.eval(cloudSrc); w.eval(appSrc);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await w.CloudStore.ready;
  w.document.querySelector('#password-input').value='Deepnectar@1612@';
  w.document.querySelector('#login-btn').click();
  await wait(400);
  const host=w.document.createElement('div');
  host.innerHTML='<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
  w.document.body.appendChild(host);
  w.document.getElementById('empty-blank-btn').click();
  await wait(300);
  const day=w.document.getElementById('day1');
  const inp=day.querySelectorAll('input[type="text"], textarea')[0];
  console.log('dhk before typing:', inp.getAttribute('data-dhk'));
  inp.value='HELLO SYNC TEST';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  console.log('dhk after typing:', inp.getAttribute('data-dhk'));
  await wait(2500); // autosave debounce 1.2s
  const f=serverRows.find(r=>r.k==='fields')||{v:{}};
  const hit=Object.keys(f.v).filter(k=>f.v[k]==='HELLO SYNC TEST');
  console.log('after autosave, key holding value:', hit);
  await w.dhSyncNow();
  const f2=serverRows.find(r=>r.k==='fields')||{v:{}};
  console.log('after syncNow, key holding value:', Object.keys(f2.v).filter(k=>f2.v[k]==='HELLO SYNC TEST'));
  process.exit(0);
})().catch(e=>{console.log('FATAL',e.stack);process.exit(1)});
