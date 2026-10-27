'use strict';
const ENDPOINT='https://ai.red-xai.com/v1';
const DEFAULT_MODEL='vortex-pro';
function parseModels(json){return Array.isArray(json?.data)?json.data.map(v=>v.id).filter(x=>typeof x==='string'):[];}
function validateKey(key){if(typeof key!=='string'||!/^redx_(?:ai|xai)_[A-Za-z0-9_-]{8,}$/.test(key.trim()))throw Error('Enter a Vortex public API key (redx_ai_… or redx_xai_…). Server admin keys are different credentials and cannot authenticate to the public chat API; create a model-authorized key in Vortex → Library, Merges & Keys → API Keys.');return key.trim();}
async function request(key,path,body,fetcher=globalThis.fetch){
  validateKey(key);
  const response=await fetcher(ENDPOINT+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const message={401:'Invalid or revoked Vortex key',403:'Key not authorized for this model',404:'Model unavailable',429:'Vortex rate limit reached',502:'Vortex provider unavailable'}[response.status]||data.error?.message||'Vortex request failed';throw Error(`${message} (HTTP ${response.status})`);}
  return data;
}
async function models(key,fetcher){return parseModels(await request(key,'/models',null,fetcher));}
async function chat(key,messages,model=DEFAULT_MODEL,fetcher){
 if(!Array.isArray(messages)||messages.length<1||messages.length>60)throw Error('Invalid chat history');
 const clean=messages.map(x=>({role:x.role,content:String(x.content||'').slice(0,30000)}));
 if(clean.some(x=>!['user','assistant','system'].includes(x.role)))throw Error('Invalid message role');
 const result=await request(key,'/chat/completions',{model,messages:clean,stream:false},fetcher);
 const answer=result.choices?.[0]?.message?.content;
 if(typeof answer!=='string')throw Error('Vortex returned no text reply');return answer;
}
module.exports={ENDPOINT,DEFAULT_MODEL,parseModels,validateKey,request,models,chat};
