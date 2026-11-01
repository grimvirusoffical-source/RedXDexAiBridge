'use strict';
const api=window.bridge,$=id=>document.getElementById(id);let state,selectedClient='',remote={phase:'off'},terminalId,timer,toastTimer;
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function toast(text,error=false){$('toast').textContent=text;$('toast').hidden=false;$('toast').style.borderColor=error?'#f25768':'';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,9000);}
async function attempt(fn){try{return await fn();}catch(e){toast(e.message,true);return null;}}
function page(id){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-'+id);document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id));$('page-label').textContent=document.querySelector('[data-page="'+id+'"]')?.textContent.replace(/\d+$/,'').trim()||id;}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>page(b.dataset.page));
const capabilities={list:['Browse folders','List names and file metadata within approved roots.'],read:['Read files','Read file contents inside approved folders.'],write:['Manage files','Create, edit, move and trash files.'],terminal:['Terminal & processes','Not sandboxed: commands can access anything your OS account can.'],crawl:['Website crawling','Background crawling of public pages, bounded by robots.txt and network restrictions.'],screenshot:['View screen','Capture the current desktop. Screens may contain private information.'],mouse:['Control mouse','Move, click, drag and scroll.'],keyboard:['Control keyboard','Type text and press keyboard shortcuts.'],apps:['Launch apps','Open named applications.']};
async function save(){state.settings=await api.save(state.settings);renderSettings();}
function renderSettings(){
 const s=state.settings;$('stop-banner').hidden=!s.emergencyStop;$('global-status').textContent=s.emergencyStop?'COMPUTER TOOLS STOPPED':'PERMISSIONS ACTIVE';$('keep-running').checked=!!s.keepRunning;$('launch-login').checked=!!s.launchAtLogin;$('start-hidden').checked=!!s.startHidden;$('background-only').checked=!!s.backgroundOnly;for(const [id,key]of [['max-processes','maxProcesses'],['max-processes-client','maxProcessesPerClient'],['max-requests','maxConcurrentRequests'],['max-requests-client','maxRequestsPerClient']])$(id).value=s[key];$('client-execution').value=s.clientExecution?.[selectedClient]||'desktop';$('client-execution').disabled=!selectedClient;
 const el=$('permission-matrix');el.replaceChildren();for(const [cap,[name,desc]]of Object.entries(capabilities)){const row=node('div',undefined,'permission-row'),label=node('div');label.append(node('strong',name),node('p',desc));const select=node('select');select.setAttribute('aria-label',name+' permission');for(const [value,text]of [['deny','Deny'],['ask','Ask every time'],['always','Always allow']]){const o=node('option',text);o.value=value;select.append(o);}select.value=s.clientPolicies[selectedClient]?.[cap]||(s.permissions[cap]?'always':'deny');select.disabled=!selectedClient;select.onchange=()=>attempt(async()=>{s.clientPolicies[selectedClient]={...s.clientPolicies[selectedClient],[cap]:select.value};await save();toast('Permission saved');});row.append(label,select);el.append(row);}
 const folders=$('folders');folders.replaceChildren();for(const folder of s.directories){const row=node('div',undefined,'folder'),remove=node('button','Remove','secondary');remove.onclick=()=>attempt(async()=>{s.directories=s.directories.filter(p=>p!==folder);await save();});row.append(node('span',folder),remove);folders.append(row);}if(!s.directories.length)folders.append(node('p','Approve a folder before using file and terminal tools.','small'));
 if(!$('file-path').value&&s.directories[0])$('file-path').value=s.directories[0];if(!$('terminal-cwd').value&&s.directories[0])$('terminal-cwd').value=s.directories[0];
}
function renderClients(){const active=state.clients.filter(c=>!c.revoked);$('metric-clients').textContent=active.length;const select=$('client-select');select.replaceChildren();for(const c of active){const o=node('option',c.name);o.value=c.id;select.append(o);}if(!active.some(c=>c.id===selectedClient))selectedClient=active[0]?.id||'';select.value=selectedClient;select.onchange=()=>{selectedClient=select.value;renderSettings();};const list=$('client-list');list.replaceChildren();for(const c of active){const row=node('div',undefined,'client-row'),label=node('div');label.append(node('strong',c.name),node('small',c.kind+' · '+c.id));const revoke=node('button','Revoke','secondary');revoke.onclick=()=>attempt(async()=>{if(!confirm('Revoke '+c.name+' and stop its managed terminals?'))return;state.clients=await api.revoke(c.id);renderClients();});row.append(label,revoke);list.append(row);}if(!active.length)list.append(node('div','No paired clients yet. Use a connection button above.','empty'));renderSettings();}
function renderApprovals(items){state.approvals=items;$('approval-count').textContent=items.length;const list=$('approval-list');list.replaceChildren();if(!items.length){list.append(node('div','No requests are waiting for approval.','card empty'));return;}for(const a of items){const card=node('article',undefined,'card approval-card');card.append(node('h2',a.kind==='connection'?'New AI connection':a.summary),node('p',a.clientName+' · '+a.capability),node('pre',a.details||''));const row=node('div',undefined,'row');for(const [choice,text]of (a.kind==='connection'?[['once','Allow connection'],['deny','Deny']]:[['once','Allow once'],['always','Always allow this capability'],['deny','Deny']])){const b=node('button',text,choice==='deny'?'secondary':'');b.onclick=()=>attempt(()=>api.answer(a.id,choice));row.append(b);}card.append(row,node('small','Expires '+new Date(a.expiresAt).toLocaleTimeString()));list.append(card);}}
function renderRemote(r){remote=r;$('metric-remote').textContent=r.phase==='online'?'Online':['starting','connecting','retrying'].includes(r.phase)?'Connecting':r.phase==='unreachable'?'Unreachable':'Off';$('metric-remote-note').textContent=r.phase==='online'?(r.mode==='vps'?'VPS relay verified':'Temporary tunnel verified'):'No verified public connection';$('remote-state').textContent=r.phase.toUpperCase();$('remote-url').textContent=r.url||'Remote access is disabled';$('remote-message').textContent=(r.message||'')+(r.lastCheckedAt?' Last checked: '+new Date(r.lastCheckedAt).toLocaleTimeString():'');$('remote-start').disabled=['online','starting','connecting','retrying','unreachable'].includes(r.phase);$('remote-stop').disabled=r.phase==='off';}
function renderGateway(g){$('metric-gateway').textContent=g.running?'Online':'Stopped';$('side-status').textContent=g.running?'Local bridge online':'Local bridge stopped';$('local-url').textContent=g.url||'Not running';}
function renderUpdates(u){$('update-message').textContent=u.message;$('auto-update').checked=!!u.autoDownload;$('download-update').disabled=u.phase!=='available';$('install-update').disabled=!u.canInstall;$('update-progress').value=u.progress||0;}
function renderActivity(items){const el=$('activity-list');el.replaceChildren();if(!items.length)el.append(node('div','Calls will appear here as clients use the bridge.','empty'));for(const a of items){const row=node('div',undefined,'activity-row');row.append(node('span',new Date(a.at).toLocaleTimeString()),node('span',a.clientName||'Desktop'),node('span',a.tool),node('span',a.error?'Error':'OK',a.error?'bad':'good'));el.append(row);}}
async function refresh(){state=await api.snapshot();$('app-version').textContent='Version '+state.version;$('installed-version').textContent=state.version;$('version-info').textContent=state.platform+' · '+state.arch+' · '+(state.packaged?'Installed application':'Source build');$('metric-tools').textContent=state.toolCount;renderClients();renderApprovals(state.approvals);renderRemote(state.remote);renderGateway(state.gateway);renderActivity(state.activity);renderUpdates(state.updates);}
document.querySelectorAll('[data-connect]').forEach(b=>b.onclick=()=>attempt(async()=>{b.disabled=true;try{const r=await api.connectClient(b.dataset.connect);await refresh();toast(r.message);page('permissions');}finally{b.disabled=false;}}));
$('local-plugin').onclick=()=>attempt(async()=>{const r=await api.localPlugin();await refresh();toast(r.message);});
$('diagnostics').onclick=()=>attempt(async()=>{const r=await api.diagnostics();$('diagnostic-result').textContent='Authenticated MCP handshake passed · '+r.version;await refresh();});
$('emergency').onclick=()=>attempt(async()=>{state.settings=await api.stopAll();renderSettings();toast('New computer actions blocked; bridge terminals are stopping.');});$('resume').onclick=()=>attempt(async()=>{state.settings.emergencyStop=false;await save();toast('Saved permissions restored.');});
$('allow-all').onclick=()=>attempt(async()=>{if(!selectedClient)return;if(!confirm('Always allow every capability for this AI, including unsandboxed terminal access? You can revoke it or use STOP at any time.'))return;state.settings.clientPolicies[selectedClient]=Object.fromEntries(Object.keys(capabilities).map(k=>[k,'always']));await save();});
$('deny-all').onclick=()=>attempt(async()=>{if(!selectedClient)return;state.settings.clientPolicies[selectedClient]=Object.fromEntries(Object.keys(capabilities).map(k=>[k,'deny']));await save();});
$('add-folder').onclick=()=>attempt(async()=>{const folder=await api.pick();if(folder&&!state.settings.directories.includes(folder)){state.settings.directories.push(folder);await save();}});
$('remote-start').onclick=()=>attempt(async()=>{renderRemote({phase:'starting',message:'Opening HTTPS tunnel…'});try{renderRemote(await api.remoteStart());}catch(e){renderRemote({phase:'off',message:e.message});throw e;}});$('remote-stop').onclick=()=>attempt(async()=>renderRemote(await api.remoteStop()));$('remote-copy').onclick=()=>attempt(async()=>{if(!remote.url)throw Error('Start the remote connection first');await api.copy(remote.url);toast('MCP URL copied. Choose OAuth when adding it to your AI client.');});
$('manual-create').onclick=()=>attempt(async()=>{const c=await api.createClient($('manual-name').value);$('manual-token').hidden=false;$('manual-token').textContent='Client: '+c.name+'\nAuthorization: Bearer '+c.token+'\nKeep this credential private. It is shown once.';await refresh();});
$('local-start').onclick=()=>attempt(async()=>renderGateway(await api.gatewayStart()));$('local-stop').onclick=()=>attempt(async()=>{renderGateway(await api.gatewayStop());renderRemote({phase:'off',message:'Gateway stopped'});} );
async function nativeStatus(){const r=await api.nativeStatus();$('native-status').textContent=r.error||'Input controls: '+(r.accessibility?'Available':'Not granted / unavailable')+'\nScreen capture: '+(r.screenRecording===true?'Allowed':(r.screenRecordingStatus||'Test required'))+'\n'+(r.message||'')+'\n'+(r.screenRecordingMessage||'');}
$('native-check').onclick=()=>attempt(nativeStatus);document.querySelectorAll('[data-os-setting]').forEach(b=>b.onclick=()=>attempt(()=>api.nativeSettings(b.dataset.osSetting)));$('screen-capture').onclick=()=>attempt(async()=>{const r=await api.tool('desktop_screenshot',{});$('screen-preview').src='data:image/png;base64,'+r.image;$('screen-preview').hidden=false;});
$('keep-running').onchange=e=>attempt(async()=>{state.settings.keepRunning=e.target.checked;await save();});$('launch-login').onchange=e=>attempt(async()=>{state.settings.launchAtLogin=e.target.checked;await save();});$('check-updates').onclick=()=>attempt(async()=>renderUpdates(await api.updates()));$('download-update').onclick=()=>attempt(async()=>renderUpdates(await api.updateDownload()));$('install-update').onclick=()=>attempt(()=>api.updateInstall());$('auto-update').onchange=e=>attempt(async()=>renderUpdates(await api.updateAuto(e.target.checked)));$('github-login').onclick=()=>attempt(async()=>{const r=await api.updateGitHub();$('github-status').textContent=r.message;toast(r.message);});
$('github-check').onclick=()=>attempt(async()=>{$('github-status').textContent=(await api.githubStatus()).message;});
$('optional-tools-check').onclick=()=>attempt(async()=>{$('optional-tools-status').textContent=JSON.stringify(await api.toolsStatus(),null,2);});
$('optional-tool-install').onclick=()=>attempt(async()=>{const r=await api.installOptional($('optional-tool-choice').value);toast(r.message||'Optional installer launched');$('optional-tools-status').textContent=JSON.stringify(await api.toolsStatus(),null,2);});
attempt(async()=>{$('optional-tools-status').textContent=JSON.stringify(await api.toolsStatus(),null,2);$('github-status').textContent=(await api.githubStatus()).message;});
function fileRows(items){const el=$('file-results');el.replaceChildren();for(const f of items){const b=node('button',undefined,'file-row');b.append(node('span',f.name||f.path),node('small',f.size===undefined?f.type:(f.size/1048576).toFixed(2)+' MiB'));b.onclick=()=>{$('file-path').value=f.path||$('file-path').value.replace(/\/$/,'')+'/'+f.name;};el.append(b);}}
$('file-list').onclick=()=>attempt(async()=>{const r=await api.tool('list_files',{path:$('file-path').value});fileRows(JSON.parse(r.text));});$('file-read').onclick=()=>attempt(async()=>{$('file-content').value=(await api.tool('read_text_file',{path:$('file-path').value})).text;});$('file-save').onclick=()=>attempt(async()=>{if(!confirm('Save changes to '+$('file-path').value+'?'))return;const r=await api.tool('write_text_file',{path:$('file-path').value,content:$('file-content').value});toast(r.text);});$('largest').onclick=()=>attempt(async()=>{const r=JSON.parse((await api.tool('search_files',{path:$('file-path').value,sort:'size',limit:5})).text);fileRows(r.results);if(r.truncated)toast('Search limit reached. Results may be incomplete.');});
async function pollTerminal(){if(!terminalId)return;try{const r=JSON.parse((await api.tool('process_output',{id:terminalId})).text);$('terminal-output').textContent=r.output||'(waiting for output)';if(!r.running){clearInterval(timer);$('terminal-output').textContent+='\nExited: '+r.exitCode;}}catch(e){clearInterval(timer);toast(e.message,true);}}
$('terminal-start').onclick=()=>attempt(async()=>{const args=JSON.parse($('terminal-args').value||'[]');const r=JSON.parse((await api.tool('process_start',{command:$('terminal-command').value,args,cwd:$('terminal-cwd').value})).text);terminalId=r.id;clearInterval(timer);timer=setInterval(pollTerminal,700);await pollTerminal();});$('terminal-stop').onclick=()=>attempt(async()=>{if(terminalId)await api.tool('process_stop',{id:terminalId});});$('terminal-send').onclick=()=>attempt(async()=>{if(!terminalId)throw Error('Start a process first');await api.tool('process_input',{id:terminalId,input:$('terminal-input').value+'\n'});$('terminal-input').value='';});

let currentCrawlId=null,crawlPollTimer=null;
const completedCrawl=new Set(['completed','failed','cancelled']);
async function refreshCrawl(){
 if(!currentCrawlId)return;
 try{
  const state=JSON.parse((await api.tool('crawl_status',{id:currentCrawlId})).text);
  $('crawl-status').textContent=JSON.stringify(state,null,2);
  if(completedCrawl.has(state.status)){
   clearInterval(crawlPollTimer);crawlPollTimer=null;
   const result=JSON.parse((await api.tool('crawl_results',{id:currentCrawlId})).text);
   $('crawl-results').value=result.pages.map(p=>p.url+'\n'+p.title+'\n'+p.text).join('\n\n---\n\n');
  }
 }catch(error){clearInterval(crawlPollTimer);crawlPollTimer=null;toast(error.message,true);}
}
$('crawl-start').onclick=()=>attempt(async()=>{
 const url=$('crawl-url').value.trim(),maxPages=Number($('crawl-pages').value),maxDepth=Number($('crawl-depth').value);
 const result=JSON.parse((await api.tool('crawl_start',{url,maxPages,maxDepth})).text);
 currentCrawlId=result.id;
 $('crawl-results').value='';
 clearInterval(crawlPollTimer);crawlPollTimer=setInterval(refreshCrawl,1000);
 await refreshCrawl();
 toast('Crawl started; it continues while the Bridge stays running, even when hidden.');
});
$('crawl-refresh').onclick=()=>attempt(refreshCrawl);
$('crawl-stop').onclick=()=>attempt(async()=>{
 if(!currentCrawlId)return;
 const result=JSON.parse((await api.tool('crawl_stop',{id:currentCrawlId})).text);
 $('crawl-status').textContent=JSON.stringify(result,null,2);
 await refreshCrawl();
});

api.on('approvals',renderApprovals);api.on('clients',items=>{if(state){state.clients=items;renderClients();}});api.on('settings',s=>{if(state){state.settings=s;renderSettings();}});api.on('remote',renderRemote);api.on('activity',renderActivity);api.on('updates:state',renderUpdates);
attempt(async()=>{await refresh();await nativeStatus();});


$('start-hidden').onchange=e=>attempt(async()=>{state.settings.startHidden=e.target.checked;await save();});
$('background-only').onchange=e=>attempt(async()=>{state.settings.backgroundOnly=e.target.checked;await save();toast('Direct desktop-tool policy saved. Terminal permissions remain separate.');});
$('client-execution').onchange=e=>attempt(async()=>{if(!selectedClient)return;state.settings.clientExecution={...(state.settings.clientExecution||{}),[selectedClient]:e.target.value};await save();});
$('save-limits').onclick=()=>attempt(async()=>{const next={...state.settings};for(const [id,key]of [['max-processes','maxProcesses'],['max-processes-client','maxProcessesPerClient'],['max-requests','maxConcurrentRequests'],['max-requests-client','maxRequestsPerClient']]){const value=Number($(id).value);if(!Number.isInteger(value)||value<0||value>4096)throw Error('Each limit must be an integer from 0 to 4096');next[key]=value;}state.settings=await api.save(next);renderSettings();toast('Concurrency limits saved. Existing tasks are not killed.');});

$('vortex-bridge-export').onclick=()=>attempt(async()=>{const r=await api.exportVortexMCP();if(!r.cancelled){await refresh();toast(r.message);}});


async function refreshTaskbarPinOffer(){
 const offer=await api.taskbarPinStatus();
 $('taskbar-pin-nudge').hidden=!(offer.available&&offer.pending);
}
$('taskbar-pin-help').onclick=()=>attempt(async()=>{
 const result=await api.taskbarPinGuide();
 toast(result.message||'Windows taskbar help opened.');
 await refreshTaskbarPinOffer();
});
$('taskbar-pin-dismiss').onclick=()=>attempt(async()=>{
 await api.taskbarPinDismiss();
 await refreshTaskbarPinOffer();
});
attempt(refreshTaskbarPinOffer);

api.on('startup:warning',message=>toast(message,true));
