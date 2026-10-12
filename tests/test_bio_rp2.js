/* v4.24 DH — enrolment MUST always declare an explicit rp.id (hostname, or a
   stable per-install pseudo-id when location.hostname is empty). Without it,
   iOS/Android passkey managers auto-inject the largeBlob extension and
   enabling fails with "The 'largeBlob' extension's 'read' parameter is only
   valid when requesting an assertion". */
'use strict';
const fs = require('fs'), vm = require('vm');
const crypto = require('crypto');

function makeCtx({ hostname = 'deep-honey.app', rejectWithoutRpId = true } = {}) {
  const store = {};
  let credIdCounter = 0;
  let lastCreateOpts = null;
  const ctx = {
    console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, JSON,
    Math, Date, parseInt, String, Number, Array, Object, Error, RegExp,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout,
    crypto: crypto.webcrypto,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    indexedDB: (() => {
      const idbData = {};
      return { open: () => {
        const db = {
          createObjectStore: () => ({}),
          transaction: () => {
            const tx = { ops: [], oncomplete: null, objectStore: () => ({
              put: (val, key) => { tx.ops.push(() => { idbData[key] = val; }); return {}; },
              get: key => { const rq = { result: undefined, onsuccess: null }; tx.ops.push(() => { rq.result = idbData[key] ?? null; }); (tx._reqs = tx._reqs || []).push(() => { if (rq.onsuccess) rq.onsuccess(); }); return rq; },
              delete: key => { tx.ops.push(() => { delete idbData[key]; }); return {}; },
            }) };
            setTimeout(() => { for (const op of tx.ops) op(); for (const op of tx._reqs || []) { try { op(); } catch (e) {} } if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
        };
        const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
        setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); }, 0);
        return req;
      } };
    })(),
    PublicKeyCredential: function () {},
    location: { hostname, href: 'https://' + hostname + '/index.html' },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)',
      maxTouchPoints: 2,
      credentials: {
        create: opts => {
          lastCreateOpts = opts;
          const pk = opts.publicKey || {};
          /* fake iOS/Safari passkey manager: no explicit rp.id → it treats the
             ceremony as a synced passkey, auto-injects largeBlob and throws
             the EXACT user-visible error */
          if (rejectWithoutRpId && !(pk.rp && pk.rp.id)) {
            const e = new Error("The 'largeBlob' extension's 'read' parameter is only valid when requesting an assertion");
            e.name = 'NotAllowedError';
            return Promise.reject(e);
          }
          if (pk.extensions && Object.keys(pk.extensions).length) {
            const e = new Error("The 'largeBlob' extension's 'read' parameter is only valid when requesting an assertion");
            e.name = 'NotAllowedError';
            return Promise.reject(e);
          }
          const cid = Buffer.from([1, 2, 3, 4]);
          const ad = new Uint8Array(37 + 16 + 2 + cid.length + 77);
          ad[32] = 0x41;
          ad[55] = 0; ad[56] = cid.length; cid.forEach((b, i) => ad[57 + i] = b);
          return Promise.resolve({ id: 'cred-' + (++credIdCounter), response: { getAuthenticatorData: () => ad.buffer } });
        },
        get: () => Promise.reject(new Error('not used')),
      },
    },
  };
  ctx.window = ctx;
  return { ctx, getOpts: () => lastCreateOpts };
}

function loadBio(ctx) {
  const code = fs.readFileSync('js/bio.js', 'utf8');
  vm.runInContext(code, vm.createContext(ctx), { filename: 'bio.js' });
  return ctx.DhBio;
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

  // 1. https origin → rp.id = hostname, enrol succeeds against strict fake iOS authnr
  {
    const { ctx, getOpts } = makeCtx();
    const DhBio = loadBio(ctx);
    const enrolled = await DhBio.enroll('s3cret');
    ok('enrol succeeds on real host (strict passkey-manager fake rejects missing rp.id)', enrolled === true);
    const opts = getOpts();
    ok('rp.id explicitly = hostname', !!(opts && opts.publicKey.rp && opts.publicKey.rp.id === 'deep-honey.app'));
    ok('create options carry NO extensions', !(opts.publicKey.extensions && Object.keys(opts.publicKey.extensions).length));
  }

  // 2. file:// style origin (empty hostname) → still sends an explicit rp.id (pseudo-id)
  {
    const { ctx, getOpts } = makeCtx({ hostname: '' });
    const DhBio = loadBio(ctx);
    const enrolled = await DhBio.enroll('s3cret');
    ok('enrol succeeds even with empty location.hostname', enrolled === true);
    const opts = getOpts();
    ok('rp.id present (per-install pseudo-id) on file-style origin', !!(opts && opts.publicKey.rp && typeof opts.publicKey.rp.id === 'string' && opts.publicKey.rp.id.length > 0));
  }

  // 3. app.js fallback route also always sets rp.id
  {
    const appSrc = fs.readFileSync('js/app.js', 'utf8');
    ok('app.js fallback rp.id covers empty-hostname case too', /dhContract\.bio\.rpid/.test(appSrc));
    ok('both routes migrated to v4.25 keys',
      appSrc.includes("'dh-bio-v425'") && appSrc.includes("'envelope.v4.25'") && appSrc.includes('dhContract.bio.blob.v4.25'));
    const bioSrc = fs.readFileSync('js/bio.js', 'utf8');
    ok('no live largeBlob usage in shipped code (comments stripped)',
      !/largeBlob\s*:/.test(bioSrc.replace(/\/\*[\s\S]*?\*\//g, '')) &&
      !/largeBlob\s*:/.test(appSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
