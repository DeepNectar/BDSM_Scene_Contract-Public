const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html','utf8');
let src = fs.readFileSync('js/app.js','utf8');

// expose buildEmail output for testing (exact match at lines 1347-1348)
src = src.replace("    renderModal();\n    openModal();", "    window.__out = out; renderModal(); openModal();");

const dom = new JSDOM(html, { runScripts: 'outside-only' });
const w = dom.window;
w.CloudStore = { load: async () => null, saveFields: async()=>{}, saveAccepts: async()=>{}, saveDays: async()=>{}, fields: () => ({}), accepts: () => ({}), days: () => [] };
w.fetch = async () => ({ ok: true, blob: async () => ({ size: 10, type: 'image/png' }) });
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage(){} });
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,TINYEMBED';
class FakeImg { constructor(){ this._s=''; } set src(v){ this._s=v; setTimeout(()=>this.onload&&this.onload(),0);} get src(){return this._s;} }
w.Image = FakeImg;
w.navigator.clipboard = { writeText: async()=>{} };
try { w.eval(src); } catch(e){ console.log('EVAL ERR:', e.message); process.exit(1); }
w.document.querySelectorAll('.day-finished-select').forEach(s => s.value='yes');
const firstSel = w.document.querySelector('.day-finished-select');
const page = w.document.getElementById(firstSel.dataset.day);
page.classList.add('day-collapsed');
const inp = page.querySelector('input[type="text"]');
if (inp) inp.value = 'Collapsed-day value';
setTimeout(async () => {
  try {
    const emailBtn = w.document.getElementById('email-contract');
    emailBtn.click();
    await new Promise(r => setTimeout(r, 500));
    const out = w.__out;
    if (!out) return console.log('NO OUTPUT');
    console.log('HTML drive refs:', (out.html.match(/Google Drive|drive\.google\.com/gi)||[]).length);
    console.log('HTML img count:', (out.html.match(/<img /g)||[]).length);
    console.log('Has base64 embeds:', out.html.includes('data:image/jpeg;base64'));
    console.log('Has SVG fallback:', out.html.includes('data:image/svg+xml'));
    console.log('Plain drive refs:', (out.plain.match(/drive\.google|Google Drive/gi)||[]).length);
    console.log('Collapsed day value in HTML:', out.html.includes('Collapsed-day value'));
    console.log('Contract Overview section:', out.html.includes('Contract Overview'));
    console.log('Page still collapsed after export:', page.classList.contains('day-collapsed'));
    fs.writeFileSync('/tmp/email_preview.html', out.html);
    console.log('WROTE /tmp/email_preview.html');
  } catch(e){ console.log('RUN ERR:', e.message); }
}, 200);
