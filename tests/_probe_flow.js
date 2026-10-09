const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');
let src = fs.readFileSync('js/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.confirm = () => true; w.alert = () => {};
w.CloudStore = { ready:true, fields:()=>({}), saveFields(){return Promise.resolve(true)}, days:()=>[], saveDays(){return Promise.resolve(true)}, accepts:()=>({}), saveAccepts(){return Promise.resolve(true)}, load: async()=>null };
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage(){}, measureText(){return{width:50}}, set font(v){} });
try { w.eval(src); } catch(e){ console.log('FATAL eval:', e.message); }
setTimeout(() => {
  const $ = s => w.document.querySelector(s);
  $('#ai-assistant').click();
  $('#ai-generate-btn').click();
  $('#ai-apply-btn').click();
  console.log('day2 exists:', !!$('#day2'));
  console.log('day2 delete btn:', !!$('#day2 .delete-day-btn'));
  console.log('day1 delete btn:', !!$('#day1 .delete-day-btn'));
  console.log('all pages:', Array.from(w.document.querySelectorAll('.page')).map(p=>p.id));
}, 300);
