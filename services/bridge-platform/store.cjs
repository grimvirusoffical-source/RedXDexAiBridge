'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=x=>structuredClone(x);
const empty=()=>({schema:1,revision:0,members:{},plugins:{},admins:[],bans:[],payments:{},orders:{},sessions:{},nonces:{},audit:[]});
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
 constructor({base,key,database='redxai_accounts',recordKey='bridge-platform-v1',request=fetch}){
  const u=new URL(base);if(!((u.protocol==='https:'&&!u.username&&!u.password)||(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)))||u.pathname!=='/'||u.search||u.hash)throw Error('Trusted RedX origin required');
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(database)||typeof key!=='string'||key.length<16)throw Error('Scoped server-side RedX configuration required');
  this.base=u.origin+'/v1/db/'+database;this.key=key;this.request=request;if(!/^[A-Za-z0-9_-]{3,64}$/.test(recordKey))throw Error('Invalid state namespace');this.recordKey=recordKey;this.id=parseInt(crypto.createHash('sha256').update(this.recordKey).digest('hex').slice(0,13),16);this.productionReady=true;
 }
 async call(suffix,options={}){const r=await this.request(this.base+suffix,{...options,headers:{authorization:'Bearer '+this.key,accept:'application/json','content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});return r;}
 async load(){const r=await this.call('/path/'+encodeURIComponent('rxa-bridge-platform.red-xai.db:Record[ID='+this.id+'].payload'));if(r.status===404)return empty();if(!r.ok)throw Error('Account database unavailable');const body=await r.json();const payload=typeof body.value==='string'?JSON.parse(body.value):body.value;const state=typeof payload==='string'?JSON.parse(payload):payload;if(state?.key!==this.recordKey||state.schema!==1||!Number.isSafeInteger(state.revision))throw Error('Invalid platform state or RedX record collision');return state;}
 async save(next,expected){
  const params={id:this.id,key:this.recordKey,revision:next.revision,payload:JSON.stringify({...next,key:this.recordKey})};
  const file='"rxa-bridge-platform.red-xai.db":Record';
  const q=expected===0?'{Add[]} = '+file+'[ID=$id] = [ {key[]} = $key, {revision[]} = $revision, {payload[]} = $payload ]':'{Tx[]} = [ {Require[]} = '+file+'[ID=$id, key=$key, revision=$expected], Count = 1, {Set[]} = '+file+'[ID=$id].[revision = $revision, payload = $payload] ]';
  if(expected!==0)params.expected=expected;
  const r=await this.call('/bx',{method:'POST',body:JSON.stringify({q,params})});if(r.status===409)throw new Conflict();if(!r.ok)throw Error('Account database refused platform write');
 }
}
module.exports={MemoryStore,FileStore,RedXStore,Conflict,empty};
