/* End-to-end flow test: AI modal opens, subchips built, generate + create day,
   delete-day button present & working, email modal opens with styled HTML. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
let src = fs.readFileSync('js/app.js', 'utf8');
src = src.replace('    renderModal();\n    openModal();', '    window.__out=out; renderModal(); openModal();');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true;
w.alert = () => {};

let F = {}, D = [], A = {};
w.CloudStore = {
  ready: true,
  fields: () => F,
  saveFields(f) { F = f; return Promise.resolve(true); },
  days: () => D,
  saveDays(l) { D = l; return Promise.resolve(true); },
  accepts: () => A,
  saveAccepts(a) { A = a; return Promise.resolve(true); },
  load: async () => ({ fields: {}, accepts: {}, days: [] }),
};
w.fetch = async () => ({ ok: true, blob: async () => ({ size: 10, type: 'image/png' }) });
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,TINYEMBED';
class FakeImg { constructor() { this._s = ''; } set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._s; } }
w.Image = FakeImg;

const errors = [];
w.addEventListener('error', e => errors.push(String(e.message)));

try { w.eval(src); } catch (e) { console.log('FATAL eval:', e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); }

setTimeout(async () => {
  const results = [];
  const check = (name, cond) => results.push([name, !!cond]);
  const $ = s => w.document.querySelector(s);
  const $$ = (s, r) => Array.from((r || w.document).querySelectorAll(s));

  /* 1 — AI assistant */
  $('#ai-assistant').click();
  check('AI modal opens on click', $('#ai-modal').classList.contains('active'));
  check('AI subcategory chips built (>20)', $$('.ai-subchips .ai-chip', w.document).length > 20);
  $('#ai-generate-btn').click();
  check('AI preview rendered', ($('#ai-preview').textContent || '').trim().length > 50);
  const apply = $('#ai-apply-btn');
  check('Apply enabled after generate', !apply.disabled);
  apply.click();
  check('New day page created (#day2)', !!$('#day2'));
  check('Delete-day button present on new day', !!$('#day2 .delete-day-btn'));
  check('Clear-day button present on new day', !!$('#day2 .clear-day-btn'));

  /* recreate for email test after verifying delete */
  $('#day2 .delete-day-btn').click();
  check('Day deleted from DOM', !$('#day2'));
  check('Cloud day list pruned', !D.find(d => d.id === 'day2'));

  /* re-create a day so the contract has two days again */
  $('#ai-generate-btn').click();
  $('#ai-apply-btn').click();
  check('Day recreated (#day2)', !!$('#day2'));

  /* Day 1 delete protection */
  const staticDel = $('#day1 .delete-day-btn');
  check('Day 1 has NO delete button (protected)', !staticDel);

  /* 2 — Email export */
  w.document.querySelectorAll('.day-finished-select').forEach(s => s.value = 'yes');
  $('#email-contract').click();
  await new Promise(r => setTimeout(r, 600));
  check('Email modal opens', $('#email-modal').classList.contains('active'));
  const out = w.__out || {};
  check('HTML export generated', (out.html || '').length > 3000);
  check('HTML has tables', (out.html.match(/<table/g) || []).length >= 5);
  check('HTML has gradient banner', (out.html || '').includes('linear-gradient'));
  check('HTML has safeword pills', /RED/.test(out.html || '') && /YELLOW/.test(out.html || ''));
  check('Plain text export present', (out.plain || '').length > 300);
  /* HTML tab renders markup in modal body */
  const tabs = Array.from(w.document.querySelectorAll('.modal-tabs button'));
  tabs.find(b => b.dataset.format === 'html').click();
  check('HTML tab shows markup in modal', $('#modal-body').innerHTML.includes('<table'));

  console.log('\n--- FLOW TEST RESULTS ---');
  let fail = 0;
  results.forEach(([n, ok]) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n); });
  if (errors.length) { console.log('\nRuntime errors:'); errors.forEach(e => console.log('  • ' + e)); }
  console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURES`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
}, 300);
