/* Proves the v4.20 gesture-safety: navigator.credentials.create/get must be
   called SYNCHRONOUSLY (same task) as enroll()/unlock(), and that a stale tap
   (no userActivation + old timestamp) is refused with 'no-gesture'. */
'use strict';
const fs = require('fs'), vm = require('vm');
const crypto = require('crypto');
if (!global.crypto) global.crypto = crypto.webcrypto;

function makeCtx({ activation }) {
  const store = {}, idbData = {};
  let createSyncSeen = false, getSyncSeen = false, outsideTask = false;
  const ctx = {
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, JSON, Math, Date, parseInt, String, Number, Array, Object, Error, RegExp,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout,
    crypto: crypto.webcrypto,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k,v)=>{store[k]=String(v);}, removeItem: k=>{delete store[k];} },
    indexedDB: { open: name => { const db={ objectStoreNames:{contains:()=>true}, createObjectStore:()=>({}), transaction:()=>{ const tx={ops:[],oncomplete:null,_reqs:[],objectStore:()=>({ put:(val,key)=>{tx.ops.push(()=>{idbData[name+'/'+key]=val;});return{};}, get:key=>{const rq={result:undefined,onsuccess:null,onerror:null};tx.ops.push(()=>{rq.result=idbData[name+'/'+key]??null;});tx._reqs.push(()=>{if(rq.onsuccess)rq.onsuccess();});return rq;}, delete:key=>{tx.ops.push(()=>{delete idbData[name+'/'+key];});return{};} }) }; setTimeout(()=>{for(const op of tx.ops)op(); for(const op of tx._reqs)op(); if(tx.oncomplete)tx.oncomplete();},0); return tx; } }; const req={result:db,onsuccess:null,onerror:null,onupgradeneeded:null}; setTimeout(()=>{if(req.onupgradeneeded)req.onupgradeneeded(); if(req.onsuccess)req.onsuccess();},0); return req; } },
    PublicKeyCredential: { isPlatformAuthenticatorAvailable: () => Promise.resolve(true) },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)', maxTouchPoints: 2,
      userActivation: activation ? { hasBeenActive: true } : undefined,
      credentials: {
        create(opts) {
          // synchronous-call detector: microtask queued before this returns?
          let ranMicro = false; Promise.resolve().then(()=>{ranMicro=true;});
          if (ranMicro) outsideTask = true;         // (should never be true synchronously)
          createSyncSeen = true;
          const ticket = opts.publicKey.extensions.largeBlob.write;
          const cid = Buffer.from([1,2,3,4]);
          const ad = new Uint8Array(37+16+2+cid.length+77);
          ad[32]=0x41; ad[55]=0; ad[56]=cid.length; cid.forEach((b,i)=>ad[57+i]=b);
          return Promise.resolve({ id:'cred-1', rawId: cid.buffer, response: {
            getAuthenticatorData: () => ad.buffer,
            getClientDataJSON: () => new TextEncoder().encode(JSON.stringify({type:'webauthn.create', typeInfo:{extension:{largeBlob:{write: (function(){let s='';ticket.forEach(b=>s+=String.fromCharCode(b));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');})()}}}})).buffer,
          }});
        },
        get() {
          getSyncSeen = true;
          const ad = new Uint8Array(37); ad[32]=0x05;
          return Promise.resolve({ id:'cred-1', response: { getAuthenticatorData:()=>ad.buffer, clientDataJSON:new Uint8Array(10).buffer, getSignature:()=>new Uint8Array(10).buffer } });
        },
      },
    },
  };
  ctx.window = ctx;
  return { ctx, store, flags: () => ({createSyncSeen, getSyncSeen, outsideTask}) };
}
function loadBio(ctx){ vm.runInContext(fs.readFileSync('js/bio.js','utf8'), vm.createContext(ctx), {filename:'bio.js'}); return ctx.DhBio; }

(async () => {
  let pass=0, fail=0; const ok=(n,c)=>{c?(pass++,console.log('PASS',n)):(fail++,console.log('FAIL',n));};

  // A) fresh tap (userActivation present): enroll + unlock must run credentials synchronously
  {
    const { ctx, flags } = makeCtx({ activation: true });
    const B = loadBio(ctx);
    const pEnroll = B.enroll('Deepnectar@1612@');
    ok('credentials.create called SYNCHRONOUSLY inside enroll()', flags().createSyncSeen === true);
    await pEnroll;
    const pUnlock = B.unlock();
    ok('credentials.get called SYNCHRONOUSLY inside unlock()', flags().getSyncSeen === true);
    ok('unlock still returns exact secret', (await pUnlock) === 'Deepnectar@1612@');
  }
  // B) v4.21 DH — the JS-side gesture pre-check is GONE on purpose: even with
  //    no navigator.userActivation and no tap stamp, enroll() must STILL call
  //    navigator.credentials.create synchronously (the browser itself decides;
  //    the old 'no-gesture' refusal was silently killing the buttons on phones).
  {
    const { ctx, store, flags } = makeCtx({ activation: false });
    const B = loadBio(ctx);
    const pEnroll = B.enroll('x');
    ok('no userActivation → credentials.create STILL called synchronously', flags().createSyncSeen === true);
    const firstRes = await pEnroll.catch(()=>false);
    ok('no userActivation → enrolment proceeds (guard removed)', firstRes === true);
    // recorded recent tap (app stamps on click) also still works w/o userActivation API
    store['dhContract.bio.tap.v'] = String(Date.now());
    const okRes = await B.enroll('Deepnectar@1612@').catch(()=>false);
    ok('recent recorded tap → enrolment proceeds', okRes === true);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
