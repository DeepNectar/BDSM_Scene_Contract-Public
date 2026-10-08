const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true});
const {window}=dom;
window.confirm=()=>true;window.alert=m=>console.log('ALERT:',String(m).slice(0,120));
let F={},D=[],A={};
window.CloudStore={ready:true,fields:()=>F,saveFields:f=>{F=f;return Promise.resolve(true)},days:()=>D,saveDays:l=>{D=l;return Promise.resolve(true)},accepts:()=>A,saveAccepts:a=>{A=a;return Promise.resolve(true)},load:async()=>({fields:{},days:[]}),save:async()=>true};
window.__dhReady=false;
window.onerror=(m,s,l,c,e)=>{console.log('WINDOW ERROR:',m,'@',s,l, e&&e.stack?e.stack.split('\n').slice(0,3).join('\n'):'');};
process.on('uncaughtException',e=>console.log('UNCAUGHT:',e.stack.split('\n').slice(0,5).join('\n')));
window.document.addEventListener('DOMContentLoaded',async()=>{
  try{ window.eval(fs.readFileSync('js/app.js','utf8')); }catch(e){console.log('EVAL FATAL:',e.stack.split('\n').slice(0,4).join('\n'));}
  console.log('dhReady=',window.__dhReady);
  const $=s=>window.document.querySelector(s);
  $('#ai-assistant').click();
  const gen=$('#ai-generate-btn'); gen.click();
  const apply=$('#ai-apply-btn'); if(apply&&!apply.disabled) apply.click();
  const day2=$('#day2');
  console.log('day2 exists:',!!day2);
  const del=day2?day2.querySelector('.delete-day-btn'):null;
  console.log('del btn:',del&&del.outerHTML.slice(0,90));
  if(del) del.click();
  await new Promise(r=>setTimeout(r,100));
  console.log('after click day2 exists:',!!$('#day2'));
  console.log('D list:',JSON.stringify(D.map(d=>d.id)));
  process.exit(0);
});
setTimeout(()=>{console.log('TIMEOUT');process.exit(1);},15000);
