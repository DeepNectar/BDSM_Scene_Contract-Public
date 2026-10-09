const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.confirm=()=>true;w.alert=()=>{};
w.fetch=async()=>({ok:true,status:204,json:async()=>[],text:async()=>''});
const dmyPill='<span class="datetime-group"><input maxlength="2"><i>/</i><input maxlength="2"><i>/</i><input maxlength="4"></span>';
const sec=w.document.createElement('section');sec.className='page';sec.id='day7';
sec.innerHTML='<div class="page-head"><h2>Day 7 · Fri, Oct 9, 2026</h2></div><h3 class="section-title">Pre-Scene Execution Affidavit — Day 7</h3><p class="exec-line">'+dmyPill+'</p><div class="love-stamp"></div>';
w.document.body.appendChild(sec);
w.eval(fs.readFileSync('js/logbook.js','utf8'));
setTimeout(()=>{
 const form=sec.querySelector('.lb-form');
 if (form == null) { console.log('NO FORM'); process.exit(1); }
 const labs=[...form.querySelectorAll('label.lb-fld')];
 console.log('labels',labs.length,'fieldsets',form.querySelectorAll('fieldset').length);
 let missing=0;
 for(const l of labs){
   const c=l.querySelector('.lb-fld-ctl > *');
   if (c == null) { missing++; console.log('MISSING CTL sheet='+l.dataset.sheet+' col='+l.dataset.col+' kind='+l.dataset.kind+' inner='+l.innerHTML.slice(0,140)); }
 }
 console.log('missing',missing);
 process.exit(0);
},500);
