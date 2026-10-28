'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {promisify}=require('node:util');
const execFile=promisify(cp.execFile);
const root=process.env.REDXDEX_DATA_DIR||path.join(os.homedir(),'.redxdex-ai-bridge');
const {ProcessManager}=require('./processes.cjs');
const processes=new ProcessManager({policy:()=>settings()});
const {assertExecution,backgroundOnly,DesktopLease,FOCUS_ACTIONS}=require("./execution.cjs");
const desktopLease=new DesktopLease();
const native=require('./native.cjs');
const configPath=path.join(root,'settings.json');
const defaults={directories:[], permissions:{list:true,read:false,write:false,terminal:false,screenshot:false,mouse:false,keyboard:false,apps:false}, maxReadBytes:1048576, maxOutputBytes:65536, emergencyStop:false, clientPolicies:{}, keepRunning:true, launchAtLogin:false, startHidden:false, backgroundOnly:false, clientExecution:{}, maxProcesses:32, maxProcessesPerClient:8, maxConcurrentRequests:64, maxRequestsPerClient:16};
const MAX_LIMIT=8*1024*1024;
function settings(){try {const c=JSON.parse(fs.readFileSync(configPath,'utf8'));return {...defaults,...c,permissions:{...defaults.permissions,...c.permissions},directories:Array.isArray(c.directories)?c.directories:[],clientPolicies:c.clientPolicies&&typeof c.clientPolicies==='object'&&!Array.isArray(c.clientPolicies)?c.clientPolicies:{}};}catch{return structuredClone(defaults);}}
function saveSettings(s){if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Invalid settings');const value={...defaults,...s,permissions:{...defaults.permissions,...(s.permissions||{})}}; if(!Array.isArray(value.directories))throw Error('directories must be an array');value.directories=value.directories.map(x=>{if(typeof x!=='string'||!path.isAbsolute(x))throw Error('Approved folders must use absolute paths');const resolved=fs.realpathSync(x);if(!fs.statSync(resolved).isDirectory())throw Error('Approved folder must be a directory');return resolved;});for(const key of Object.keys(defaults.permissions)){if(typeof value.permissions[key]!=='boolean')throw Error('Invalid permission: '+key);}for(const flag of ['keepRunning','launchAtLogin','startHidden','backgroundOnly'])if(typeof value[flag]!=='boolean')throw Error('Invalid preference: '+flag);if(typeof value.emergencyStop!=='boolean')throw Error('Invalid emergency stop flag'); if(!value.clientPolicies||typeof value.clientPolicies!=='object'||Array.isArray(value.clientPolicies))throw Error('Invalid client policies');for(const [client,policies] of Object.entries(value.clientPolicies)){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(client)||!policies||typeof policies!=='object'||Array.isArray(policies))throw Error('Invalid client policy');for(const [tool,mode] of Object.entries(policies)){if(!Object.hasOwn(defaults.permissions,tool)||!['deny','ask','always'].includes(mode))throw Error('Invalid client permission');}}if(!value.clientExecution||typeof value.clientExecution!=='object'||Array.isArray(value.clientExecution))throw Error('Invalid client execution settings');for(const [id,mode]of Object.entries(value.clientExecution)){if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||!['background','desktop'].includes(mode))throw Error('Invalid client execution mode');}for(const field of ['maxProcesses','maxProcessesPerClient','maxConcurrentRequests','maxRequestsPerClient']){if(!Number.isSafeInteger(value[field])||value[field]<0||value[field]>4096)throw Error('Concurrency limits must be 0–4096; 0 means no app-imposed limit');}for(const field of ['maxReadBytes','maxOutputBytes']){if(!Number.isSafeInteger(value[field])||value[field]<1||value[field]>MAX_LIMIT)throw Error('Invalid limit: '+field);}fs.mkdirSync(root,{recursive:true,mode:0o700});const tmp=configPath+'.tmp-'+process.pid;try{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.renameSync(tmp,configPath);}finally{try{fs.unlinkSync(tmp)}catch{}}return settings();}
async function ensurePermission(name,context={}){
 const s=settings();if(s.emergencyStop)throw Error('Emergency stop is active');
 if(context.isActive&&!context.isActive())throw Error('Client access has been revoked');
 if(context.interactive===true)return;
 const id=context.clientId||process.env.REDXDEX_CLIENT_ID||'local';
 const mode=s.clientPolicies[id]?.[name]||(s.permissions[name]?'always':'deny');
 if(mode==='deny')throw Error('Permission disabled: '+name);
 if(mode==='ask'){
  if(!context.authorize)throw Error('Approval required: open the desktop app to answer this request');
  const decision=await context.authorize({clientId:id,clientName:context.clientName||id,capability:name,summary:context.summary||name,details:context.details||''});
  if(settings().emergencyStop)throw Error('Emergency stop is active');
  if(context.isActive&&!context.isActive())throw Error('Client access has been revoked');
  assertExecution(context.summary,settings(),context);
  if(settings().clientPolicies[id]?.[name]==='deny')throw Error('Permission revoked during approval');
  if(!['once','always'].includes(decision))throw Error('Permission denied');
  if(decision==='always'){const fresh=settings();fresh.clientPolicies[id]={...fresh.clientPolicies[id],[name]:'always'};saveSettings(fresh);}
 } else if(mode!=='always')throw Error('Permission disabled: '+name);
}

function allowedPath(p){if(typeof p!=='string'||!p.trim())throw Error('A path is required');const abs=path.resolve(p);const real=fs.realpathSync(abs);const protectedRoot=fs.existsSync(root)?fs.realpathSync(root):path.resolve(root);if(real===protectedRoot||real.startsWith(protectedRoot+path.sep))throw Error('Bridge credentials and policy files are protected');const folders=settings().directories; if(!folders.some(d=>{try{const base=fs.realpathSync(d);return real===base||real.startsWith(base+path.sep);}catch{return false;}}))throw Error('Path is outside approved folders');return real;}
function writePath(p){const dest=path.resolve(p); const parent=allowedPath(path.dirname(dest));const target=path.join(parent,path.basename(dest));if(fs.existsSync(target)||fs.lstatSync(target,{throwIfNoEntry:false})){const actual=allowedPath(target);if(!fs.statSync(actual).isFile())throw Error('Target must be a regular file');return actual;}return target;}
const definitions=[
{name:'bridge_status',description:'Show bridge status and permission flags',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'list_files',description:'List a directory inside approved folders',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
{name:'read_text_file',description:'Read UTF-8 text inside approved folders',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
{name:'write_text_file',description:'Write UTF-8 text inside approved folders (requires write permission)',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}},
{name:'run_command',description:'Run a command with argument array inside an approved working directory (requires terminal permission)',inputSchema:{type:'object',properties:{command:{type:'string'},args:{type:'array',items:{type:'string'}},cwd:{type:'string'}},required:['command','cwd']}},
{name:'desktop_mouse',description:'Move or click the desktop mouse (requires Accessibility permission)',inputSchema:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'},click:{type:'boolean'}},required:['x','y']}},
{name:'desktop_type',description:'Type text into focused desktop application (requires Accessibility permission)',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}},
{name:'open_application',description:'Open a named desktop application',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name']}},
{name:'desktop_screenshot',description:'Capture desktop screen after OS approval (requires screenshot permission)',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'};
definitions.push(
 {name:'desktop_key',description:'Press a key with optional command/control/option/shift modifiers',inputSchema:obj({key:string,modifiers:{type:'array',items:string}},['key'])},
 {name:'process_start',description:'Start a terminal process; working directory is checked, but this is NOT a filesystem sandbox. Returns a process ID for polling.',inputSchema:obj({command:string,args:{type:'array',items:string},cwd:string,timeoutMs:{type:'integer'}},['command','cwd'])},
 {name:'process_list',description:'List terminal processes started by this authenticated AI client',inputSchema:obj({})},
 {name:'process_output',description:'Read bounded terminal output for this client’s process',inputSchema:obj({id:string},['id'])},
 {name:'process_input',description:'Send stdin to this client’s running process',inputSchema:obj({id:string,input:string},['id','input'])},
 {name:'process_stop',description:'Stop this client’s running terminal process and its process group',inputSchema:obj({id:string},['id'])},
 {name:'file_info',description:'Read file metadata within approved folders',inputSchema:obj({path:string},['path'])},
 {name:'make_directory',description:'Create one directory within an approved folder',inputSchema:obj({path:string},['path'])},
 {name:'move_file',description:'Move a file within approved folders; never overwrites a destination',inputSchema:obj({source:string,destination:string},['source','destination'])},
 {name:'trash_file',description:'Move a file or folder into recoverable bridge trash; does not permanently delete it',inputSchema:obj({path:string},['path'])},
 {name:'search_files',description:'Search names recursively in approved folders, optionally return largest files. Skips symlinks, .git and node_modules.',inputSchema:obj({path:string,query:string,sort:{type:'string',enum:['name','size']},limit:{type:'integer',minimum:1,maximum:500}},['path'])}
);
const mouse=definitions.find(x=>x.name==='desktop_mouse');mouse.inputSchema=obj({action:{type:'string',enum:['move','click','drag','scroll']},x:{type:'number'},y:{type:'number'},toX:{type:'number'},toY:{type:'number'},click:{type:'boolean'},button:{type:'string',enum:['left','right']},count:{type:'integer',enum:[1,2]},dx:{type:'integer'},dy:{type:'integer'}});
definitions.push({name:'get_profile',description:'Return the authenticated computer connection profile, without credentials or file content',inputSchema:obj({}),outputSchema:{type:'object',properties:{id:{type:'string'},name:{type:'string'},nickname:{type:'string'}},required:['id'],additionalProperties:false},_meta:{'openai/profile':true}});
definitions.push({name:'desktop_release',description:'Release only your own shared-desktop lease after completing a mouse/keyboard sequence',inputSchema:obj({})},{name:'desktop_lease_status',description:'Check whether the shared physical desktop is available, without exposing another AI identity',inputSchema:obj({})});
for(const d of definitions){d.securitySchemes=[{type:'oauth2',scopes:['bridge:tools']}];d._meta={...d._meta,securitySchemes:d.securitySchemes};d.inputSchema.additionalProperties=false;d.annotations={readOnlyHint:['desktop_lease_status','get_profile','bridge_status','list_files','read_text_file','file_info','search_files','process_list','process_output','desktop_screenshot'].includes(d.name),destructiveHint:['write_text_file','run_command','process_start','process_input','process_stop','desktop_mouse','desktop_key','desktop_type','trash_file','move_file'].includes(d.name),openWorldHint:['run_command','process_start','open_application','desktop_mouse','desktop_type','desktop_key'].includes(d.name)};}

async function perform(name,args={},context={}){
context={...context,summary:name,details:JSON.stringify(args,(key,value)=>['content','text','input'].includes(key)?'[content omitted]':value).slice(0,4096)};
const clientId=context.clientId||process.env.REDXDEX_CLIENT_ID||'local';
context.clientId=clientId;
assertExecution(name,settings(),context);
if(FOCUS_ACTIONS.has(name)&&context.desktopLocked!==true){
 return desktopLease.run(clientId,()=>perform(name,args,{...context,desktopLocked:true}),()=>{const s=settings();if(s.emergencyStop)throw Error('Emergency stop is active');if(context.isActive&&!context.isActive())throw Error('Client access revoked');assertExecution(name,s,context);});
}
if(name==='desktop_release')return {text:JSON.stringify(desktopLease.release(clientId))};
if(name==='desktop_lease_status')return {text:JSON.stringify(desktopLease.status(clientId))};
if(name==='get_profile'){
 const file=path.join(root,'profile.json');let profile;
 if(fs.existsSync(file))profile=JSON.parse(fs.readFileSync(file,'utf8'));
 else {profile={id:require('node:crypto').randomUUID()};require('./clients.cjs').atomicJSON(file,profile);}
 if(typeof profile.id!=='string'||!profile.id)throw Error('Connection profile is invalid');
 const value={id:profile.id,name:'RedXDexAiBridge on '+os.hostname(),nickname:os.hostname()};
 return {text:JSON.stringify(value),structuredContent:value};
}
if(name==='bridge_status'){const s=settings();return {text:JSON.stringify({app:'RedXDexAiBridge',version:require('../package.json').version,platform:process.platform,transport:context.transport||'stdio',clientId,emergencyStop:s.emergencyStop,permissions:s.permissions,clientPermissions:s.clientPolicies[clientId]||{},backgroundOnly:backgroundOnly(s,clientId),desktopLease:desktopLease.status(clientId),concurrency:{processes:s.maxProcesses,processesPerClient:s.maxProcessesPerClient,requests:s.maxConcurrentRequests,requestsPerClient:s.maxRequestsPerClient},approvedFolders:s.directories},null,2)};}
if(name==='list_files'){await ensurePermission('list',context);const p=allowedPath(args.path);return{text:JSON.stringify(fs.readdirSync(p,{withFileTypes:true}).slice(0,500).map(e=>({name:e.name,type:e.isDirectory()?'directory':'file'})),null,2)};}
if(name==='read_text_file'){await ensurePermission('read',context);const p=allowedPath(args.path);const fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('Target must be a regular file');if(stat.size>settings().maxReadBytes)throw Error('File exceeds read size limit');const content=fs.readFileSync(fd,'utf8');if(Buffer.byteLength(content)>settings().maxReadBytes)throw Error('File exceeds read size limit');return{text:content};}finally{fs.closeSync(fd)}}
if(name==='write_text_file'){await ensurePermission('write',context);if(typeof args.content!=='string'||Buffer.byteLength(args.content)>settings().maxReadBytes)throw Error('Invalid or oversized content');const p=writePath(args.path);const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|(fs.constants.O_NOFOLLOW||0);const fd=fs.openSync(p,flags,0o600);try{if(!fs.fstatSync(fd).isFile())throw Error('Target must be a regular file');fs.ftruncateSync(fd,0);fs.writeFileSync(fd,args.content);}finally{fs.closeSync(fd)}return{text:'Saved '+p};}
if(name==='run_command'){await ensurePermission('terminal',context);const cwd=allowedPath(args.cwd);if(!fs.statSync(cwd).isDirectory())throw Error('cwd must be a directory');const session=processes.start({command:args.command,args:args.args||[],cwd,clientId,timeoutMs:15000});let output;do{await new Promise(r=>setTimeout(r,30));if(settings().emergencyStop||(context.isActive&&!context.isActive())){processes.stop(session.id,clientId);throw Error('Command stopped because access was disabled');}output=processes.read(session.id,clientId);}while(output.running);return {text:output.output.slice(-settings().maxOutputBytes)+'\nExit code: '+output.exitCode};}
if(name==='open_application'){await ensurePermission('apps',context);return native.openApplication(args.name);}
if(name==='desktop_type'){await ensurePermission('keyboard',context);if(typeof args.text!=='string'||args.text.length>8000)throw Error('Text must be 8000 characters or fewer');await native.control({action:'type',text:args.text});return {text:'Typed into focused application'};}
if(name==='desktop_key'){await ensurePermission('keyboard',context);await native.control({action:'key',key:args.key,modifiers:args.modifiers||[]});return {text:'Key sent'};}
if(name==='desktop_mouse'){await ensurePermission('mouse',context);const action=args.action||(args.click?'click':'move');if(!['move','click','drag','scroll'].includes(action))throw Error('Invalid mouse action');await native.control({...args,action});return {text:'Mouse action completed: '+action};}
if(name==='desktop_screenshot'){await ensurePermission('screenshot',context);return {image:await native.screenshot()};}
if(name==='process_start'){await ensurePermission('terminal',context);const cwd=allowedPath(args.cwd);return {text:JSON.stringify(processes.start({...args,cwd,clientId}))};}
if(name==='process_list'){await ensurePermission('terminal',context);return {text:JSON.stringify(processes.list(clientId))};}
if(name==='process_output'){await ensurePermission('terminal',context);return {text:JSON.stringify(processes.read(args.id,clientId))};}
if(name==='process_input'){await ensurePermission('terminal',context);return {text:JSON.stringify(processes.input(args.id,clientId,args.input))};}
if(name==='process_stop'){await ensurePermission('terminal',context);return {text:JSON.stringify(processes.stop(args.id,clientId))};}
if(name==='file_info'){await ensurePermission('list',context);const p=allowedPath(args.path),s=fs.statSync(p);return {text:JSON.stringify({path:p,type:s.isDirectory()?'directory':'file',size:s.size,modified:s.mtime.toISOString()})};}
if(name==='make_directory'){await ensurePermission('write',context);const parent=allowedPath(path.dirname(path.resolve(args.path))),target=path.join(parent,path.basename(args.path));fs.mkdirSync(target,{mode:0o700});return {text:'Created '+target};}
if(name==='move_file'){await ensurePermission('write',context);const from=allowedPath(args.source),to=writePath(args.destination);if(settings().directories.includes(from))throw Error('Cannot move an approved root folder');if(fs.existsSync(to))throw Error('Destination already exists');fs.renameSync(from,to);return {text:'Moved to '+to};}
if(name==='trash_file'){await ensurePermission('write',context);const from=allowedPath(args.path);if(settings().directories.includes(from))throw Error('Cannot trash an approved root folder');const dir=path.join(root,'trash');fs.mkdirSync(dir,{recursive:true,mode:0o700});const to=path.join(dir,require('node:crypto').randomUUID()+'-'+path.basename(from));fs.renameSync(from,to);return {text:'Moved to recoverable bridge trash: '+to};}
if(name==='search_files'){await ensurePermission('list',context);const base=allowedPath(args.path),query=String(args.query||'').toLowerCase();let visited=0,results=[],queue=[base];while(queue.length&&visited<20000){const dir=queue.shift();for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(++visited>20000)break;const p=path.join(dir,e.name);if(e.isSymbolicLink())continue;try{allowedPath(p);}catch{continue;}if(e.isDirectory()){if(!['node_modules','.git'].includes(e.name))queue.push(p);}else if(e.isFile()&&e.name.toLowerCase().includes(query)){const st=fs.statSync(p);results.push({path:p,size:st.size});if(results.length>5000)break;}}if(results.length>5000)break;}if(args.sort==='size')results.sort((a,b)=>b.size-a.size);return {text:JSON.stringify({results:results.slice(0,Math.min(Math.max(Number(args.limit)||100,1),500)),visited,truncated:queue.length>0||results.length>500})};}
throw Error('Unknown tool '+name);
}
module.exports={settings,saveSettings,allowedPath,perform,definitions,configPath,root,processes,ensurePermission,desktopLease};
