'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=x=>structuredClone(x);
const empty=()=>({schema:1,revision:0,members:{},plugins:{},admins:[],bans:[],payments:{},orders:{},sessions:{},nonces:{},audit:[]});
function bridgeDatabaseName(database){
 if(typeof database!=='string'||database.length>64||database.trim()!==database)throw Error('An explicit isolated Bridge database is required');
 const match=/^(?:t([a-f0-9]{10})_)?(bridge_platform(?:_[a-z0-9]+)*)$/.exec(database);
 // Native tenant provisioning prefixes the logical name with its account
 // hash. Preserve that exact physical name; the host still enforces ownership.
 if(!match||(match[1]!==undefined&&match[2].length>50))throw Error('An explicit isolated Bridge database is required');
 return database;
}
class Conflict extends Error{constructor(){super('Concurrent platform change; retry the operation');this.code='store_conflict';}}
class MemoryStore {
 constructor(){this.value=empty();this.productionReady=false;}
 async load(){return clone(this.value);}
 async save(next,expected){if(this.value.revision!==expected)throw new Conflict();this.value=clone(next);}
}
class FileStore {
 constructor(file,{development=false}={}){if(!development)throw Error('File storage is development-only; production requires the account RedX database');this.file=path.resolve(file);this.productionReady=false;}
 async load(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
 async save(next,expected){const current=await this.load();if(current.revision!==expected)throw new Conflict();fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);if(process.platform!=='win32'){const d=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}}
}
class RedXStore {
 constructor({base,key,database,recordKey='bridge-platform-v1',request=fetch}){
  database=bridgeDatabaseName(database);
  const u=new URL(base);if(!((u.protocol==='https:'&&!u.username&&!u.password)||(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)))||u.pathname!=='/'||u.search||u.hash)throw Error('Trusted RedX origin required');
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(database)||typeof key!=='string'||key.length<16)throw Error('Scoped server-side RedX configuration required');
  this.base=u.origin+'/v1/db/'+database;this.key=key;this.request=request;if(!/^[A-Za-z0-9_-]{3,64}$/.test(recordKey))throw Error('Invalid state namespace');this.recordKey=recordKey;this.id=parseInt(crypto.createHash('sha256').update(this.recordKey).digest('hex').slice(0,13),16);this.productionReady=true;
  this.recordPath='/record-cas/'+encodeURIComponent('rxa-bridge-platform.red-xai.db:Record[ID='+this.id+']');
 }
 async call(suffix,options={}){const r=await this.request(this.base+suffix,{...options,headers:{authorization:'Bearer '+this.key,accept:'application/json','content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});return r;}
 async load(){
  const r=await this.call(this.recordPath);if(r.headers?.get('x-redx-record-cas')!=='1')throw Error('Account database record-CAS capability unavailable');
  if(r.status===404){if((await r.json())?.code==='record_not_found')return empty();throw Error('Account database unavailable');}if(r.status!==200||!r.ok)throw Error('Account database unavailable');
  const body=await r.json(),record=body?.record;
  if(!record||record.key!==this.recordKey||!Number.isSafeInteger(record.revision)||record.revision<1||typeof record.payload!=='string')throw Error('Invalid platform state or RedX record collision');
  const state=JSON.parse(record.payload);
  if(!state||state.key!==this.recordKey||state.schema!==1||state.revision!==record.revision)throw Error('Invalid platform state or RedX record collision');return state;
 }
 async save(next,expected){
  if(!Number.isSafeInteger(expected)||expected<0||!next||next.schema!==1||!Number.isSafeInteger(next.revision)||next.revision!==expected+1||next.key!==undefined&&next.key!==this.recordKey)throw Error('Invalid platform state revision');
  const record={key:this.recordKey,revision:next.revision,payload:JSON.stringify({...next,key:this.recordKey})};
  // A query-layer transaction does not isolate other REST writers or provide
  // native crash atomicity. Require the dedicated synchronous record-CAS API;
  // an older server is unavailable rather than silently falling back to BoxQL.
  const r=await this.call(this.recordPath,{method:'POST',body:JSON.stringify({expected_revision:expected,record})});if(r.headers?.get('x-redx-record-cas')!=='1')throw Error('Account database record-CAS capability unavailable');if(r.status===409)throw new Conflict();if(r.status!==200||!r.ok)throw Error('Account database refused platform write');
  // A host replication-log offset is not proof of this file's durable commit.
  // Require the native-file watermark; seq is only its compatibility alias.
  const ack=await r.json();if(ack?.ok!==true||ack.revision!==next.revision||ack.sequence_scope!=='native-file'||!Number.isSafeInteger(ack.local_seq)||ack.local_seq<1||ack.seq!==ack.local_seq)throw Error('Account database did not confirm a durable platform write');
 }
}
module.exports={MemoryStore,FileStore,RedXStore,Conflict,empty,bridgeDatabaseName};
