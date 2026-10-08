/* Debug: load app, mark day1 finished, open email modal, dump result. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
let src = fs.readFileSync('js/app.js', 'utf8');
src = src.replace("    renderModal();\n    openModal();", "    window.__out = out; renderModal(); openModal();");

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true; w.alert = m => console.log('ALERT:', String(m).slice(0, 200));
w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){} }));
let F = {}, D = [], A = {};
w.CloudStore = { ready: true, fields: () => F, saveFields: f => { F = f; return Promise.resolve(true); }, days: () => D, saveDays: l => { D = l; return Promise.resolve(true); }, accepts: () => A, saveAccepts: a => { A = a; return Promise.resolve(true); }, load: async () => ({}), save: async () => true, wiped: () => false };
w.fetch = async () => ({ ok: true, blob: async () => ({ size: 10, type: 'image/png' }) });
if (!w.URL.createObjectURL) { w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; }
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, fillRect() {} });
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,TINYEMBED';
class FakeImg { constructor(){ this._s=''; } set src(v){ this._s=v; setTimeout(()=>this.onload&&this.onload(),0);} get src(){return this._s;} }
w.Image = FakeImg;
const errs = []; w.addEventListener('error', e => errs.push(String(e.message)));
process.on('uncaughtException', e => console.log('UNCAUGHT:', e.stack.split('\n').slice(0,5).join('\n')));

try { w.eval(src); } catch (e) { console.log('FATAL eval:', e.message); process.exit(1); }
const $ = s => w.document.querySelector(s);
(async () => {
  await new Promise(r => setTimeout(r, 300));
  const fin = $('#df-day1');
  console.log('df-day1 exists?', !!fin);
  if (fin) { fin.value = 'yes'; fin.dispatchEvent(new w.Event('change', { bubbles: true })); }
  $('#email-contract').click();
  await new Promise(r => setTimeout(r, 1500));
  console.log('modal active?', $('#email-modal') && $('#email-modal').classList.contains('active'));
  console.log('__out?', typeof w.__out, w.__out && (w.__out.html || '').length);
  console.log('errors:', errs.slice(0, 5));
  process.exit(0);
})();
