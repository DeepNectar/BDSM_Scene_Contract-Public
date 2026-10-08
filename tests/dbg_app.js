const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.confirm = () => true; window.alert = () => {};
window.matchMedia = window.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));
const errors = [];
window.addEventListener('error', e => errors.push(String(e.message) + ' @' + (e.filename||'') + ':' + (e.lineno||'')));
const src = fs.readFileSync('js/app.js', 'utf8');
let F={},D=[],A={};
window.CloudStore = { ready:true, fields:()=>F, saveFields(f){F=f;return Promise.resolve(true);}, days:()=>D, saveDays(l){D=l;return Promise.resolve(true);}, accepts:()=>A, saveAccepts(a){A=a;return Promise.resolve(true);}, wiped:()=>false, load:async()=>({}), };
try { window.eval(src); } catch(e){ console.log('FATAL eval:', e.stack.split('\n').slice(0,5).join('\n')); process.exit(1);}
setTimeout(()=>{
  console.log('captured window errors:', errors);
  const $ = s => window.document.querySelector(s);
  $('#ai-assistant').click();
  $('#ai-generate-btn').click();
  $('#ai-apply-btn').click();
  setTimeout(()=>{
    console.log('day2 exists?', !!$('#day2'));
    console.log('errors after flow:', errors);
    // email flow
    const fin = $('#df-day2'); if(fin){fin.value='yes'; fin.dispatchEvent(new window.Event('change',{bubbles:true}));}
    $('#email-contract').click();
    setTimeout(()=>{
      console.log('modal active?', $('#email-modal')?.classList.contains('active'));
      console.log('errors final:', errors);
      console.log('toast text:', $('#toast')?.textContent);
    }, 1500);
  }, 300);
}, 500);
