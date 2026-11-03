'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {atomicRename}=require('./atomic-rename.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const tmp = file + '.' + crypto.randomUUID();
  try { fs.writeFileSync(tmp, JSON.stringify(value,null,2), {mode:0o600, flag:'wx'}); atomicRename(tmp,file); fs.chmodSync(file,0o600); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
class ClientStore {
  constructor(file) { this.file = file; this.entries = {}; if (fs.existsSync(file)) { this.entries=JSON.parse(fs.readFileSync(file,'utf8')); if(!this.entries||Array.isArray(this.entries)||typeof this.entries!=='object')throw Error('Invalid client registry'); } }
  save() { atomicJSON(this.file,this.entries); }
  create(name, kind='local', id, toolProfile) {
    if(typeof name!=='string'||!name.trim()||name.length>80)throw Error('Client name must be 1–80 characters');
    id = id || 'ai_' + crypto.randomBytes(12).toString('hex');
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||Object.hasOwn(this.entries,id))throw Error('Invalid or existing client ID');
    if(kind==='restricted'&&!['terminal','crawler'].includes(toolProfile))throw Error('Restricted clients require a terminal or crawler profile');
    if(kind!=='restricted'&&toolProfile!==undefined)throw Error('Use a restricted client for a narrow tool profile');
    const token=crypto.randomBytes(32).toString('base64url');
    this.entries[id]={id,name:name.trim(),kind,tokenHash:digest(token),createdAt:Date.now(),revoked:false,...(toolProfile?{toolProfile}:{})}; this.save();
    return {id,token,name:name.trim(),kind,...(toolProfile?{toolProfile}:{})};
  }
  verify(token) {
    if(typeof token!=='string'||token.length>512)return null; const h=digest(token);
    const item=Object.values(this.entries).find(c=>!c.revoked&&c.tokenHash===h);
    return item?this.identity(item.id):null;
  }
  identity(id) {
    if(typeof id!=='string'||!Object.hasOwn(this.entries,id))return null;
    const item=this.entries[id];if(!item||typeof item!=='object'||item.revoked||item.id!==id)return null;
    const profile=Object.hasOwn(item,'toolProfile')?item.toolProfile:(item.kind==='restricted'?null:'bridge');
    if(item.kind==='restricted'&&!['terminal','crawler'].includes(profile))return null;
    if(!require('./tool-profiles.cjs').validProfile(profile))return null;
    return {id:item.id,name:item.name,kind:item.kind,toolProfile:profile};
  }
  createProfile(name,profile) {
    if(!['terminal','crawler'].includes(profile))throw Error('Choose terminal or crawler');
    return this.create(name,'restricted',undefined,profile);
  }
  exists(id) { return !!this.identity(id); }
  list() { return Object.values(this.entries).map(({tokenHash,...item})=>item); }
  revoke(id) { if(!this.entries[id])throw Error('Unknown client'); this.entries[id].revoked=true; this.save(); }
}
module.exports={ClientStore,atomicJSON,digest};
