const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.confirm=()=>true;w.alert=()=>{};
w.fetch=async()=>({ok:true,status:204,json:async()=>[],text:async()=>''});
const dmyPill=()=>`<span class="datetime-group"><input maxlength="2"><i>/</i><input maxlength="2"><i>/</i><input maxlength="4"></span>`;
const sec=w.document.createElement('section');sec.className='page';sec.id='day7';
sec.innerHTML=`<div class="page-head"><h2>Day 7 · Fri, Oct 9, 2026</h2></div>
<h3 class="section-title">Pre-Scene Execution Affidavit — Day 7</h3>
<p class="exec-line">${dmyPill()}</p>
<div class="love-stamp"></div>`;
w.document.body.appendChild(sec);
w.eval(fs.readFileSync('js/logbook.js','utf8'));
setTimeout(()=>{
 const form=sec.querySelector('.lb-form');
 console.log('form?',!!form);
 if(form){
   console.log('innerHTML length',form.innerHTML.length);
   console.log('first 500:',form.innerHTML.slice(0,500));
   console.log('fieldsets',form.querySelectorAll('fieldset').length);
   console.log('labels',form.querySelectorAll('label.lb-fld').length);
 }
 process.exit(0);
},400);
