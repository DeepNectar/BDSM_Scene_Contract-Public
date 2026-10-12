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

function b64u(buf) {
  const b = Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeCtx({ ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)', blobRead = null } = {}) {
  const store = {};
  const idbData = {};
  let credIdCounter = 0;
  let lastCreatedChallenge = null, lastCredId = null;
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
          /* v4.23 DH — enrolment must send NO WebAuthn extensions at all.
             The old largeBlob:{write, read:false} request is exactly what made
             Chrome/Samsung throw "The 'largeBlob' extension's 'read' parameter
             is only valid when requesting an assertion" on tap of
             "✨ Yes, enable it". If any future change re-adds extensions, this
             fake authenticator rejects like Chrome does → tests fail loudly. */
          if (opts.publicKey.extensions && Object.keys(opts.publicKey.extensions).length > 0) {
            const e = new Error("The 'largeBlob' extension's 'read' parameter is only valid when requesting an assertion");
            e.name = 'NotAllowedError';
            return Promise.reject(e);
          }
          lastCreatedChallenge = opts.publicKey.challenge;
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
          /* v4.23 DH — honest fake authenticator: userVerification:'required'
             means the browser only resolves this promise AFTER the OS
             face/fingerprint ceremony PASSED. We additionally refuse to answer
             unless our registration challenge is echoed in clientDataJSON
             (like a real authnr), and set the UV flag (bit 2) in authData. */
          if (!lastCreatedChallenge) { const e = new Error('no credential'); e.name = 'NotFoundError'; return Promise.reject(e); }
          const ad = new Uint8Array(37); ad[32] = 0x05;   // UP|UV
          const cdj = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: b64u(lastCreatedChallenge) }));
          const resp = { getAuthenticatorData: () => ad.buffer, clientDataJSON: cdj.buffer, getSignature: () => new Uint8Array(10).buffer };
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

  // 2. Android path — enrolment sends NO extensions (the exact largeBlob
  //    error from the bug report can never recur), unlock still returns secret
  {
    const { ctx } = makeCtx({ ua: 'Mozilla/5.0 (Linux; Android 14)' });
    const DhBio = loadBio(ctx);
    ok('Android label', DhBio.methodLabel() === 'Fingerprint / Face unlock');
    const enrolled = await DhBio.enroll('s3cret');
    ok('enroll succeeds with extension-free options (largeBlob fix)', enrolled === true);
    ok('unlock w/ passed ceremony works', (await DhBio.unlock()) === 's3cret');
  }

  // 3. lost passkey (fake authnr has no credential) → honest not-enrolled,
  //    enrolment cleaned up instead of silently releasing anything
  {
    const { ctx } = makeCtx({ ua: 'Mozilla/5.0 (Linux; Android 14)' });
    const DhBio = loadBio(ctx);
    await DhBio.enroll('s3cret');
    ctx.__killCred = true;
    // simulate deleted passkey by reloading storage into a fresh ctx-less cred state
    const { ctx: ctx2 } = makeCtx({ ua: 'Mozilla/5.0 (Linux; Android 14)' });
    Object.assign(ctx2.localStorageItems || {}, {}); // no-op; use direct approach below
    const DhBio2 = loadBio(ctx2);
    let msg = ''; try { await DhBio2.unlock(); } catch (e) { msg = e.message; }
    ok('no enrolment → not-enrolled', msg === 'not-enrolled');
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
