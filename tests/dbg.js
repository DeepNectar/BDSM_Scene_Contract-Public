const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('/workspace/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;
window.confirm=()=>true;window.alert=()=>{};
window.matchMedia=window.matchMedia||(()=>({matches:false,addListener(){},removeListener(){}}));
const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)+' @ '+e.filename+':'+e.lineno));
let F={},D=[],A={};
window.CloudStore={ready:true,fields:()=>F,saveFields:f=>{F=f;return Promise.resolve(true)},days:()=>D,saveDays:l=>{D=l;return Promise.resolve(true)},accepts:()=>A,saveAccepts:a=>{A=a;return Promise.resolve(true)},load:async()=>({fields:{},days:[]}),save:async()=>true};
try{window.eval(fs.readFileSync('/workspace/js/app.js','utf8'));}catch(e){console.log('FATAL',e.stack.split('\n').slice(0,5).join('\n'));process.exit(1);}
const $=s=>window.document.querySelector(s);
(async()=>{
  const fin=$('#df-day1');fin.value='yes';fin.dispatchEvent(new window.Event('change',{bubbles:true}));
  $('#email-contract').click();
  await new Promise(r=>setTimeout(r,1200));
  console.log('modal active:',$('#email-modal')?.className);
  console.log('body len:',($('#modal-body')?.innerHTML||'').length);
  console.log('body start:',(($('#modal-body')?.innerHTML)||'').slice(0,200));
  console.log('errors:',errors.slice(0,5));
})();
