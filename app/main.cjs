'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {atomicRename}=require('./atomic-rename.cjs');
const {app,BrowserWindow,ipcMain,dialog,safeStorage,session,Tray,Menu,nativeImage,shell,clipboard}=require('electron');
if(process.argv.includes('--self-test')&&(!process.env.REDXDEX_DATA_DIR||!process.env.REDXDEX_SMOKE_OUTPUT))throw Error('Self-test requires isolated data and output folders');
const core=require('./core.cjs'),vortex=require('./vortex.cjs'),setup=require('./setup.cjs'),native=require('./native.cjs'),quickSetup=require('./quick-setup.cjs');
const {startServer}=require('./http-mcp.cjs'),{ClientStore,atomicJSON}=require('./clients.cjs'),{ApprovalQueue}=require('./approvals.cjs'),{OAuthService}=require('./oauth.cjs'),{Tunnel}=require('./tunnel.cjs'),{createUpdateController}=require('./auto-update.cjs');
let win,tray,gateway,clients,oauth,approvals,tunnel,updateController,quitting=false;const activity=[];
const UI=pathToFileURL(path.join(__dirname,'index.html')).href;
app.setPath('userData',path.join(app.getPath('appData'),'redxdex-ai-bridge'));
app.setName('RedXDexAiBridge');
if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test')))app.setPath('userData',path.join(process.env.REDXDEX_SMOKE_OUTPUT,'userData'));
if(process.argv.includes('--vortex-diagnostic')){
 app.whenReady().then(async()=>{
  const result=await require('./vortex-diagnostic.cjs').run({app,safeStorage,root:core.root,argv:process.argv});
  app.exit(result.connected?0:1);
 }).catch(error=>{console.error(error.message);app.exit(1);});
}else if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>show());
 function emit(channel,value){if(win&&!win.isDestroyed())win.webContents.send(channel,value);}
 function show(){if(win&&!win.isDestroyed()){win.show();win.focus();}}
 function audit(record){activity.unshift(record);activity.length=Math.min(activity.length,300);emit('activity',activity.slice(0,100));}
 function vortexConfig(){
  const file=path.join(app.getPath('userData'),'vortex-connection.json');
  let config={};if(fs.existsSync(file))config=JSON.parse(fs.readFileSync(file,'utf8'));
  return {endpoint:vortex.normalizeEndpoint(config.endpoint||vortex.ENDPOINT)};
 }
 async function vortexStatus(){
  const config=vortexConfig(),key=readSecret('vortex-key');
  if(!key)return {connected:false,endpoint:config.endpoint,error:'Add a Vortex API key first'};
  try{const models=await vortex.models(key,globalThis.fetch,config);return {connected:true,endpoint:config.endpoint,models,defaultModel:vortex.DEFAULT_MODEL,proAvailable:models.includes(vortex.DEFAULT_MODEL)};}
  catch(error){return {connected:false,endpoint:config.endpoint,error:error.message};}
 }
 function secretFile(name){return path.join(app.getPath('userData'),name+'.enc');}
 function secure(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure OS credential storage is unavailable');}
 function readSecret(name){secure();const p=secretFile(name);return fs.existsSync(p)?safeStorage.decryptString(fs.readFileSync(p)):'';}
 function saveSecret(name,value){secure();fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});const f=secretFile(name),tmp=f+'.'+crypto.randomUUID();try{fs.writeFileSync(tmp,safeStorage.encryptString(value),{mode:0o600,flag:'wx'});atomicRename(tmp,f);}finally{try{fs.unlinkSync(tmp);}catch{}}}
 function ipc(name,fn){ipcMain.handle(name,(e,...args)=>{if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==UI)throw Error('Untrusted IPC sender');return fn(...args);});}
 function defaultClient(id){const s=core.settings();s.clientPolicies[id]=Object.fromEntries(Object.keys(s.permissions).map(k=>[k,'ask']));core.saveSettings(s);emit('clients',clients.list());}
 function runtime(){return {version:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged,gateway:gateway?{running:true,url:gateway.url}:{running:false},remote:tunnel.status(),clients:clients.list(),settings:core.settings(),approvals:approvals.list(),activity:activity.slice(0,100),updates:updateController.status(),toolCount:core.definitions.length};}
 async function startGateway(){if(gateway)return {running:true,url:gateway.url};gateway=await startServer({clients,oauth,contextFor:c=>({transport:'http',isActive:()=>clients.exists(c.id),authorize:detail=>approvals.request({kind:'tool',...detail})}),onCall:audit});atomicJSON(path.join(core.root,'runtime.json'),{url:gateway.url,pid:process.pid,version:app.getVersion()});return {running:true,url:gateway.url};}
 function stopEverything(){const s=core.settings();s.emergencyStop=true;core.saveSettings(s);approvals.cancelAll();core.processes.stopAll();core.desktopLease.reset();emit('settings',s);audit({at:Date.now(),tool:'emergency_stop',clientName:'Desktop',error:false});return s;}
 function remoteAutoConnect(){return require('./remote-preferences.cjs').enabled(core.root);}
 function rememberRemote(enabled){require('./remote-preferences.cjs').remember(core.root,enabled);}
 function clientSpec(client){if(!['codex','chatgpt','claude','vscode','cursor','gemini','vortex','Diagnostics'].includes(client))throw Error('Unsupported local client');const credentialFile=path.join(core.root,'credentials',client+'.json');let c;if(fs.existsSync(credentialFile)){c=JSON.parse(fs.readFileSync(credentialFile));if(!clients.exists(c.id))c=null;}
  if(!c){c=clients.create(client==='claude'?'Claude Desktop':client==='vscode'?'VS Code':client==='cursor'?'Cursor':client==='gemini'?'Gemini CLI':client,'local');defaultClient(c.id);atomicJSON(credentialFile,{id:c.id,token:c.token});}
  return {command:app.isPackaged?process.execPath:setup.nodeCommand(),args:[app.isPackaged?path.join(process.resourcesPath,'bridge-adapter.cjs'):path.join(__dirname,'adapter.cjs')],env:{...(app.isPackaged?{ELECTRON_RUN_AS_NODE:'1'}:{}),REDXDEX_CLIENT_KEY_FILE:credentialFile,REDXDEX_MANAGED:'1'}};
 }
 async function configureUpdateFeed(){const key=readSecret('github-updates');if(!key)throw Error('Private updates need GitHub access. Click “Use this computer’s GitHub login” in Settings. No token is bundled with the app.');require('electron-updater').autoUpdater.setFeedURL({provider:'github',owner:'grimvirusoffical-source',repo:'RedXDexAiBridge',private:true,token:key});}
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
  win=new BrowserWindow({show:!core.settings().startHidden,...require('./window-layout.cjs').windowLayout(require('electron').screen.getPrimaryDisplay().workArea),title:'Red-XAI Bridge',icon:path.join(__dirname,'assets','bridge-icon.png'),backgroundColor:'#101219',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==UI)e.preventDefault();});win.setMenuBarVisibility(false);
  win.on('close',e=>{if(!quitting&&core.settings().keepRunning){e.preventDefault();win.hide();}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'assets','bridge-icon.png')).resize({width:20,height:20});
  tray=new Tray(icon);if(process.platform==='darwin')tray.setTitle('RX');tray.setToolTip('RedXDexAiBridge — computer access');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open RedXDexAiBridge',click:show},{label:'STOP all computer control',click:stopEverything},{type:'separator'},{label:'Quit bridge and disconnect',click:()=>{quitting=true;app.quit();}}]));tray.on('click',show);
  await startGateway();
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){console.error('SMOKE gateway ready');setTimeout(()=>console.error('SMOKE frame',win.webContents.getURL(),'loading',win.webContents.isLoading()),3000);}
  const rendererErrors=[];win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)rendererErrors.push(event.message);});
  await win.loadFile(path.join(__dirname,'index.html'));
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test')))console.error('SMOKE UI loaded');
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){
   await new Promise(r=>setTimeout(r,1200));console.error('SMOKE snapshot requested');
   const result=await win.webContents.executeJavaScript(`(async()=>{const s=await window.bridge.snapshot();return {title:document.title,version:s.version,tools:s.toolCount,gateway:s.gateway.running,pages:document.querySelectorAll('.page').length,visibleVersion:document.getElementById('app-version').textContent,preload:typeof window.bridge.answer==='function'};})()`);
   console.error('SMOKE snapshot returned');result.navigation=await win.webContents.executeJavaScript(`(()=>{const out=[];for(const b of document.querySelectorAll('[data-page]')){b.click();out.push({page:b.dataset.page,visible:!document.getElementById('page-'+b.dataset.page).hidden});}return out;})()`);
   if(result.navigation.some(x=>!x.visible))throw Error('A navigation page did not open');
    result.quickSetup=await win.webContents.executeJavaScript("(async()=>{const check=await window.bridge.quickSetup();const ai=await window.bridge.addAi('generic','One Click CI Fixture');return {gatewayRunning:check.gatewayRunning,permissionDefault:check.permissionDefault,kind:ai.kind,generatedCredential:typeof ai.oneTimeInstructions==='string'&&ai.oneTimeInstructions.includes('Bearer '),clientAdded:!!ai.clientId,buttonFound:!!document.getElementById('quick-computer-setup'),selectorFound:!!document.getElementById('quick-ai-kind')};})()");
    if(!result.quickSetup.gatewayRunning||!result.quickSetup.generatedCredential||!result.quickSetup.clientAdded||!result.quickSetup.buttonFound||!result.quickSetup.selectorFound||result.quickSetup.permissionDefault!=='ask')throw Error('One-click setup smoke test failed');
   console.error('SMOKE navigation returned');const out=process.env.REDXDEX_SMOKE_OUTPUT;fs.mkdirSync(out,{recursive:true});
   result.windowBounds=win.getBounds();result.displayWorkArea=require('electron').screen.getDisplayMatching(result.windowBounds).workArea;
   let captureError;for(let attempt=0;attempt<3;attempt++){try{await new Promise(r=>setTimeout(r,300));console.error('SMOKE page capture attempt',attempt);const image=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('UI capture timed out')),5000))]);if(image.isEmpty())throw Error('Empty UI capture');fs.writeFileSync(path.join(out,'ui.png'),image.toPNG());result.uiCapture=true;captureError=null;break;}catch(error){captureError=error;}}
   if(captureError){result.uiCapture=false;result.uiCaptureError=captureError.message;const image=Buffer.from(await native.screenshot(),'base64');fs.writeFileSync(path.join(out,'desktop.png'),image);result.desktopCaptureFallback=true;}
   fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,rendererErrors},null,2));
   quitting=true;app.quit();return;
  }
  if(process.argv.includes('--pair-local-chatgpt'))clientSpec('chatgpt');
  if(process.argv.includes('--connect-remote')||tunnel.config()?.autoConnect===true||remoteAutoConnect())tunnel.start(gateway.url).catch(e=>emit('remote',{phase:'error',message:e.message}));
  if(core.settings().launchAtLogin&&app.isPackaged){try{require('./startup.cjs').configureStartup(app,true);}catch(error){audit({at:Date.now(),tool:'startup_configuration',clientName:'Desktop',error:true});emit('startup:warning',error.message);}}
  const timer=setTimeout(()=>checkUpdates().catch(e=>emit('updates:state',{...updateController.status(),message:e.message})),15000);timer.unref();
  const interval=setInterval(()=>checkUpdates().catch(()=>{}),6*3600000);interval.unref();
 }).catch(e=>{if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){fs.mkdirSync(process.env.REDXDEX_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.REDXDEX_SMOKE_OUTPUT,'error.txt'),e.stack||e.message);console.error(e.stack||e.message);quitting=true;app.exit(1);return;}else dialog.showErrorBox('RedXDexAiBridge could not start',e.message);quitting=true;app.quit();});
 ipc('snapshot',()=>runtime());
 ipc('settings:read',()=>core.settings());
 ipc('settings:save',s=>{const old=core.settings();const result=core.saveSettings(s);if(result.emergencyStop){approvals.cancelAll();core.processes.stopAll();}if(old.launchAtLogin!==result.launchAtLogin&&app.isPackaged){try{require('./startup.cjs').configureStartup(app,result.launchAtLogin,{remoteAutoConnect:remoteAutoConnect()});}catch(error){core.saveSettings(old);throw error;}}emit('settings',result);return result;});
 ipc('stop:all',()=>stopEverything());
 ipc('folder:pick',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
 ipc('approval:answer',(id,choice)=>approvals.resolve(id,choice));
 ipc('clients:revoke',id=>{clients.revoke(id);core.processes.stopClient(id);core.desktopLease.reset(id);for(const pending of approvals.list())if(pending.clientId===id)approvals.resolve(pending.id,'deny','Client revoked');emit('clients',clients.list());return clients.list();});
 ipc('clients:create',name=>{const c=clients.create(name,'manual');defaultClient(c.id);return c;});
 ipc('setup:localPlugin',()=>{clientSpec('chatgpt');return {message:'Local ChatGPT plugin paired. Enable the RedXDexAiBridge plugin in a client that can execute local MCP tools. Remote ChatGPT sessions still require the HTTPS/OAuth connection.'};});
 ipc('setup:connect',async client=>{await startGateway();const spec=clientSpec(client),r=setup.addClient(client,{spec});emit('clients',clients.list());return r;});
 ipc('setup:config',client=>setup.configFor(client,clientSpec(client)));
  ipc('setup:quick',async()=>{
    const local=await startGateway();
    const nativeStatus=await native.control({action:'status'}).catch(error=>({accessibility:false,inputSupported:false,message:error.message}));
    const checks=quickSetup.readiness({nativeStatus});
    let startupEnabled=false;
    if(app.isPackaged){
      const old=core.settings();
      try{
        require('./startup.cjs').configureStartup(app,true,{remoteAutoConnect:remoteAutoConnect()});
        core.saveSettings({...old,launchAtLogin:true,keepRunning:true});
        startupEnabled=true;
      }catch(error){
        if(!old.launchAtLogin)try{require('./startup.cjs').configureStartup(app,false);}catch{}
        checks.advice.push('Automatic startup could not be enabled: '+error.message);
      }
    }else checks.advice.push('Install the packaged application to enable launch-at-login in one click.');
    return {...checks,gatewayRunning:local.running,gatewayUrl:local.url,startupEnabled,permissionDefault:'ask',message:checks.readyForFullDesktop?'Local bridge is ready. Add an AI next; individual permissions stay on Ask.':'Local gateway is ready. Review desktop permission guidance before enabling input.'};
  });
  ipc('setup:addAI',async(kind,name)=>{
    quickSetup.validateType(kind);
    const local=await startGateway();
    if(kind==='generic'){
      const safeName=quickSetup.validateName(name);
      const c=clients.create(safeName,'manual');
      defaultClient(c.id);
      emit('clients',clients.list());
      return {kind,clientId:c.id,name:c.name,oneTimeInstructions:quickSetup.instructionsFor(kind,{clientName:c.name,url:local.url,token:c.token}),message:'New AI credential created. Copy it now: it cannot be recovered later. Permissions default to Ask. The remote tunnel was NOT enabled.'};
    }
    if(kind==='remote'){
      const status=await tunnel.start(local.url);
      if(status?.phase==='error')throw Error(status.message||'Remote tunnel could not start.');
      rememberRemote(true);
      const verified=status.phase==='online'&&!!status.url;
      return {kind,remoteUrl:verified?status.url:null,connectionPending:!verified,
        oneTimeInstructions:quickSetup.instructionsFor(kind),
        message:verified?'Verified HTTPS MCP endpoint is ready. Connect via OAuth and approve the pairing request in Bridge.':'Starting and verifying the remote tunnel. The HTTPS MCP address will appear here after the bridge confirms it is reachable.'};
    }
    const spec=clientSpec(kind);
    const result=setup.addClient(kind,{spec});
    emit('clients',clients.list());
    return {kind,path:result.path,backup:result.backup,message:result.message+' Permissions default to Ask; no computer access has been silently granted.'};
  });
 ipc('setup:exportVortex',async()=>{
  const result=await dialog.showSaveDialog(win,{title:'Export Vortex MCP connection',defaultPath:path.join(app.getPath('downloads'),'Red-XAI-Bridge-MCP.json'),filters:[{name:'MCP JSON',extensions:['json']}]});
  if(result.canceled||!result.filePath)return {cancelled:true};
  const config=setup.configFor('vortex',clientSpec('vortex'));
  fs.writeFileSync(result.filePath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  emit('clients',clients.list());
  return {message:'Exported a Vortex-only connection. In Vortex, sign into the intended account, then MCP Servers → Import JSON. Grant the Vortex client permissions in Bridge. No API secret was included in the export.'};
 });

 ipc('setup:diagnostics',async()=>{await startGateway();const spec=clientSpec('Diagnostics');const proc=cp.spawn(spec.command,spec.args,{env:{...process.env,...spec.env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill();reject(Error('MCP diagnostic timed out'));},5000);proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);proc.on('error',e=>{clearTimeout(timer);reject(e);});proc.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(stdout.trim().split('\n')[0]);if(!r.result?.serverInfo)throw Error(r.error?.message||stderr||'MCP handshake failed');resolve({ok:true,version:r.result.serverInfo.version});}catch(e){reject(e);}});proc.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Diagnostics',version:'1'}}})+'\n');});});
 ipc('gateway:start',()=>startGateway());ipc('gateway:status',()=>({running:!!gateway,url:gateway?.url}));
 ipc('gateway:stop',async()=>{approvals.cancelAll('Gateway stopped');core.processes.stopAll();tunnel.stop();if(gateway){await gateway.stop();gateway=null;}try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}return {running:false};});
 ipc('remote:start',async()=>{await startGateway();const status=await tunnel.start(gateway.url);if(status.phase!=='error')rememberRemote(true);return status;});
 ipc('remote:stop',()=>{rememberRemote(false);return tunnel.stop();});
 ipc('native:status',async()=>{const helper=await native.control({action:'status'}).catch(e=>({error:e.message}));const status=process.platform==='darwin'?require('electron').systemPreferences.getMediaAccessStatus('screen'):'unknown';return native.permissionStatus(helper,status);});
 ipc('native:settings',section=>{
  if(!['accessibility','screen'].includes(section))throw Error('Unknown settings section');
  if(process.platform==='darwin')return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+(section==='screen'?'Privacy_ScreenCapture':'Privacy_Accessibility'));
  if(process.platform==='win32')return shell.openExternal('ms-settings:privacy');
  return dialog.showMessageBox(win,{type:'info',title:'Linux desktop permissions',message:'Screenshots use your graphical desktop/portal. For mouse and keyboard control, use an X11 session and install xdotool from your distribution package manager. Wayland global input is not implemented.'});
 });
 ipc('tool:interactive',(name,args)=>core.perform(name,args,{clientId:'desktop',interactive:true}));
 ipc('clipboard:write',text=>{if(typeof text!=='string'||text.length>65536)throw Error('Invalid clipboard text');clipboard.writeText(text);return true;});
 ipc('app:version',()=>({version:app.getVersion(),platform:process.platform,arch:process.arch}));
 ipc('updates:status',()=>updateController.status());ipc('app:updates',()=>checkUpdates());ipc('updates:download',async()=>{await configureUpdateFeed();await updateController.download();return updateController.status();});
 ipc('updates:install',()=>{quitting=true;try{return updateController.install();}catch(e){quitting=false;throw e;}});ipc('updates:auto',v=>updateController.setAutoDownload(v));
 ipc('updates:github',async()=>{const bin=require('./platform.cjs').findExecutable('gh');if(!bin)throw Error('GitHub CLI not found. Sign in with gh auth login first.');const {stdout}=await require('node:util').promisify(cp.execFile)(bin,['auth','token','--hostname','github.com'],{timeout:10000,maxBuffer:16384});const value=stdout.trim();if(!value)throw Error('GitHub is not signed in');saveSecret('github-updates',value);return {ok:true,message:'GitHub access saved using OS-backed encryption; credentials are not included in the application.'};});
 ipc('vortex:save',key=>{saveSecret('vortex-key',vortex.validateKey(key));return true;});
 ipc('vortex:status',()=>vortexStatus());
 ipc('vortex:connection',()=>({...vortexConfig(),keySaved:fs.existsSync(secretFile('vortex-key'))}));
 ipc('vortex:endpoint',async value=>{
  const endpoint=vortex.normalizeEndpoint(value);
  if(endpoint!==vortexConfig().endpoint){
   const decision=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Use this endpoint'],defaultId:0,cancelId:0,title:'Vortex API connection',message:'Send Vortex requests and your saved API key only to this endpoint?',detail:endpoint+'\nChoose an endpoint you own or trust. The bridge never follows redirects with your key.'});
   if(decision.response!==1)return {cancelled:true};
  }
  atomicJSON(path.join(app.getPath('userData'),'vortex-connection.json'),{endpoint});
  return {endpoint};
 });
 ipc('vortex:chat',(messages,model)=>vortex.chat(readSecret('vortex-key'),messages,model||vortex.DEFAULT_MODEL,globalThis.fetch,vortexConfig()));ipc('vortex:disconnect',()=>{try{fs.unlinkSync(secretFile('vortex-key'));}catch{}return true;});
 app.on('activate',show);app.on('window-all-closed',()=>{if(process.platform!=='darwin'||!core.settings().keepRunning){quitting=true;app.quit();}});
 app.on('before-quit',()=>{quitting=true;approvals?.cancelAll('Bridge is quitting');core.processes.stopAll();tunnel?.stop();gateway?.server.closeAllConnections?.();gateway?.server.close();try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}});
}
