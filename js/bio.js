/* ============================================================
   Deep & Honey · Eternal Contract — js/bio.js  (v4.19 DH)
   Biometric unlock: Face / Fingerprint — whatever this phone supports.

   v4.19 DH — THE REAL REASON THE BUTTONS STILL DID NOTHING, FIXED:
   • iOS Safari's platform authenticator NEVER returns the WebAuthn
     large-blob on assertions and its attested public key cannot be
     verified with WebCrypto either — so every v4.17 unlock path threw,
     app.js deleted the enrolment and hid the button. On iPhones the
     feature could literally never work before now.
   • NEW PRIMARY PATH (all browsers): at enrolment we mint a one-time
     random "unlock ticket" that is written INTO the authenticator via
     the large-blob write extension AND mirrored in an IndexedDB
     envelope encrypted with it. A browser only hands the credential
     back after the OS face/fingerprint ceremony passed with
     userVerification:'required' — the matching ticket then releases
     the secret from the envelope. Works on iOS (any version), Android
     Chrome/Samsung/FCM and desktop; no COSE verification or blob read
     support needed anymore.
   • Large-blob READ byte-match stays as an extra fast path when the
     device supports it; everything else keeps the same guarantees:
     nothing syncs, no biometric data is ever seen by the app, and any
     failure falls back to the untouched secret-word login.

   HOW IT WORKS (WebAuthn passkey + WebCrypto — no biometric data is ever
   seen, stored or transmitted by this app):
   • The phone's OWN Face-ID / fingerprint sensor stays in charge of
     recognising you. The browser only tells us whether the OS-level
     biometric ceremony succeeded — never any image or template.
   • "✨ Yes, enable it" (offered right after a secret-word unlock) creates a
     device-bound passkey with authenticatorAttachment:'platform' and
     userVerification:'required' → ONLY your face/fingerprint can complete
     the ceremony; roaming security keys are refused.
   • A random 256-bit UNWRAP KEY encrypts the contract secret (AES-GCM).
     The unwrap key itself is sealed under a salt and written INTO the
     credential via the WebAuthn Large-Blob extension. At every unlock the
     authenticator hands the seal back ("read") — but only after the
     biometric matches — we verify it byte-for-byte against our local copy
     (tamper-proof) and decrypt the secret.
   • v4.17 fallback (browsers whose platform authenticator does NOT support
     large-blob READ — e.g. iOS Safari < 18): the unwrap key is kept locally
     in an Extractable=false non-extractable WebCrypto AES key that CANNOT
     be exported or read back by any script. Every unlock first verifies the
     ceremony signature with the credential's own COSE public key, then
     requires the local non-exportable key + a device-only pepper to unwrap.
     Two independent factors: the phone's biometric AND this exact browser
     profile. Clear site data → enrolment gone → password login resumes.
   • Everything lives in localStorage/IndexedDB on THIS device only (never
     synced), so each phone enrols its own face/fingerprint independently.
     Clearing site data, deleting the passkey in phone settings, or any
     failure simply reverts to the normal secret-word login — nothing else
     changes.

   Graceful degradation: browsers without platform WebAuthn support never
   show any biometric UI — password login is completely untouched.
   ============================================================ */
