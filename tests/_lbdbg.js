const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.confirm=()=>true;w.alert=()=>{};
w.fetch=async()=>({ok:true,status:204,json:async()=>[],text:async()=>''});
const dmyPill=()=>`<span class="datetime-group"><input maxlength="2"><i>/</i><input maxlength="2"><i>/</i><input maxlength="4"></span>`;
const sec=w.document.createElement('section');sec.className='page';sec.id='day7';
sec.innerHTML=`<div class="page-head"><h2>Day 7 · Fri, Oct 9, 2026</h2></div>
<h3 class="section-title">Pre-Scene Execution Affidavit — Day 7</h3>
<p class="exec-line">${dmyPill()} <span class="datetime-group time-group"><input maxlength="2"><i>:</i><input maxlength="2"></span></p>
<div class="love-stamp"></div>`;
w.document.body.appendChild(sec);
try{w.eval(fs.readFileSync('js/logbook.js','utf8'));}catch(e){console.log('MODULE THREW:',e.message);}
setTimeout(()=>{
 const form=sec.querySelector('.lb-form');
 console.log('form?',!!form);
 if(form){
   console.log('labels total',form.querySelectorAll('label.lb-fld').length);
   ['dailyBody','sceneBody'].forEach(s=>{
     form.querySelectorAll(`label[data-sheet="${s}"]`).forEach(l=>{
       const ctl=l.querySelector('.lb-fld-ctl > *');
       console.log(s,'col',l.dataset.col,'kind',l.dataset.kind,'ctl?',!!ctl, ctl?ctl.outerHTML.slice(0,60):'NULL');
     });
   });
 }
},400);
