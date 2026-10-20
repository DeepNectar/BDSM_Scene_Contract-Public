const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html','utf8');
const serverRows = [];
const deviceClients = [];
function makeServerClient(){
  const myListeners=[];
  const client={ _myListeners:myListeners,
    from(t){ return {
      select(){ return Promise.resolve({data:JSON.parse(JSON.stringify(serverRows)),error:null}); },
      upsert(row){ console.log('SERVER UPSERT k='+row.k+' size='+(JSON.stringify(row.v)||'').length);
        const i=serverRows.findIndex(r=>r.k===row.k); if(i>=0)Object.assign(serverRows[i],row); else serverRows.push({created_at:new Date().toISOString(),last_writer:'unknown',...row});
        deviceClients.forEach(c=>{ if(c!==client&&c._myListeners.length) c._myListeners.forEach(fn=>{try{fn();}catch(e){}}); });
        return Promise.resolve({error:null}); } }; },
    channel(){ const ch={on(ev,cfg,cb){myListeners.push(cb);return ch;},subscribe(){return ch;}}; return ch; },
    rpc(name,args){ console.log('SERVER RPC '+name); return Promise.resolve({data:{rescued:false,reason:'no PITR in test'},error:null}); },
    realtime:{} };
  deviceClients.push(client); return client;
}
function bootDevice(name){
  const dom=new JSDOM(htmlSrc,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.com/'});
  const w=dom.window; w.confirm=()=>true; w.alert=()=>{};
  w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));
  try{w.localStorage.clear()}catch{}
  w.supabase={createClient:()=>makeServerClient()};
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
  console.log('after ready: serverRows=',serverRows.map(r=>r.k));
  A.$('#password-input').value='Deepnectar@1612@';
  A.$('#login-btn').click();
  await wait(400);
  let btn=A.doc.getElementById('empty-blank-btn')||Array.from(A.doc.querySelectorAll('button')).find(b=>/Add blank day/i.test(b.textContent));
  if(!btn){ const host=A.doc.createElement('div'); host.innerHTML='<button id="empty-blank-btn" type="button">➕ Add blank day</button>'; A.doc.body.appendChild(host); btn=A.doc.getElementById('empty-blank-btn'); }
  btn.click();
  await wait(300);
  const pages=Array.from(A.doc.querySelectorAll('.page')).map(p=>p.id);
  console.log('pages after addBlankDay:',pages);
  const dayNewA=A.doc.getElementById('day1');
  console.log('day1 exists?',!!dayNewA);
  if(dayNewA){
    const inputs=Array.from(dayNewA.querySelectorAll('input[type="text"],textarea'));
    console.log('inputs count',inputs.length);
    const inp=inputs[0]; const ta=dayNewA.querySelector('textarea')||inp;
    inp.value='ROPE TEST'; inp.dispatchEvent(new A.w.Event('input',{bubbles:true}));
    ta.value='AFTERCARE TEST'; ta.dispatchEvent(new A.w.Event('input',{bubbles:true}));
  }
  console.log('localStorage deleted key:', A.w.localStorage.getItem('dhContract.deleted.v1'));
  A.$('#save-contract').click();
  await wait(3000);
  console.log('server keys now:',serverRows.map(r=>r.k+':'+(Array.isArray(r.v)?('len'+r.v.length):Object.keys(r.v||{}).length)));
  const daysRow=serverRows.find(r=>r.k==='days');
  console.log('days row:',daysRow?JSON.stringify(daysRow.v.map(d=>d&&d.id)):'MISSING');
  const fieldsRow=serverRows.find(r=>r.k==='fields');
  console.log('fields with ROPE TEST:',fieldsRow?Object.entries(fieldsRow.v).filter(([k,v])=>v==='ROPE TEST'):'MISSING');
  console.log('errors A:',A.errors.slice(0,5));
  process.exit(0);
})().catch(e=>{console.log('FATAL',e.stack);process.exit(1)});