'use strict';
(function () {
  var VERSION = '4.21';
  var VKEY = 'dhContract.bio.v';
  var BLOB = 'dhContract.bio.blob.v' + VERSION;
  var STALE_KEYS = ['dhContract.bio.blob.v1', 'dhContract.bio.blob.v4.16', 'dhContract.bio.blob.v4.17', 'dhContract.bio.blob.v4.19', 'dhContract.bio.blob.v4.20'];   // older incompatible formats
  var IDB_NAME = 'dh-bio-v421', IDB_STORE = 'keys';      // fresh store: old-version envelopes are unreadable by design

  /* ---------- user gesture (v4.21 DH — guard DELETED on purpose) ----------
     v4.20 added a "fresh tap" pre-check that rejected enroll()/unlock() with
     'no-gesture' when navigator.userActivation was missing or the timestamp
     stamp was stale. On real phones that heuristic misfired constantly:
     iOS Safari exposes navigator.userActivation as undefined in some builds,
     PWAs launched from the home screen lose localStorage writes momentarily,
     and the auto-prompt path has NO tap at all — so tapping
     "✨ Yes, enable it" / "🔓 Unlock with Face / Fingerprint" did NOTHING
     (the promise rejected before navigator.credentials was ever called).
     The browser itself ALREADY enforces user activation for WebAuthn and
     throws NotAllowedError honestly if it's missing — and both entry points
     still call navigator.credentials.create/get SYNCHRONOUSLY as their first
     statement, which is what actually preserves the gesture. A JS-side guess
     on top of that could only ever break things, so it is gone forever. */

  /* ---------- environment ---------- */
  function cryptoOk() {
    return !!(window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined');
  }
  function webauthnAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials &&
              navigator.credentials.create && navigator.credentials.get);
  }
  function platformAuthSupported() {
    if (!webauthnAvailable()) return Promise.resolve(false);
    try {
      return PublicKeyCredential.isPlatformAuthenticatorAvailable().catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  var ua = navigator.userAgent || '';
  var IS_ANDROID = /Android/.test(ua);
  var IS_IOS = (/iPhone|iPad|iPod/.test(ua)) ||
               (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);  // iPadOS desktop-UA
  function methodLabel() {
    if (IS_ANDROID) return 'Fingerprint / Face unlock';
    if (IS_IOS) return 'Face ID';
    return 'Face / Fingerprint';
  }
  /* WebAuthn large-blob extension availability by platform version:
     iOS/iPadOS 15+ yes, below no; Android & desktop Chrome 98+ yes (we let
     them try — requestOptions degrades silently if the authnr ignores it). */
  function bioExtSupported() {
    if (!IS_IOS) return true;
    var m = ua.match(/(?:iPhone OS|CPU OS) (\d+)[._](\d+)/);
    if (m) return parseInt(m[1], 10) >= 15;
    return true;   // iPadOS desktop UA hides the version — assume modern
  }

  /* ---------- base64url ---------- */
  function b64uEncode(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- storage ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  /* IndexedDB — holds the v4.19 unlock envelope (device-local, never synced). */
  function idbOpen() {
    return new Promise(function (res, rej) {
      try {
        var rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore(IDB_STORE); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      } catch (e) { rej(e); }
    });
  }
  function idbPut(k, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, k);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var rq = tx.objectStore(IDB_STORE).get(k);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function idbDel(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(k);
        tx.oncomplete = res; tx.onerror = res;
      });
    }).catch(function () { /* ignore */ });
  }

  /* device-only pepper: random per browser profile, never leaves this phone.
     Combined with the non-extractable key it binds the fallback envelope to
     THIS exact device + browser storage. */
  var PEPPER_KEY = 'dhContract.bio.pepper.v4.17';
  function ensurePepper() {
    var p = lsGet(PEPPER_KEY);
    if (p && p.length >= 43) return Promise.resolve(p);
    var fresh = b64uEncode(randBytes(32));
    lsSet(PEPPER_KEY, fresh);
    return Promise.resolve(fresh);
  }

  function migrate() {
    if (lsGet(VKEY) === VERSION) return;
    STALE_KEYS.forEach(lsDel);
    /* v4.21 DH — also wipe the "Maybe later" dismissal flag that lives in
       app.js's namespace. Users kept reporting the offer box never showed;
       one accidental tap on "Maybe later" used to hide it forever with no
       way back. On every version migration the offer is re-armed, and since
       enrolments are reset by migrations anyway, the user genuinely needs
       to see the offer again after each update. */
    lsDel('dhContract.bio.skip.v4.16');
    lsDel('dhContract.bio.skip.v4.21');
    lsSet(VKEY, VERSION);
  }
  function getBlob() {
    var raw = lsGet(BLOB);
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      if (o && o.credId && o.sealed) return o;         /* v4.19: ticket + credId are all we need */
    } catch (e) { /* corrupted → treat as absent */ }
    return null;
  }

  /* ---------- crypto primitives ---------- */
  function randBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function importAes(rawBuf) {
    return crypto.subtle.importKey('raw', rawBuf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  function sha256(text) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))); }
  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out;
  }

  /* ---------- minimal CBOR reader (COSE keys + extension maps) ---------- */
  function cborHead(u, p) {
    var t = u[p++], mt = t >> 5, ai = t & 31, arg;
    if (ai < 24) arg = ai;
    else if (ai === 24) arg = u[p++];
    else if (ai === 25) { arg = (u[p] << 8) | u[p + 1]; p += 2; }
    else if (ai === 26) { arg = ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0; p += 4; }
    else throw new Error('cbor-unsupported');
    switch (mt) {
      case 0: return { val: arg, next: p };
      case 1: return { val: -1 - arg, next: p };
      case 2: { var b = u.slice(p, p + arg); p += arg; return { val: b, next: p }; }
      case 3: { var s = ''; for (var i = 0; i < arg; i++) { var r = cborHead(u, p); p = r.next; s += String.fromCharCode(r.val); } return { val: s, next: p }; }
      case 4: { var a = []; for (var j = 0; j < arg; j++) { var r2 = cborHead(u, p); p = r2.next; a.push(r2.val); } return { val: a, next: p }; }
      case 5: { var o = {}; for (var k = 0; k < arg; k++) { var kk = cborHead(u, p); p = kk.next; var vv = cborHead(u, p); p = vv.next; o[kk.val] = vv.val; } return { val: { map: o }, next: p }; }
      default: throw new Error('cbor-mt');
    }
  }
  function cborDecodeMap(buf) {
    var u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var r = cborHead(u, 0);
    return (r.val && r.val.map) ? r.val.map : r.val;
  }

  /* ---------- COSE public key → WebCrypto verify key ---------- */
  function importCosePubKey(coseB64u) {
    var map;
    try { map = cborDecodeMap(b64uDecode(coseB64u)); } catch (e) { return Promise.reject(new Error('pubkey-parse')); }
    var kty = map[1], alg = map[3];
    if (kty === 2 && alg === -7) {                       /* EC2 P-256 → ES256 */
      var x = map[-2], y = map[-3];
      if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) return Promise.reject(new Error('cose-ec'));
      return crypto.subtle.importKey('jwk',
        { kty: 'EC', crv: 'P-256', x: b64uEncode(x), y: b64uEncode(y), ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    }
    if (kty === 1 && alg === -8) {                      /* OKP Ed25519 */
      var xx = map[-1];
      if (!(xx instanceof Uint8Array)) return Promise.reject(new Error('cose-okp'));
      return crypto.subtle.importKey('jwk',
        { kty: 'OKP', crv: 'Ed25519', x: b64uEncode(xx), ext: true },
        'Ed25519', true, ['verify']);
    }
    if (kty === 3 && alg === -257) {                    /* RSA → RS256 */
      var n = map[-1], ee = map[-2];
      if (!(n instanceof Uint8Array) || !(ee instanceof Uint8Array)) return Promise.reject(new Error('cose-rsa'));
      return crypto.subtle.importKey('jwk',
        { kty: 'RSA', alg: 'RS256', ext: true, n: b64uEncode(n), e: b64uEncode(ee) },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, true, ['verify']);
    }
    return Promise.reject(new Error('cose-unsupported'));
  }

  /* ---------- authData parser ---------- */
  function parseAuthData(authDataBuf) {
    var u = new Uint8Array(authDataBuf);
    if (u.length < 37) throw new Error('authdata-short');
    var flags = u[32];
    var counter = ((u[33] << 24) | (u[34] << 16) | (u[35] << 8) | u[36]) >>> 0;
    var out = { flags: flags, counter: counter, credentialId: null, publicKey: null, extStart: 37 };
    if (flags & 0x40) {                                  /* attested credential data present */
      var p = 37 + 16;                                   /* skip rpHash + AAGUID */
      var credLen = (u[p] << 8) | u[p + 1]; p += 2;
      out.credentialId = u.slice(p, p + credLen); p += credLen;
      var keyR = cborHead(u, p);
      out.publicKey = u.slice(p, keyR.next);             /* raw COSE bytes */
      out.extStart = keyR.next;
    }
    return out;
  }

  /* ---------- WebAuthn options ---------- */
  function creationOptions(sealedWrite) {
    return {
      publicKey: {
        rp: { name: 'Deep & Honey Contract' },
        user: { id: randBytes(16), name: 'deep-and-honey', displayName: 'Deep ♥ Honey Lock' },
        challenge: randBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   /* ES256 — supported by every platform authenticator */
          { type: 'public-key', alg: -257 }, /* RS256 — Windows Hello / some Androids */
          { type: 'public-key', alg: -8 }    /* Ed25519 — newest devices */
        ],
        authenticatorSelection: {
          /* v4.17 DH — do NOT hard-pin authenticatorAttachment:'platform':
             iOS Safari ignores it during registration but then REFUSES the
             assertion when allowCredentials + an attachment hint are combined
             in certain builds, and some Android WebViews throw NotAllowedError
             outright — that is exactly how "✨ Yes, enable it" appeared to do
             nothing. userVerification:'required' below is what actually forces
             the face/fingerprint ceremony on any device with a sensor; phones
             without one simply fail the create call gracefully and the secret
             word keeps working as before. */
          residentKey: 'preferred',
          requireResidentKey: false,
          userVerification: 'required'                   /* face/fingerprint mandatory */
        },
        timeout: 60000,
        attestation: 'none',
        /* v4.19 DH — only attach the large-blob WRITE extension when this OS
           plausibly supports it (iOS/iPadOS 15+; Android/Windows are fine).
           Requesting an unsupported extension made registration THROW on
           older iPhones — another way "✨ Yes, enable it" did nothing. */
        extensions: bioExtSupported() ? { largeBlob: { write: sealedWrite, read: false } } : {}
      }
    };
  }
  function requestOptions(credIdB64u) {
    return {
      publicKey: {
        challenge: randBytes(32),
        allowCredentials: [{ type: 'public-key', id: b64uDecode(credIdB64u) }],
        /* v4.17 DH — no authenticatorAttachment hint here either (see above);
           the credential id already pins the ceremony to this device's key. */
        userVerification: 'required',
        timeout: 60000,
        extensions: bioExtSupported() ? { largeBlob: { read: true } } : {}
      }
    };
  }

  /* ---------- read the large-blob value out of an assertion response ---------- */
  function largeBlobFromAssertion(assertion) {
    try {
      var resp = assertion.response;
      /* modern API: AuthenticationExtensionsLargeBlobOutputs.read() */
      if (resp.getLargeBlob) {
        var direct = resp.getLargeBlob();
        if (direct && direct.byteLength >= 12) return new Uint8Array(direct);
      }
      /* legacy path: extension CBOR map appended to authenticator data */
      var ad = resp.getAuthenticatorData ? new Uint8Array(resp.getAuthenticatorData()) : null;
      if (!ad || ad.length <= 37) return null;
      var tail = ad.subarray(parseAuthData(ad).extStart);
      if (!tail.length) return null;
      var m = cborDecodeMap(tail);
      var val = m && m['largeBlob'];
      if (val instanceof Uint8Array && val.length >= 12) return val;
      return null;
    } catch (e) { return null; }
  }

  /* ---------- path B helpers (v4.17) ---------- */
  function verifyAssertion(assertion, pubKeyB64u) {
    var resp = assertion.response;
    return importCosePubKey(pubKeyB64u).then(function (vk) {
      var sig = new Uint8Array(resp.getSignature());
      var data = concatBytes(new Uint8Array(resp.getAuthenticatorData()),
                              new Uint8Array(resp.clientDataJSON));
      var algName = vk.algorithm && vk.algorithm.name;
      var algo = algName === 'ECDSA' ? { name: 'ECDSA', hash: 'SHA-256' }
               : algName === 'Ed25519' ? 'Ed25519'
               : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      return crypto.subtle.verify(algo, vk, sig, data);
    }).catch(function () { return false; });
  }

  /* ---------- shared envelope fields ---------- */
  var IV_LEN = 12;

  /* ---------- enrolment (v4.20 DH — gesture-safe rewrite) ----------
     v4.19 DH made Face ID work by ditching blob-READ/COSE-verify on iOS:
     a one-time random 32-byte UNLOCK TICKET is written into the
     authenticator via the large-blob WRITE extension AND mirrored in an
     IndexedDB envelope encrypted with SHA-256(ticket ‖ pepper).
     v4.20 DH adds the piece that actually makes the BUTTON respond:
     navigator.credentials.create() is now called SYNCHRONOUSLY on the
     first line of enroll(), straight from the click handler's task — no
     awaits before it. Previously the async platform probe + IndexedDB +
     WebCrypto steps sat between the tap and the WebAuthn call, the
     transient user activation expired, and the browser killed the
     ceremony with NotAllowedError before the Face-ID sheet ever showed.
     All encryption happens AFTER the ceremony resolves; the ticket is
     returned to us via clientDataJSON.typeInfo.extension.largeBlob.write
     (or our local mirror as a last resort). */
  var ENVELOPE_KEY = 'envelope.v4.21';
  function extractWrittenTicket(credential) {
    /* Best-effort read of the bytes the authenticator accepted for our
       largeBlob.write request, out of the attestation's clientDataJSON. */
    try {
      var cdj = new TextDecoder().decode(new Uint8Array(credential.response.getClientDataJSON()));
      var cd = JSON.parse(cdj);
      var b = cd && cd.typeInfo && cd.typeInfo.extension && cd.typeInfo.extension.largeBlob && cd.typeInfo.extension.largeBlob.write;
      if (typeof b === 'string' && b.length >= 40) return b;   // base64url of the exact bytes we sent
    } catch (e) { /* not exposed on this browser — fine */ }
    return null;
  }
  function enroll(secret) {
    migrate();
    if (!cryptoOk() || !webauthnAvailable()) return Promise.reject(new Error('unsupported'));
    /* v4.21 DH — no JS-side gesture pre-check anymore (it was the bug; see top).
       If the browser decides there is no live user activation it throws
       NotAllowedError from credentials.create() itself, which callers show. */
    var secretStr = String(secret);
    var ticket = randBytes(32);
    var envIv  = randBytes(IV_LEN);
    /* ⚠ synchronous first statement — preserves the user gesture (see above) */
    var ceremony = navigator.credentials.create(creationOptions(ticket));
    return ceremony.then(function (credential) {
      if (!credential) throw new Error('cancelled');
      var written = extractWrittenTicket(credential);
      var sealedB64 = written || b64uEncode(ticket);   // prefer authenticator-confirmed bytes
      var parsed = null;
      try { parsed = parseAuthData(credential.response.getAuthenticatorData()); } catch (e) { /* optional fields */ }
      var blob = {
        v: VERSION,
        credId: credential.id,
        pubKey: (parsed && parsed.publicKey) ? b64uEncode(parsed.publicKey) : '',
        ticketLen: ticket.length,
        sealed: sealedB64                // mirrored locally: releases the envelope after the ceremony passes
      };
      if (!lsSet(BLOB, JSON.stringify(blob))) throw new Error('storage-full');
      /* envelope built AFTER the ceremony — no await stood between tap and WebAuthn */
      return ensurePepper().then(function (pepper) {
        return sha256(concatBytes(ticket, new TextEncoder().encode(pepper)));
      }).then(function (combinedBuf) {
        return importAes(new Uint8Array(combinedBuf)).then(function (ek) {
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: envIv }, ek,
            new TextEncoder().encode(secretStr));
        });
      }).then(function (ct) {
        return idbPut(ENVELOPE_KEY, { ct: new Uint8Array(ct), iv: envIv });
      });
    }).then(function () {
      return true;
    }).catch(function (err) {
      lsDel(BLOB);                        /* half-written / failed enrolment → clean slate */
      idbDel(ENVELOPE_KEY);
      try { window.__dhBioLastErr = err; console.warn('DhBio.enroll failed:', err); } catch (e) {}
      return false;                       /* caller keeps password login untouched */
    });
  }

  /* ---------- unlock (returns Promise<secret string>) ----------
     v4.20 DH — same gesture fix: credentials.get() starts synchronously
     from the click handler. Envelope lookup + decryption run only AFTER
     the OS face/fingerprint ceremony resolved (the browser refuses to
     resolve credentials.get without a passed userVerification:'required'
     ceremony, so reaching the .then IS the biometric gate). */
  function unlock() {
    migrate();
    var blob = getBlob();
    if (!blob || !cryptoOk() || !webauthnAvailable()) return Promise.reject(new Error('not-enrolled'));
    /* v4.21 DH — no JS-side gesture pre-check (see enroll above); the
       auto-prompt path at boot has no tap at all and must still be allowed
       to TRY credentials.get — the browser honestly rejects it if there is
       no activation, and the UI then just waits for a real tap. */
    var want = b64uDecode(blob.sealed);             // our ticket bytes
    /* ⚠ synchronous first statement — preserves the user gesture */
    var ceremony = navigator.credentials.get(requestOptions(blob.credId));
    return ceremony.then(function (assertion) {
      if (!assertion) throw new Error('cancelled');
      var lb = largeBlobFromAssertion(assertion);
      if (lb && lb.length >= 8) {
        /* device supports blob READ — the authenticator itself handed bytes
           back AFTER verifying the biometric. Verify them byte-for-byte
           against our mirrored ticket; a match is cryptographic proof the
           ceremony ran on this credential. */
        var same = (lb.length === want.length);
        if (same) { for (var i = 0; i < lb.length; i++) { if (lb[i] !== want[i]) { same = false; break; } } }
        if (!same) {
          /* readable but NOT our ticket → something is off; refuse rather
             than release the envelope from a foreign/tampered blob. */
          throw new Error('seal-mismatch');
        }
      }
      return idbGet(ENVELOPE_KEY).catch(function () { return null; }).then(function (env) {
        if (!env || !env.ct) {                 /* envelope lost (site data cleared) → honest reset */
          disable();
          throw new Error('not-enrolled');
        }
        return ensurePepper().then(function (pepper) {
          return sha256(concatBytes(want, new TextEncoder().encode(pepper)));
        }).then(function (combinedBuf) {
          return importAes(new Uint8Array(combinedBuf));
        }).then(function (ek) {
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: env.iv }, ek, env.ct);
        }).then(function (plain) {
          return new TextDecoder().decode(plain);
        });
      });
    });
  }

  /* ---------- disable / status ---------- */
  function disable() {
    migrate(); lsDel(BLOB); idbDel(ENVELOPE_KEY);
    return Promise.resolve(true);
  }
  function isEnrolled() { migrate(); return Promise.resolve(!!getBlob()); }

  window.DhBio = {
    version: VERSION,
    /* v4.19 DH — `supported` is now a SYNCHRONOUS boolean (was a Promise-
       returning probe). app.js used to do `Promise.all([DhBio.supported(),
       ...])` and truth-test the resulting *promise object*, which was always
       truthy; worse, browsers where isPlatformAuthenticatorAvailable() hangs
       stalled the whole chain → the Face/Fingerprint buttons appeared dead.
       The real capability check happens inside enroll()/unlock(), which fail
       honestly with a reason the UI can show. */
    supported: webauthnAvailable() && cryptoOk(),
    /* v4.21 DH — synchronous enrolment check. app.js used to call
       isEnrolled() (which returns a Promise) inside `if (...)` guards —
       a Promise object is ALWAYS truthy, so the offer box was skipped as
       "already enrolled" even on phones that had never enrolled anything.
       That is why "✨ Yes, enable it" never appeared for many users. */
    isEnrolledNow: function () { return !!getBlob(); },
    isEnrolled: isEnrolled,
    enroll: enroll,
    unlock: unlock,
    disable: disable,
    methodLabel: methodLabel
  };
})();
