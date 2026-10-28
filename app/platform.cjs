"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const execFile=require('node:util').promisify(cp.execFile);
function executable(name,env=process.env,platform=process.platform) {
 if(path.isAbsolute(name))return fs.existsSync(name)?name:null;
 const extensions=platform==='win32'?['.exe','.cmd','.bat','']:[''];
 for(const dir of (env.PATH||env.Path||'').split(platform==='win32'?';':':')) {
  if(!dir)continue;
  for(const ext of extensions){const p=path.join(dir,name+ext);try{if(fs.statSync(p).isFile())return p;}catch{}}
 }
 return null;
}
function validateInput(a) {
 if(!a||typeof a!=='object'||!['status','move','click','drag','scroll','type','key'].includes(a.action))throw Error('Unsupported native action');
 for(const k of ['x','y','toX','toY'])if(a[k]!==undefined&&(!Number.isFinite(a[k])||Math.abs(a[k])>50000))throw Error('Invalid desktop coordinates');
 if(['move','click','drag'].includes(a.action)&&(!Number.isFinite(a.x)||!Number.isFinite(a.y)))throw Error('Pointer coordinates are required');
 if(a.action==='drag'&&(!Number.isFinite(a.toX)||!Number.isFinite(a.toY)))throw Error('Drag destination is required');
 if(a.action==='type'&&(typeof a.text!=='string'||a.text.length>8000))throw Error('Text limit exceeded');
 if(a.button!==undefined&&!['left','right'].includes(a.button))throw Error('Invalid mouse button');
 if(a.count!==undefined&&![1,2].includes(a.count))throw Error('Invalid click count');
 for(const k of ['dx','dy'])if(a[k]!==undefined&&(!Number.isInteger(a[k])||Math.abs(a[k])>10000))throw Error('Scroll limit exceeded');
 if(a.modifiers!==undefined&&(!Array.isArray(a.modifiers)||a.modifiers.some(x=>!['command','control','option','shift'].includes(x))))throw Error('Unsupported modifier');
 return a;
}
function x11Key(a) {
 const keys={enter:'Return',tab:'Tab',space:'space',backspace:'BackSpace',escape:'Escape',left:'Left',right:'Right',up:'Up',down:'Down',delete:'Delete',home:'Home',end:'End',pageup:'Prior',pagedown:'Next'};
 const key=String(a.key||'').toLowerCase(),code=keys[key]||(/^[a-z]$/.test(key)?key:null);
 if(!code)throw Error('Unsupported key');
 const mods={command:'super',control:'ctrl',option:'alt',shift:'shift'};
 return [...(a.modifiers||[]).map(m=>mods[m]),code].join('+');
}
async function linuxInput(a) {
 validateInput(a);
 const wayland=process.env.XDG_SESSION_TYPE==='wayland'||!!process.env.WAYLAND_DISPLAY;
 const tool=executable('xdotool'),ready=!!process.env.DISPLAY&&!!tool&&!wayland;
 if(a.action==='status')return {platform:'linux',accessibility:ready,inputAvailable:ready,screenRecording:false,session:wayland?'wayland':'x11',message:wayland?'Wayland input requires a compositor-specific consent integration and is not available in this release. Screen capture may use the desktop portal.':ready?'X11 native input is available.':'Install xdotool and run inside an X11 desktop to enable input.'};
 if(!ready)throw Error(wayland?'Native input is unavailable on Wayland. Use an X11 session; permissions are not bypassed.':'X11 input needs DISPLAY and the xdotool system package.');
 const run=args=>execFile(tool,args,{timeout:15000,maxBuffer:65536});
 const point=(x,y)=>['mousemove','--sync',String(Math.round(x)),String(Math.round(y))];
 if(a.action==='move')await run(point(a.x,a.y));
 else if(a.action==='click'){await run(point(a.x,a.y));await run(['click','--repeat',String(a.count||1),'--delay','70',a.button==='right'?'3':'1']);}
 else if(a.action==='drag'){await run(point(a.x,a.y));await run(['mousedown','1']);try{await run(point(a.toX,a.toY));}finally{await run(['mouseup','1']);}}
 else if(a.action==='scroll'){for(const [value,negative,positive]of [[a.dy||0,'5','4'],[a.dx||0,'6','7']])if(value)await run(['click','--repeat',String(Math.min(100,Math.max(1,Math.ceil(Math.abs(value)/120)))),'--delay','10',value<0?negative:positive]);}
 else if(a.action==='type'){if(a.text)await run(['type','--clearmodifiers','--delay','1','--',a.text]);}
 else if(a.action==='key')await run(['key','--clearmodifiers',x11Key(a)]);
 return {ok:true,action:a.action};
}
async function windowsInput(helper,input) {
 validateInput(input);
 return new Promise((resolve,reject)=>{
  const child=cp.spawn(helper,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Native input timed out'));},15000);
  child.stdout.on('data',b=>{out+=b;if(out.length>131072){child.kill();finish(Error('Native response too large'));}});
  child.stderr.on('data',b=>{err=(err+b).slice(-4096);});child.stdin.on('error',e=>finish(e));
  child.on('error',e=>finish(e));child.on('close',code=>{if(code)return finish(Error(err||'Windows input failed'));try{finish(null,JSON.parse(out));}catch{finish(Error('Invalid native response'));}});
  child.stdin.end(JSON.stringify(input));
 });
}
async function openApplication(name) {
 if(typeof name!=='string'||!/^[a-zA-Z0-9 ._-]{1,100}$/.test(name)||name.startsWith('-'))throw Error('Invalid application name');
 if(process.platform==='darwin')await execFile('/usr/bin/open',['-a',name],{timeout:12000});
 else if(process.platform==='linux'){
  const launch=executable('gtk-launch');if(!launch)throw Error('Linux application launching requires gtk-launch and an installed desktop application ID.');
  await execFile(launch,[name],{timeout:12000});
 } else if(process.platform==='win32'){
  const aliases={'textedit':'notepad.exe','text editor':'notepad.exe','calculator':'calc.exe'};
  const target=aliases[name.toLowerCase()]||name;
  if(!/^[a-zA-Z0-9_.-]+$/.test(target))throw Error('Use an executable name on PATH, such as notepad.exe.');
  const file=executable(target);if(!file||!/\.exe$/i.test(file))throw Error('Application executable was not found on PATH.');
  await new Promise((resolve,reject)=>{const c=cp.spawn(file,[],{detached:true,stdio:'ignore'});c.once('error',reject);c.once('spawn',()=>{c.unref();resolve();});});
 } else throw Error('Unsupported platform');
 return {text:'Application launch requested'};
}
function childEnvironment(env=process.env) {
 const out={};
 for(const key of ['PATH','Path','HOME','USERPROFILE','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','APPDATA','LOCALAPPDATA','DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','XDG_SESSION_TYPE','DBUS_SESSION_BUS_ADDRESS'])if(env[key]!==undefined)out[key]=env[key];
 out.LANG=env.LANG||'en_US.UTF-8';return out;
}
module.exports={executable,validateInput,x11Key,linuxInput,windowsInput,openApplication,childEnvironment};
