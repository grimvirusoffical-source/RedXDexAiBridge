'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {app,BrowserWindow,ipcMain,dialog,safeStorage,session,Tray,Menu,nativeImage,shell,clipboard}=require('electron');
const core=require('./core.cjs'),vortex=require('./vortex.cjs'),setup=require('./setup.cjs'),native=require('./native.cjs');
const {startServer}=require('./http-mcp.cjs'),{ClientStore,atomicJSON}=require('./clients.cjs'),{ApprovalQueue}=require('./approvals.cjs'),{OAuthService}=require('./oauth.cjs'),{Tunnel}=require('./tunnel.cjs'),{createUpdateController}=require('./auto-update.cjs');
let win,tray,gateway,clients,oauth,approvals,tunnel,updateController,quitting=false;const activity=[];
const vortexSettings=require('./vortex-settings.cjs');
const {captureDesktop}=require('./capture.cjs');
function connectionFile(){return path.join(app.getPath('userData'),'vortex-connection.json');}
const UI=pathToFileURL(path.join(__dirname,'index.html')).href;
app.setPath('userData',path.join(app.getPath('appData'),'redxdex-ai-bridge'));
app.setName('RedXDexAiBridge');
if(process.env.REDXDEX_SMOKE_OUTPUT)app.setPath('userData',path.join(process.env.REDXDEX_SMOKE_OUTPUT,'userData'));
if(process.argv.includes('--diagnose-vortex')){
 app.whenReady().then(async()=>{
  const result=await require('./vortex-diagnostic.cjs').run({app,safeStorage,argv:process.argv,root:core.root});
  app.exit(result.connected?0:1);
 }).catch(error=>{console.error(error.message);app.exit(1);});
}else if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>show());
 function emit(channel,value){if(win&&!win.isDestroyed())win.webContents.send(channel,value);}
 function show(){if(win&&!win.isDestroyed()){win.show();win.focus();}}
 function audit(record){activity.unshift(record);activity.length=Math.min(activity.length,300);emit('activity',activity.slice(0,100));}
 function secretFile(name){return path.join(app.getPath('userData'),name+'.enc');}
 function secure(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure OS credential storage is unavailable');}
 function readSecret(name){secure();const p=secretFile(name);return fs.existsSync(p)?safeStorage.decryptString(fs.readFileSync(p)):'';}
 function saveSecret(name,value){secure();fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});const f=secretFile(name),tmp=f+'.'+crypto.randomUUID();try{fs.writeFileSync(tmp,safeStorage.encryptString(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,f);}finally{try{fs.unlinkSync(tmp);}catch{}}}
 function ipc(name,fn){ipcMain.handle(name,(e,...args)=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==UI)throw Error('Untrusted IPC sender');return fn(...args);});}
 function defaultClient(id){const s=core.settings();s.clientPolicies[id]=Object.fromEntries(Object.keys(s.permissions).map(k=>[k,'ask']));core.saveSettings(s);emit('clients',clients.list());}
 function runtime(){return {version:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged,gateway:gateway?{running:true,url:gateway.url}:{running:false},remote:tunnel.status(),clients:clients.list(),settings:core.settings(),approvals:approvals.list(),activity:activity.slice(0,100),updates:updateController.status(),toolCount:core.definitions.length};}
 async function startGateway(){if(gateway)return {running:true,url:gateway.url};gateway=await startServer({clients,oauth,contextFor:c=>({transport:'http',isActive:()=>clients.exists(c.id),authorize:detail=>approvals.request({kind:'tool',...detail})}),onCall:audit});atomicJSON(path.join(core.root,'runtime.json'),{url:gateway.url,pid:process.pid,version:app.getVersion()});return {running:true,url:gateway.url};}
 function stopEverything(){const s=core.settings();s.emergencyStop=true;core.saveSettings(s);approvals.cancelAll();core.processes.stopAll();emit('settings',s);audit({at:Date.now(),tool:'emergency_stop',clientName:'Desktop',error:false});return s;}
 function clientSpec(client){if(client==='codex')client='chatgpt';const credentialFile=path.join(core.root,'credentials',client+'.json');let c;if(fs.existsSync(credentialFile)){c=JSON.parse(fs.readFileSync(credentialFile));if(!clients.exists(c.id))c=null;}
  if(!c){c=clients.create(client==='claude'?'Claude Desktop':client==='vscode'?'VS Code':client==='cursor'?'Cursor':client,'local');defaultClient(c.id);atomicJSON(credentialFile,{id:c.id,token:c.token});}
  return {command:app.isPackaged?process.execPath:setup.nodeCommand(),args:[app.isPackaged?path.join(process.resourcesPath,'bridge-adapter.cjs'):path.join(__dirname,'adapter.cjs')],env:{...(app.isPackaged?{ELECTRON_RUN_AS_NODE:'1'}:{}),REDXDEX_CLIENT_KEY_FILE:credentialFile,REDXDEX_MANAGED:'1'}};
 }
 async function configureUpdateFeed(){const key=readSecret('github-updates');if(!key)throw Error('Private updates need GitHub access. Click “Use this Mac’s GitHub login” in Settings. No token is bundled with the app.');require('electron-updater').autoUpdater.setFeedURL({provider:'github',owner:'grimvirusoffical-source',repo:'RedXDexAiBridge',private:true,token:key});}
 async function checkUpdates(){await configureUpdateFeed();await updateController.check();return updateController.status();}
 app.whenReady().then(async()=>{
  fs.mkdirSync(core.root,{recursive:true,mode:0o700});fs.chmodSync(core.root,0o700);
  clients=new ClientStore(path.join(core.root,'clients.json'));
  approvals=new ApprovalQueue({emit:items=>{emit('approvals',items);if(items.length){app.dock?.bounce('informational');}}});
  oauth=new OAuthService({file:path.join(core.root,'oauth.json'),clients,approvals,onClient:defaultClient});
  tunnel=new Tunnel(s=>{if(s.url)oauth.setOrigin(new URL(s.url).origin);else oauth.origin=null;atomicJSON(path.join(core.root,'remote-status.json'),s);emit('remote',s);},{root:core.root});
  const prefsFile=path.join(app.getPath('userData'),'updates.json');const prefs={get:()=>{try{return JSON.parse(fs.readFileSync(prefsFile)).autoDownload;}catch{return true;}},set:(_,value)=>atomicJSON(prefsFile,{autoDownload:value})};
  updateController=createUpdateController({app,autoUpdater:require('electron-updater').autoUpdater,store:prefs,emit:s=>emit('updates:state',s)});updateController.init();
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1240,height:860,minWidth:920,minHeight:650,title:'RedXDexAiBridge',backgroundColor:'#101219',icon:path.join(__dirname,'assets','icon.png'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==UI)e.preventDefault();});win.setMenuBarVisibility(false);
  win.on('close',e=>{if(!quitting&&core.settings().keepRunning){e.preventDefault();win.hide();}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'assets','icon.png')).resize({width:20,height:20});
  tray=new Tray(icon);if(process.platform==='darwin')tray.setTitle('RX');tray.setToolTip('RedXDexAiBridge — computer access');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open RedXDexAiBridge',click:show},{label:'STOP all computer control',click:stopEverything},{type:'separator'},{label:'Quit bridge and disconnect',click:()=>{quitting=true;app.quit();}}]));tray.on('click',show);
  native.setCaptureAdapter(()=>captureDesktop(require('electron')));
  await startGateway();
  if(process.env.REDXDEX_SMOKE_OUTPUT){console.error('SMOKE gateway ready');setTimeout(()=>console.error('SMOKE frame',win.webContents.getURL(),'loading',win.webContents.isLoading()),3000);}
  const rendererErrors=[];win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)rendererErrors.push(event.message);});
  await win.loadFile(path.join(__dirname,'index.html'));
  if(process.env.REDXDEX_SMOKE_OUTPUT)console.error('SMOKE UI loaded');
  if(process.env.REDXDEX_SMOKE_OUTPUT){
   await new Promise(r=>setTimeout(r,1200));
   const result=await win.webContents.executeJavaScript(`(async()=>{const s=await window.bridge.snapshot();return {title:document.title,version:s.version,tools:s.toolCount,gateway:s.gateway.running,pages:document.querySelectorAll('.page').length,visibleVersion:document.getElementById('app-version').textContent,preload:typeof window.bridge.answer==='function'};})()`);
   result.navigation=await win.webContents.executeJavaScript(`(()=>[...document.querySelectorAll('[data-page]')].map(button=>{button.click();return {page:button.dataset.page,visible:!document.getElementById('page-'+button.dataset.page).hidden};}))()`);
   if(result.navigation.some(item=>!item.visible))throw Error('Navigation failed');
   const out=process.env.REDXDEX_SMOKE_OUTPUT;fs.mkdirSync(out,{recursive:true});
   fs.writeFileSync(path.join(out,'ui.png'),(await win.webContents.capturePage()).toPNG());
   fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,rendererErrors},null,2));
   quitting=true;app.quit();return;
  }
  if(process.argv.includes('--pair-local-chatgpt'))clientSpec('chatgpt');
  if(process.argv.includes('--connect-remote')||tunnel.config()?.autoConnect===true)tunnel.start(gateway.url).catch(e=>emit('remote',{phase:'error',message:e.message}));
  if(core.settings().launchAtLogin&&app.isPackaged)app.setLoginItemSettings({openAtLogin:true});
  const timer=setTimeout(()=>checkUpdates().catch(e=>emit('updates:state',{...updateController.status(),message:e.message})),15000);timer.unref();
  const interval=setInterval(()=>checkUpdates().catch(()=>{}),6*3600000);interval.unref();
 }).catch(e=>{if(process.env.REDXDEX_SMOKE_OUTPUT){fs.mkdirSync(process.env.REDXDEX_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.REDXDEX_SMOKE_OUTPUT,'error.txt'),e.stack||e.message);console.error(e.stack||e.message);}else dialog.showErrorBox('RedXDexAiBridge could not start',e.message);quitting=true;app.quit();});
 ipc('snapshot',()=>runtime());
 ipc('settings:read',()=>core.settings());
 ipc('settings:save',s=>{const old=core.settings();const result=core.saveSettings(s);if(result.emergencyStop){approvals.cancelAll();core.processes.stopAll();}if(old.launchAtLogin!==result.launchAtLogin&&app.isPackaged)app.setLoginItemSettings({openAtLogin:result.launchAtLogin});emit('settings',result);return result;});
 ipc('stop:all',()=>stopEverything());
 ipc('folder:pick',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
 ipc('approval:answer',(id,choice)=>approvals.resolve(id,choice));
 ipc('clients:revoke',id=>{clients.revoke(id);core.processes.stopClient(id);for(const pending of approvals.list())if(pending.clientId===id)approvals.resolve(pending.id,'deny','Client revoked');emit('clients',clients.list());return clients.list();});
 ipc('clients:create',name=>{const c=clients.create(name,'manual');defaultClient(c.id);return c;});
 ipc('setup:localPlugin',()=>{clientSpec('chatgpt');return {message:'Local ChatGPT plugin paired. Enable the RedXDexAiBridge plugin in a client that can execute local MCP tools. Remote ChatGPT sessions still require the HTTPS/OAuth connection.'};});
 ipc('setup:connect',async client=>{await startGateway();const spec=clientSpec(client),r=setup.addClient(client,{spec});emit('clients',clients.list());return r;});
 ipc('setup:config',client=>setup.configFor(client,clientSpec(client)));
 ipc('setup:diagnostics',async()=>{await startGateway();const spec=clientSpec('Diagnostics');const proc=cp.spawn(spec.command,spec.args,{env:{...process.env,...spec.env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill();reject(Error('MCP diagnostic timed out'));},5000);proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);proc.on('error',e=>{clearTimeout(timer);reject(e);});proc.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(stdout.trim().split('\n')[0]);if(!r.result?.serverInfo)throw Error(r.error?.message||stderr||'MCP handshake failed');resolve({ok:true,version:r.result.serverInfo.version});}catch(e){reject(e);}});proc.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Diagnostics',version:'1'}}})+'\n');});});
 ipc('gateway:start',()=>startGateway());ipc('gateway:status',()=>({running:!!gateway,url:gateway?.url}));
 ipc('gateway:stop',async()=>{approvals.cancelAll('Gateway stopped');core.processes.stopAll();tunnel.stop();if(gateway){await gateway.stop();gateway=null;}try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}return {running:false};});
 ipc('remote:start',async()=>{await startGateway();return tunnel.start(gateway.url);});ipc('remote:stop',()=>tunnel.stop());
 ipc('native:status',async()=>{const helper=await native.control({action:'status'}).catch(e=>({error:e.message}));const status=process.platform==='darwin'?require('electron').systemPreferences.getMediaAccessStatus('screen'):(helper.screenRecording?'available':'unavailable');return native.permissionStatus(helper,status);});
 ipc('native:settings',section=>{if(process.platform!=='darwin')return {message:'Use your system desktop settings. Linux X11 input needs xdotool; Wayland input and Windows input are not included in this preview.'};const map={accessibility:'Privacy_Accessibility',screen:'Privacy_ScreenCapture'};if(!map[section])throw Error('Unknown settings section');return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+map[section]);});
 ipc('tool:interactive',(name,args)=>core.perform(name,args,{clientId:'desktop',interactive:true}));
 ipc('clipboard:write',text=>{if(typeof text!=='string'||text.length>65536)throw Error('Invalid clipboard text');clipboard.writeText(text);return true;});
 ipc('app:version',()=>({version:app.getVersion(),platform:process.platform,arch:process.arch}));
 ipc('updates:status',()=>updateController.status());ipc('app:updates',()=>checkUpdates());ipc('updates:download',async()=>{await configureUpdateFeed();await updateController.download();return updateController.status();});
 ipc('updates:install',()=>{quitting=true;try{return updateController.install();}catch(e){quitting=false;throw e;}});ipc('updates:auto',v=>updateController.setAutoDownload(v));
 ipc('updates:github',async()=>{const bin=[path.join(os.homedir(),'.local/bin/gh'),'/opt/homebrew/bin/gh','/usr/local/bin/gh'].find(p=>fs.existsSync(p));if(!bin)throw Error('GitHub CLI not found. Sign in with gh auth login first.');const {stdout}=await require('node:util').promisify(cp.execFile)(bin,['auth','token','--hostname','github.com'],{timeout:10000,maxBuffer:16384});const value=stdout.trim();if(!value)throw Error('GitHub is not signed in');saveSecret('github-updates',value);return {ok:true,message:'GitHub access saved using OS-backed encryption; credentials are not included in the application.'};});
 ipc('vortex:config',()=>({...vortexSettings.load(connectionFile()),hasKey:fs.existsSync(secretFile('vortex-key'))}));
 ipc('vortex:save',async(key,input={})=>{
  const previous=vortexSettings.load(connectionFile());
  const next=vortexSettings.validate({...previous,...input});
  const hasKey=fs.existsSync(secretFile('vortex-key'));
  const supplied=typeof key==='string'&&key.trim();
  if(hasKey&&!supplied&&next.endpoint!==previous.endpoint){
   const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Use this API server'],defaultId:0,cancelId:0,title:'Change Vortex API server?',message:'Send the saved Vortex key to '+new URL(next.endpoint).host+'?',detail:'Only continue for an inference server you trust. Credentials will not be sent to the old address afterward.'});
   if(answer.response!==1)throw Error('Server change cancelled.');
  }
  if(supplied)saveSecret('vortex-key',vortex.validateKey(key));
  if(!supplied&&!hasKey)throw Error('Add a Vortex inference key first.');
  return {...vortexSettings.save(connectionFile(),next),hasKey:true};
 });
 ipc('vortex:status',async()=>{
  const profile=vortexSettings.load(connectionFile()),key=readSecret('vortex-key');
  if(!key)return {connected:false,error:'Add a Vortex inference key first',...profile};
  try{const models=await vortex.models(key,undefined,profile.endpoint);return {connected:true,models,defaultModel:vortex.DEFAULT_MODEL,proAvailable:models.includes(vortex.DEFAULT_MODEL),...profile};}
  catch(error){return {connected:false,error:error.message,code:error.code,status:error.status,retryAfter:error.retryAfter,...profile};}
 });
 ipc('vortex:chat',(messages,model)=>{const profile=vortexSettings.load(connectionFile());return vortex.chat(readSecret('vortex-key'),messages,model||profile.model,undefined,profile.endpoint);});
 ipc('vortex:editorConfig',()=>vortexSettings.editorConfiguration(vortexSettings.load(connectionFile())));
 ipc('vortex:disconnect',()=>{try{fs.unlinkSync(secretFile('vortex-key'));}catch{}return true;});

 app.on('activate',show);app.on('window-all-closed',()=>{if(process.platform!=='darwin'||!core.settings().keepRunning){quitting=true;app.quit();}});
 app.on('before-quit',()=>{quitting=true;approvals?.cancelAll('Bridge is quitting');core.processes.stopAll();tunnel?.stop();gateway?.server.closeAllConnections?.();gateway?.server.close();try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}});
}
