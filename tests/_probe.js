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
window.addEventListener('error',e=>console.log('WINDOW ERROR:',e.message));
try{ window.eval(fs.readFileSync('js/app.js','utf8')); }catch(e){ console.log('FATAL:',e.stack.split('\n').slice(0,6).join('\n')); process.exit(1);}
const $=s=>window.document.querySelector(s);
$('#ai-assistant').click();
$('#ai-generate-btn').click();
const apply=$('#ai-apply-btn');
console.log('apply disabled?',apply.disabled);
try{ window.addEventListener('unhandledrejection',e=>console.log('UNHANDLED REJECTION:', e.reason && e.reason.stack ? String(e.reason.stack).split('\n').slice(0,5).join('\n') : e.reason));
process.on('uncaughtException',e=>console.log('UNCAUGHT:',e.stack.split('\n').slice(0,6).join('\n')));
const _ce=window.console.error; window.console.error=(...a)=>{console.log('CONSOLE.ERROR:',a.map(x=>x&&x.stack?String(x.stack).split('\n').slice(0,6).join('\n'):String(x)).join(' '));};
try{ apply.click(); }catch(e){ console.log('CLICK THROW:', e.stack.split('\n').slice(0,6).join('\n')); } }catch(e){ console.log('CLICK THROW:', e.stack.split('\n').slice(0,4).join('\n')); }
console.log('day2 exists sync?',!!$('#day2'));
setTimeout(()=>{console.log('day2 after tick?',!!$('#day2'));process.exit(0);},300);
