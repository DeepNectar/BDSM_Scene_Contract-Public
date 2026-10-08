const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.confirm = () => true;
window.alert = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message)+' @ '+e.filename+':'+e.lineno));
let F={},D=[],A={};
window.CloudStore = { ready:true, fields:()=>F, saveFields(f){F=f;return Promise.resolve(true);}, days:()=>D, saveDays(l){D=l;return Promise.resolve(true);}, accepts:()=>A, saveAccepts(a){A=a;return Promise.resolve(true);}, wiped:()=>false, load:async()=>({}), saveWiped:async()=>true };
try { window.eval(fs.readFileSync('js/app.js','utf8')); } catch(e){ console.log('FATAL:', e.stack.split('\n').slice(0,6).join('\n')); process.exit(1);}
const $ = s => window.document.querySelector(s);
const $$ = s => Array.from(window.document.querySelectorAll(s));
$('#ai-assistant').click();
console.log('modal active:', $('#ai-modal')?.classList.contains('active'));
const genBtn = $('#ai-generate-btn');
genBtn.click();
console.log('preview len:', ($('#ai-preview')?.textContent||'').trim().length);
const applyBtn = $('#ai-apply-btn');
console.log('apply disabled?', applyBtn.disabled);
applyBtn.click();
console.log('day2 exists:', !!$('#day2'));
console.log('errors so far:', errors);
// email
(async()=>{
  const fin=$('#df-day1'); if(fin){fin.value='yes'; fin.dispatchEvent(new window.Event('change',{bubbles:true}));}
  try { $('#email-contract').click(); } catch(e){ console.log('email click threw:', e.message); }
  await new Promise(r=>setTimeout(r,900));
  console.log('email modal active:', $('#email-modal')?.classList.contains('active'));
  console.log('modal-body len:', ($('#modal-body')?.innerHTML||'').length);
  console.log('final errors:', errors.slice(0,10));
})();
