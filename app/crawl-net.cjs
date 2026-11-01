'use strict';
const dns=require('node:dns').promises;
const net=require('node:net');
const http=require('node:http'),https=require('node:https');

function normalizeTarget(input,base){
 if(typeof input!=='string'||!input.trim()||input.length>2048)throw Error('Crawl URL must be a valid public HTTP(S) address');
 let url;try{url=new URL(input,base);}catch{throw Error('Invalid crawl URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.href.length>2048)throw Error('Only public HTTP(S) websites on standard ports are allowed');
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
 if(!host||host.length>253||net.isIP(host)||!host.includes('.')||/(^|\.)(localhost|local|internal|test|invalid|example|home|lan)$/.test(host)||host.endsWith('.home.arpa'))throw Error('Private or local websites are not allowed');
 if(!/^[a-z0-9.-]+$/.test(host))throw Error('Invalid website hostname');
 url.hash='';
 return url;
}
function publicAddress(ip){
 if(net.isIP(ip)===4){
  const [a,b,c,d]=ip.split('.').map(Number);
  return a>=1&&a<=223&&
   a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&
   !(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&
   !(a===192&&[0,168].includes(b))&&!(a===192&&b===88&&c===99)&&
   !(a===198&&(b===18||b===19||b===51&&c===100))&&
   !(a===203&&b===0&&c===113)&&!(a===192&&b===0&&c===2)&&
   !(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113)&&
   !(a===255&&b===255&&c===255&&d===255);
 }
 if(net.isIP(ip)===6){
  const x=ip.toLowerCase();
  if(!/^[23][0-9a-f]{3}:/.test(x))return false;
  return !x.startsWith('2001:db8:')&&!x.startsWith('2001:0:')&&!x.startsWith('2002:')&&!x.startsWith('2001:20:');
 }
 return false;
}
async function pinnedAddress(url,lookup=dns.lookup){
 const records=await lookup(url.hostname,{all:true,verbatim:true});
 if(!Array.isArray(records)||!records.length||records.some(x=>!publicAddress(x.address)))throw Error('Website resolves to a private, reserved or invalid network address');
 return records[0];
}
function requestPinned(url,{lookup=dns.lookup,signal,maxBytes=384*1024,timeoutMs=9000}={}){
 return pinnedAddress(url,lookup).then(ip=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('Crawl stopped'));
  const module=url.protocol==='https:'?https:http;
  const opts={hostname:url.hostname,port:url.protocol==='https:'?443:80,path:url.pathname+url.search,
   method:'GET',signal,timeout:timeoutMs,servername:url.hostname,
   lookup:(_hostname,_opts,cb)=>cb(null,ip.address,ip.family),
   headers:{'User-Agent':'RedXDexAiBridge-Crawler/0.10.9','Accept':'text/html,text/plain,application/xhtml+xml','Accept-Encoding':'identity','Connection':'close'}};
  let settled=false;const settle=(error,data)=>{if(settled)return;settled=true;error?reject(error):resolve(data);};
  const req=module.request(opts,res=>{
   const status=res.statusCode||0;
   if([301,302,303,307,308].includes(status)){res.resume();return settle(null,{status,location:res.headers.location||'',url:url.href,text:''});}
   if(status!==200){res.resume();return settle(null,{status,url:url.href,text:''});}
   const type=String(res.headers['content-type']||'').split(';')[0].toLowerCase();
   if(!['text/html','text/plain','application/xhtml+xml'].includes(type)){res.resume();return settle(null,{status:415,url:url.href,text:''});}
   if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.resume();return settle(Error('Compressed crawl responses are not accepted'));}
   if(Number(res.headers['content-length'])>maxBytes){res.resume();return settle(Error('Crawl page exceeds the byte limit'));}
   let size=0;const parts=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(Error('Crawl page exceeds the byte limit'));return;}parts.push(chunk);});
   res.on('error',e=>settle(e));
   res.on('end',()=>settle(null,{status,url:url.href,text:Buffer.concat(parts).toString('utf8'),contentType:type}));
  });
  req.once('error',e=>settle(e));
  req.once('timeout',()=>req.destroy(Error('Crawl request timed out')));
  req.end();
 }));
}
async function fetchPublicPage(input,options={}){
 const origin=normalizeTarget(input),lookup=options.lookup||dns.lookup;
 let current=origin;
 for(let i=0;i<4;i++){
  const response=await requestPinned(current,{...options,lookup});
  if(![301,302,303,307,308].includes(response.status))return response;
  if(i===3)throw Error('Too many website redirects');
  if(!response.location)throw Error('Website returned a redirect without a location');
  const next=normalizeTarget(response.location,current.href);
  if(next.origin!==origin.origin)throw Error('Crawl redirects must remain on the same website');
  current=next;
 }
 throw Error('Too many website redirects');
}
function robotsRules(text,userAgent='redxdexaibridge'){
 const groups=[];let agents=[],rules=[];
 const flush=()=>{if(agents.length)groups.push({agents,rules});agents=[];rules=[];};
 for(const raw of String(text||'').slice(0,65536).split(/\r?\n/)){
  const line=raw.split('#',1)[0].trim(),match=/^([a-z-]+)\s*:\s*(.*)$/i.exec(line);if(!match)continue;
  const key=match[1].toLowerCase(),value=match[2].trim();
  if(key==='user-agent'){if(rules.length)flush();agents.push(value.toLowerCase());}
  else if(agents.length&&['allow','disallow','crawl-delay'].includes(key))rules.push({key,value});
 }
 flush();
 const agent=userAgent.toLowerCase();
 const best=Math.max(0,...groups.flatMap(g=>g.agents.map(a=>a==='*'?1:a&&agent.includes(a)?a.length+1:0)));
 const selected=groups.filter(g=>g.agents.some(a=>(a==='*'?1:a&&agent.includes(a)?a.length+1:0)===best));
 const directives=selected.flatMap(g=>g.rules);
 const delayDirective=directives.find(r=>r.key==='crawl-delay');
 const requestedDelay=delayDirective?Number(delayDirective.value)*1000:200;
 if(!Number.isFinite(requestedDelay)||requestedDelay>30000)throw Error('Website crawl-delay exceeds the safe 30-second limit; refusing to crawl');
 const delayMs=Math.max(200,requestedDelay);
 return {delayMs,allowed(url){
  const p=typeof url==='string'?url:new URL(url).pathname;
  let match=null;
  for(const rule of directives){
   if(!['allow','disallow'].includes(rule.key)||!rule.value)continue;
   const target=rule.value.replace(/\*.*$/,'').replace(/\$$/,'');
   if(p.startsWith(target)&&(!match||rule.value.length>match.value.length||rule.value.length===match.value.length&&rule.key==='allow'))match=rule;
  }
  return !match||match.key==='allow';
 }};
}
function pageText(html){
 const stripped=String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ');
 const title=/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripped)?.[1]||'';
 const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'"}[x.toLowerCase()]||x));
 return {title:decode(title.replace(/<[^>]*>/g,' ').trim()).slice(0,200),
  text:decode(stripped.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).slice(0,3500)};
}
function pageLinks(html,current,origin){
 const result=[],seen=new Set();
 const re=/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
 for(const match of String(html).matchAll(re)){
  if(result.length>=100)break;
  const raw=(match[1]||match[2]||match[3]||'').replace(/&amp;/gi,'&');
  try{const u=normalizeTarget(raw,current);if(u.origin!==origin||seen.has(u.href))continue;seen.add(u.href);result.push(u.href);}catch{}
 }
 return result;
}
module.exports={normalizeTarget,publicAddress,pinnedAddress,requestPinned,fetchPublicPage,robotsRules,pageText,pageLinks};
