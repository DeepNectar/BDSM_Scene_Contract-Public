/* Login-gate regression test — verifies the password gate actually works:
   1. wrong password  → overlay stays visible + error message shown
   2. empty password  → overlay stays visible + error message shown
   3. correct password → overlay hidden (unlocked)
   Guards against the two known failure modes:
   • js/app.js throwing before handlers are wired → ANY password "logs in"
     silently with no error popup (the original v3.x STORE_KEY crash).
   • a broken SECRET comparison letting everything through. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.confirm = () => true;
window.alert = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

/* offline fake cloud so unlock()'s replay path can't hang or throw */
const serverRows = [];
window.supabase = {
  createClient() {
    return {
      from(t) {
        return {
          select: () => Promise.resolve({ data: JSON.parse(JSON.stringify(serverRows)), error: null }),
          upsert: (row) => { const i = serverRows.findIndex(r => r.k === row.k); if (i >= 0) serverRows[i].v = row.v; else serverRows.push({ k: row.k, v: row.v }); return Promise.resolve({ error: null }); },
        };
      },
    };
  },
};

const scriptErrors = [];
window.eval(fs.readFileSync('js/supabase-config.js', 'utf8'));
try { window.eval(fs.readFileSync('js/cloud.js', 'utf8')); } catch (e) { scriptErrors.push('cloud.js: ' + e.message); }
try { window.eval(fs.readFileSync('js/app.js', 'utf8')); } catch (e) { scriptErrors.push('app.js: ' + e.message); }

(async () => {
  const doc = window.document;
  const overlay = doc.getElementById('login-overlay');
  const pwInput = doc.getElementById('password-input');
  const loginBtn = doc.getElementById('login-btn');
  const errEl = doc.getElementById('login-error');

  const checks = [];
  checks.push(['no script errors at boot (handlers get wired)', scriptErrors.length === 0]);
  if (scriptErrors.length) console.log('   ↳ ' + scriptErrors.join('\n   ↳ '));
  checks.push(['login button + input exist in DOM', !!loginBtn && !!pwInput]);

  /* --- wrong password must NOT unlock and MUST show the error popup --- */
  pwInput.value = 'totally-wrong-password';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 50));
  checks.push(['wrong password: overlay still visible', !overlay.classList.contains('hidden')]);
  checks.push(['wrong password: error message shown', errEl.textContent.trim().length > 0]);
  checks.push(['wrong password: input cleared after attempt', pwInput.value === '']);

  /* --- empty password must not unlock either --- */
  pwInput.value = '';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 50));
  checks.push(['empty password: overlay still visible', !overlay.classList.contains('hidden')]);
  checks.push(['empty password: error message shown', errEl.textContent.trim().length > 0]);

  /* --- near-miss variants must be rejected too --- */
  ['Deepnectar@1612', 'deepnectar@1612@', ' Deepnectar@1612@x'].forEach(pw => {
    pwInput.value = pw;
    loginBtn.click();
    if (overlay.classList.contains('hidden')) checks.push(['variant rejected: ' + JSON.stringify(pw), false]);
  });
  checks.push(['near-miss variants rejected', !overlay.classList.contains('hidden')]);

  /* --- correct password unlocks --- */
  pwInput.value = 'Deepnectar@1612@';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 400));
  checks.push(['correct password: overlay hidden (unlocked)', overlay.classList.contains('hidden')]);
  checks.push(['correct password: error cleared', errEl.textContent.trim() === '']);

  let fail = 0;
  checks.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n); });
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
