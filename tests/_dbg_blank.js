const fs = require('fs');
const { JSDOM } = require('jsdom');
const htmlSrc = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(htmlSrc, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true; w.alert = () => {};
w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
let F={},D=[],A={};
w.CloudStore = { ready:true, fields:()=>F, saveFields(f){F=f;return Promise.resolve(true);},
  days:()=>D, saveDays(l){D=l;return Promise.resolve(true);}, setMirrorDays(l){D=l;return Promise.resolve(true);},
  accepts:()=>A, saveAccepts(a){A=a;return Promise.resolve(true);}, load:async()=>({}), refresh:async()=>({fields:F,accepts:A,days:D}) };
try { w.eval(fs.readFileSync('js/app.js','utf8')); } catch(e){ console.log('EVAL FAIL', e.message); process.exit(1); }
setTimeout(() => {
  const host = w.document.createElement('div');
  host.innerHTML = '<button id="empty-blank-btn" type="button">➕ Add blank day</button>';
  w.document.body.appendChild(host);
  try { w.document.getElementById('empty-blank-btn').click(); } catch(e){ console.log('CLICK THREW:', e.message); }
  console.log('day2 present:', !!w.document.getElementById('day2'), 'pages:', w.document.querySelectorAll('.page').length);
  console.log('errors:', []);
}, 500);
