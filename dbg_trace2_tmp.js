const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html','utf8');
const serverRows = [];
const deviceClients = [];
global.__serverUpsertLog = [];
function makeServerClient(){
  const myListeners=[];
  const client={ _myListeners:myListeners,
    from(t){ return {
      select(){ console.log('CLIENT select()'); return Promise.resolve({data:JSON.parse(JSON.stringify(serverRows)),error:null}); },
      upsert(row){ console.log('SERVER UPSERT k='+row.k+' size='+(JSON.stringify(row.v)||'').length);
        global.__serverUpsertLog.push(row.k);
        const i=serverRows.findIndex(r=>r.k===row.k); if(i>=0)Object.assign(serverRows[i],row); else serverRows.push({created_at:new Date().toISOString(),last_writer:'unknown',...row});
        deviceClients.forEach(c=>{ if(c!==client&&c._myListeners.length) c._myListeners.forEach(fn=>{try{fn();}catch(e){}}); });
        return Promise.resolve({error:null}); } }; },
    channel(){ const ch={on(ev,cfg,cb){myListeners.push(cb);return ch;},subscribe(){return ch;}}; return ch; },
    rpc(name,args){ console.log('SERVER RPC '+name); return Promise.resolve({data:{rescued:false},error:null}); },
    realtime:{} };
  deviceClients.push(client); return client;
}
function bootDevice(name){
  const dom=new JSDOM(htmlSrc,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.com/'});
  const w=dom.window; w.confirm=()=>true; w.alert=()=>{};
  w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));
  try{w.localStorage.clear()}catch{}
  w.supabase={createClient:(u,k,o)=>{ console.log('createClient called url='+u); return makeServerClient(); }};
  const errors=[]; w.addEventListener('error',e=>errors.push(String(e.message)));
  w.eval(fs.readFileSync('js/supabase-config.js','utf8'));
  w.eval(fs.readFileSync('js/cloud.js','utf8'));
  w.eval(fs.readFileSync('js/app.js','utf8'));
  return {w,doc:w.document,$:s=>w.document.querySelector(s),errors,name};
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const A=bootDevice('A');
  await A.w.CloudStore.ready;
  await wait(500);
  console.log('cloudReachable? probe ran; typeof fetch in window:', typeof A.w.fetch);
  console.log('status pill text:', A.$('#cloud-status') && A.$('#cloud-status').textContent);
  A.$('#password-input').value='Deepnectar@1612@';
  A.$('#login-btn').click();
  await wait(400);
  let btn=A.doc.getElementById('empty-blank-btn')||Array.from(A.doc.querySelectorAll('button')).find(b=>/Add blank day/i.test(b.textContent));
  if(!btn){ const host=A.doc.createElement('div'); host.innerHTML='<button id="empty-blank-btn" type="button">➕ Add blank day</button>'; A.doc.body.appendChild(host); btn=A.doc.getElementById('empty-blank-btn'); }
  btn.click();
  await wait(300);
  const dayNewA=A.doc.getElementById('day1');
  console.log('day1 exists?',!!dayNewA);
  const inputs=Array.from(dayNewA.querySelectorAll('input[type="text"],textarea'));
  const inp=inputs[0]; const ta=dayNewA.querySelector('textarea')||inp;
  inp.value='ROPE TEST'; inp.dispatchEvent(new A.w.Event('input',{bubbles:true}));
  ta.value='AFTERCARE TEST'; ta.dispatchEvent(new A.w.Event('input',{bubbles:true}));
  A.$('#save-contract').click();
  await wait(3000);
  console.log('upsert log:',global.__serverUpsertLog.join(','));
  console.log('server keys now:',serverRows.map(r=>r.k));
  console.log('errors A:',A.errors.slice(0,5));
  process.exit(0);
})().catch(e=>{console.log('FATAL',e.stack);process.exit(1)});
