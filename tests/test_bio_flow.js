/* v4.19 DH — end-to-end simulation of js/bio.js enrolment + unlock.
   Fakes localStorage, IndexedDB and navigator.credentials (WebAuthn), uses
   Node's real WebCrypto. Verifies:
     1. enroll() stores blob + envelope; supported is a synchronous boolean
     2. unlock() returns the exact secret after a passed ceremony
     3. user-agent labels work (iOS/Android/desktop)
     4. cancelled ceremony rejects with NotAllowedError-ish, state intact
     5. missing envelope (site data cleared) → disable + 'not-enrolled'
     6. byte-matching large-blob READ path still accepted */
'use strict';
const fs = require('fs'), vm = require('vm');
const crypto = require('crypto');
if (!global.crypto) global.crypto = crypto.webcrypto;

function makeCtx({ ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)', blobRead = null } = {}) {
  const store = {};
  const idbData = {};
  let credIdCounter = 0;
  let lastCreatedTicket = null, lastCredId = null;
  let getShouldThrow = false;
  const ctx = {
    console,
    TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Promise, JSON, Math, Date, parseInt, String, Number, Array, Object, Error, RegExp,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout,
    crypto: crypto.webcrypto,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    indexedDB: {
      open: name => {
        /* Real IndexedDB semantics: the DB connection (onsuccess) opens
           FIRST; each transaction then runs to completion independently and
           resolves its own request callbacks — nothing is chained to another
           transaction's completion. */
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => ({}),
          transaction: () => {
            const tx = { ops: [], oncomplete: null, objectStore: () => ({
              put: (val, key) => { tx.ops.push(() => { idbData[name + '/' + key] = val; }); return {}; },
              get: key => { const rq = { result: undefined, onsuccess: null, onerror: null }; tx.ops.push(() => { rq.result = idbData[name + '/' + key] ?? null; }); (tx._reqs = tx._reqs || []).push(() => { if (rq.onsuccess) rq.onsuccess(); }); return rq; },
              delete: key => { tx.ops.push(() => { delete idbData[name + '/' + key]; }); return {}; },
            }) };
            setTimeout(() => {
              for (const op of tx.ops) op();
              // fire the GET request's own onsuccess BEFORE tx.oncomplete, like real IndexedDB
              for (const op of tx._reqs || []) { try { op(); } catch (e) {} }
              if (tx.oncomplete) tx.oncomplete();
            }, 0);
            return tx;
          },
        };
        const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
        setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); }, 0);
        return req;
      },
    },
    PublicKeyCredential: { isPlatformAuthenticatorAvailable: () => Promise.resolve(true) },
    navigator: {
      /* v4.20 DH — fresh user activation, like a real tap on the button */
      userActivation: { hasBeenActive: true, isActive: true },
      userAgent: ua, maxTouchPoints: 2,
      credentials: {
        create: opts => {
          // record the ticket written via large-blob write extension
          const ext = opts.publicKey.extensions || {};
          lastCreatedTicket = ext.largeBlob ? ext.largeBlob.write : null;
          lastCredId = 'cred-' + (++credIdCounter);
          // minimal authenticatorData: rpHash(32)+flags(1: AT|UV=0x41)+counter(4)+AAGUID(16)+cidLen(2)+cid+COSE key
          const cid = Buffer.from([1,2,3,4]);
          const ad = new Uint8Array(37 + 16 + 2 + cid.length + 77);
          ad[32] = 0x41; ad[33]=0;ad[34]=0;ad[35]=0;ad[36]=1;
          ad[55] = 0; ad[56] = cid.length; cid.forEach((b,i)=>ad[57+i]=b);
          // COSE ES256 key placeholder (77 bytes starting at 61): tag-free map header bytes won't be parsed unless used
          return Promise.resolve({ id: lastCredId, rawId: cid.buffer, response: {
            getAuthenticatorData: () => ad.buffer, getPublicKey: () => null,
          }});
        },
        get: () => {
          if (getShouldThrow) { const e = new Error('The operation was aborted.'); e.name = 'NotAllowedError'; return Promise.reject(e); }
          const ad = new Uint8Array(37); ad[32] = 0x05;
          const resp = { getAuthenticatorData: () => ad.buffer, clientDataJSON: new Uint8Array(10).buffer, getSignature: () => new Uint8Array(10).buffer };
          if (blobRead === 'ticket') resp.getLargeBlob = () => lastCreatedTicket.buffer.slice(lastCreatedTicket.byteOffset, lastCreatedTicket.byteOffset + lastCreatedTicket.byteLength);
          if (blobRead === 'wrong') resp.getLargeBlob = () => new Uint8Array(32).fill(9).buffer;
          return Promise.resolve({ id: lastCredId, response: resp });
        },
      },
    },
  };
  ctx.window = ctx;
  return { ctx, store, idbData, setGetThrow: v => { getShouldThrow = v; } };
}

