/* Smoke test: load index.html + app.js in jsdom, click the toolbar buttons,
   verify AI modal opens, a day is created (with Delete-day button), delete works,
   and the Email-data modal renders styled HTML. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

window.confirm = () => true;                 // auto-accept deletes
window.alert  = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){} }));
if (!window.crypto) window.crypto = {};
if (!window.crypto.subtle) Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)));

const src = fs.readFileSync('js/app.js', 'utf8');

/* ---------- test stubs for the cloud layer (normally js/cloud.js) ---------- */
window.CloudStore = null;
{
  let F = {}, D = [], A = {};
  window.CloudStore = {
    ready: true,
    fields: () => F,
    saveFields(f) { F = f; return Promise.resolve(true); },
    days: () => D,
    saveDays(list) { D = list; return Promise.resolve(true); },
    accepts: () => A,
    saveAccepts(a) { A = a; return Promise.resolve(true); },
    load: async () => ({ fields: {}, days: [] }),
    save: async () => true,
  };
}

/* image-embed stubs so buildEmail works headless (same as test_flow.js) */
window.fetch = async () => ({ ok: true, blob: async () => ({ size: 10, type: 'image/png' }) });
if (!window.URL.createObjectURL) { window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {}; }
window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, fillRect() {} });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,TINYEMBED';
class FakeImg { constructor(){ this._s=''; } set src(v){ this._s=v; setTimeout(()=>this.onload&&this.onload(),0);} get src(){return this._s;} }
window.Image = FakeImg;

try { window.eval(src); } catch (e) { console.log('FATAL during app init:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }

const $ = s => window.document.querySelector(s);
const $$ = s => Array.from(window.document.querySelectorAll(s));
const results = [];
const check = (name, cond) => { results.push([name, !!cond]); };

/* ---------- 1. AI write a day button opens modal & generates ---------- */
$('#ai-assistant').click();
check('AI modal opens on click', $('#ai-modal').classList.contains('active'));
check('AI subcategory chips built', $$('[data-cat] .ai-chip').length > 20);

const genBtn = $('#ai-generate-btn') || $$('.ai-card button').find(b => /generate|draft|write/i.test(b.textContent));
check('Generate button exists', !!genBtn);
if (genBtn) genBtn.click();
check('AI preview rendered', ($('#ai-preview')?.textContent || '').trim().length > 50);

const applyBtn = $('#ai-apply-btn');
check('Apply button enabled after generate', applyBtn && !applyBtn.disabled);
if (applyBtn) applyBtn.click();

const newDay = $('#day2');
check('New day page created (#day2)', !!newDay);
check('Delete-day button present on new day', !!$('.delete-day-btn', newDay || window.document));

/* ---------- 2. Delete day works ---------- */
const delBtn = $('.delete-day-btn');
if (delBtn) delBtn.click();
check('Day deleted from DOM', !$('#day2'));

/* ---------- 3. Email data button renders modal ---------- */
(async () => {
  /* mark Day 1 as finished so the exporter has data (same flow a user follows) */
  const fin = $('#df-day1');
  if (fin) { fin.value = 'yes'; fin.dispatchEvent(new window.Event('change', { bubbles: true })); }
  $('#email-contract').click();
  await new Promise(r => setTimeout(r, 1500));
  check('Email modal opens', $('#email-modal').classList.contains('active'));
  const bodyHtml = $('#modal-body')?.innerHTML || '';
  check('Email preview has styled HTML (tables/gradients)', /background|linear-gradient|<table/i.test(bodyHtml));

  /* switch to HTML tab if present */
  const htmlTab = $$('.modal-tabs button').find(b => b.dataset.format === 'html');
  if (htmlTab) htmlTab.click();
  check('HTML format tab shows markup', /\bDOCTYPE\b|<table/i.test($('#modal-body')?.textContent || $('#modal-body')?.innerHTML || ''));

  console.log('\n--- SMOKE TEST RESULTS ---');
  let fail = 0;
  results.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n); });
  if (errors.length) { console.log('\nRuntime errors captured:'); errors.slice(0, 10).forEach(e => console.log('  • ' + e)); }
  console.log(`\n${results.length - fail}/${results.length} checks passed`);
  process.exit(fail || errors.length ? 1 : 0);
})();
