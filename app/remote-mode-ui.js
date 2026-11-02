'use strict';
(function(){
const api=window.bridge;
const $=id=>document.getElementById(id);
const mode=$('remote-mode'),named=$('named-tunnel-fields'),result=$('remote-mode-status');
function display(){const m=mode.value;named.hidden=m!=='named';$('remote-mode-save').disabled=m==='ssh';}
mode.addEventListener('change',display);
api.remoteModeRead().then(c=>{
 mode.value=c.mode||'temporary';
 $('remote-hostname').value=c.publicOrigin||'';
 $('remote-yaml').value=c.configFile||'';
 $('remote-port').value=c.localPort||17775;
 $('remote-autoconnect').checked=c.autoConnect===true;
 result.textContent=c.mode==='named'
  ?'Named Cloudflare mode saved. This hostname is fixed, but the domain and YAML must be configured in Cloudflare.'
  :c.mode==='local'?'Local-only MCP is configured; no public tunnel starts.'
  :c.mode==='ssh'?'Existing VPS relay is configured. Settings are read-only here.'
  :'Temporary Cloudflare mode is active; its URL changes when the tunnel restarts.';
 display();
}).catch(e=>{result.textContent='Could not inspect MCP mode: '+e.message;display();});
$('remote-mode-save').addEventListener('click',async()=>{
 const previous=result.textContent;
 result.textContent='Validating and saving configuration…';
 try{
  const c={mode:mode.value,autoConnect:$('remote-autoconnect').checked};
  if(c.mode==='named'){
   c.publicOrigin=$('remote-hostname').value.trim();
   c.configFile=$('remote-yaml').value.trim();
   c.localPort=Number($('remote-port').value);
  }
  const saved=await api.remoteModeSave(c);
  result.textContent=saved.message;
 }catch(e){result.textContent='Not saved: '+(e.message||String(e))||previous;}
});
})();