function loadBio(ctx) {
  const code = fs.readFileSync('js/bio.js', 'utf8');
  vm.runInContext(code, vm.createContext(ctx), { filename: 'bio.js' });
  return ctx.DhBio;
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

  // 1. basic enrol -> unlock (no blob read, like iOS)
  {
    const { ctx } = makeCtx();
    const DhBio = loadBio(ctx);
    ok('supported is synchronous boolean true', DhBio.supported === true);
    ok('iOS label', DhBio.methodLabel() === 'Face ID');
    const secret = 'Deepnectar@1612@';
    const enrolled = await DhBio.enroll(secret);
    ok('enroll returns true', enrolled === true);
    ok('isEnrolled true', (await DhBio.isEnrolled()) === true);
    const got = await DhBio.unlock();
    ok('unlock returns exact secret', got === secret);
    // disable clears everything
    await DhBio.disable();
    ok('after disable not enrolled', (await DhBio.isEnrolled()) === false);
    let threw = null; try { await DhBio.unlock(); } catch (e) { threw = e.message; }
    ok('unlock after disable → not-enrolled', threw === 'not-enrolled');
  }

  // 2. blob READ byte-match path (Android/Chrome)
  {
    const { ctx } = makeCtx({ ua: 'Mozilla/5.0 (Linux; Android 14)', blobRead: 'ticket' });
    const DhBio = loadBio(ctx);
    ok('Android label', DhBio.methodLabel() === 'Fingerprint / Face unlock');
    await DhBio.enroll('s3cret');
    ok('unlock w/ matching blob works', (await DhBio.unlock()) === 's3cret');
  }

  // 3. tampered blob READ → refuse
  {
    const { ctx } = makeCtx({ ua: 'Mozilla/5.0 (Linux; Android 14)', blobRead: 'wrong' });
    const DhBio = loadBio(ctx);
    await DhBio.enroll('s3cret');
    let msg = ''; try { await DhBio.unlock(); } catch (e) { msg = e.message; }
    ok('mismatched blob → seal-mismatch refusal', msg === 'seal-mismatch');
  }

  // 4. cancelled ceremony keeps enrolment
  {
    const { ctx, setGetThrow } = makeCtx();
    const DhBio = loadBio(ctx);
    await DhBio.enroll('s3cret');
    setGetThrow(true);
    let name = ''; try { await DhBio.unlock(); } catch (e) { name = e.name; }
    ok('cancel surfaces NotAllowedError', name === 'NotAllowedError');
    setGetThrow(false);
    ok('enrolment survives cancel', (await DhBio.unlock()) === 's3cret');
  }

  // 5. lost envelope (site data cleared) → honest reset
  {
    const { ctx, idbData } = makeCtx();
    const DhBio = loadBio(ctx);
    await DhBio.enroll('s3cret');
    Object.keys(idbData).forEach(k => delete idbData[k]);
    let msg = ''; try { await DhBio.unlock(); } catch (e) { msg = e.message; }
    ok('missing envelope → not-enrolled + auto-disable', msg === 'not-enrolled' && (await DhBio.isEnrolled()) === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED REJECTION:', e && (e.stack || e.message || String(e))); });
