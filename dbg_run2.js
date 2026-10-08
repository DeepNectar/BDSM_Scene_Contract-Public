const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;
window.confirm=()=>true;window.alert=()=>{};
let F={},D=[],A={};
window.CloudStore={ready:true,fields:()=>F,saveFields(f){F=f;return Promise.resolve(true);},days:()=>D,saveDays(l){D=l;return Promise.resolve(true);},accepts:()=>A,saveAccepts(a){A=a;return Promise.resolve(true);},wiped:()=>false,load:async()=>({}),save:async()=>true,saveWiped:()=>Promise.resolve(true)};
window.fetch=async()=>({ok:true,blob:async()=>({size:10,type:'image/png'})});
window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},fillRect(){}});
window.HTMLCanvasElement.prototype.toDataURL=()=>'data:image/jpeg;base64,TINY';
class FakeImg{constructor(){this._s='';}set src(v){this._s=v;setTimeout(()=>this.onload&&this.onload(),0);}get src(){return this._s;}}
window.Image=FakeImg;
try{ window.eval(fs.readFileSync('js/app.js','utf8')); }catch(e){ console.log('FATAL:',e.stack.split('\n').slice(0,6).join('\n')); process.exit(1);} 
$('#ai-assistant').click();
$('#ai-generate-btn').click();
console.log('apply disabled?', $('#ai-apply-btn').disabled);
$('#ai-apply-btn').click();
console.log('day2 exists sync?', !!$('#day2'));
console.log('pages:', Array.from(window.document.querySelectorAll('.page')).map(p=>p.id).join(','));
process.exit(0);
function $(s){return window.document.querySelector(s);}
