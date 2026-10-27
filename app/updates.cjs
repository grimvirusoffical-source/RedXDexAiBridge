'use strict';
// Update discovery does not execute downloaded code or silently install unsigned software.
const RELEASES_URL='https://github.com/grimvirusoffical-source/RedXDexAiBridge/releases';
function parseVersion(v){return String(v||'').replace(/^v/,'').split('.').slice(0,3).map(n=>/^\d+$/.test(n)?Number(n):0);}
function newer(a,b){const x=parseVersion(a),y=parseVersion(b);return x.some((n,i)=>n>y[i]&&x.slice(0,i).every((k,j)=>k===y[j]));}
async function checkUpdates(current,fetcher=globalThis.fetch){
 try{
 const r=await fetcher('https://api.github.com/repos/grimvirusoffical-source/RedXDexAiBridge/releases/latest',{headers:{'Accept':'application/vnd.github+json','User-Agent':'RedXDexAiBridge'},signal:AbortSignal.timeout(10000)});
 if(r.status===404)return {current,message:'No GitHub release published for RedXDexAiBridge yet; automatic updates are unavailable.',url:RELEASES_URL};
 if(!r.ok)throw Error('GitHub returned HTTP '+r.status);
 const data=await r.json();const latest=String(data.tag_name||'').replace(/^v/,'');
 if(!/^\d+\.\d+\.\d+$/.test(latest))throw Error('Unexpected release version');
 return {current,latest,updateAvailable:newer(latest,current),url:(typeof data.html_url==='string'&&data.html_url.startsWith(RELEASES_URL+'/')?data.html_url:RELEASES_URL),message:newer(latest,current)?`Update ${latest} available. Install a signed release from GitHub; automatic installation is not yet enabled.`:`You're on the latest published release (${current}).`};
 }catch(e){return {current,message:'Could not check releases: '+e.message,url:RELEASES_URL};}
}
module.exports={checkUpdates,newer,parseVersion};
