'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8');
function handlers({packaged=false,smoke=true}={}){
 const calls=[],registered={},unavailable=new Proxy({},{get(_target,key){calls.push(['forbidden',String(key)]);throw Error('Smoke touched a platform, plugin or credential path');}}),live={status:async()=>{calls.push(['status']);return{sub:'verified-user',accepted:true};},call:async route=>{calls.push(['call',route]);return route==='/catalog'?{tiers:[]}:{url:'https://billing.stripe.com/p/session/local-test'};},checkout:async data=>{calls.push(['checkout',data]);return{url:'https://checkout.stripe.com/c/pay/local-test'};}};
 const context={app:{isPackaged:packaged},process:{env:smoke?{REDXDEX_SMOKE_OUTPUT:'/isolated-fixture'}:{}},ipc:(name,fn)=>{registered[name]=fn;},accountPlatform:smoke&&!packaged?unavailable:live,refreshPlatformAccount:()=>live.status(),pluginRunner:unavailable,accountAuth:unavailable,emit:(...args)=>calls.push(['emit',...args]),shell:{openExternal:async url=>calls.push(['open',url])},URL};
 const flag=source.match(/^const CI_SMOKE=.*;$/m);assert.ok(flag);const registrations=source.split(/\r?\n/).filter(line=>/^\s*ipc\('platform:(status|request|checkout)',/.test(line));assert.equal(registrations.length,3);
 vm.runInNewContext(flag[0]+'\n'+registrations.join('\n'),context);return{registered,calls};
}
test('isolated application smoke never reaches platform clients, plugin runners, credentials or checkout',async()=>{
 const {registered,calls}=handlers();const status=await registered['platform:status']();assert.equal(status.available,false);assert.match(status.message,/isolated application smoke/);
 for(const route of ['/catalog','/me','/plugins/checkpoints','/plugins/run','/account/delete'])await assert.rejects(registered['platform:request'](route,{}),/unavailable in the isolated application smoke test/);
 for(const kind of ['plugin','portal','stripe-dashboard'])await assert.rejects(registered['platform:checkout']({kind}),/unavailable in the isolated application smoke test/);assert.deepEqual(calls,[]);
});
test('packaged and ordinary application handlers retain their platform and payment delegation',async()=>{
 for(const options of [{packaged:true,smoke:true},{packaged:false,smoke:false}]){
  const {registered,calls}=handlers(options);assert.equal((await registered['platform:status']()).sub,'verified-user');await registered['platform:request']('/catalog');assert.equal((await registered['platform:checkout']({kind:'plugin'})).opened,true);assert.equal(calls.some(call=>call[0]==='status'),true);assert.equal(calls.some(call=>call[0]==='call'&&call[1]==='/catalog'),true);assert.equal(calls.some(call=>call[0]==='open'&&call[1].startsWith('https://checkout.stripe.com/')),true);
 }
});
test('macOS diagnostics upload runs after failed smoke steps and excludes credential profiles',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/desktop-release.yml'),'utf8'),mac=workflow.slice(workflow.indexOf('  mac-smoke:')),diagnostics=mac.slice(mac.indexOf('      - name: Upload macOS smoke diagnostics'));
 assert.match(diagnostics,/^      - name: Upload macOS smoke diagnostics\r?\n        if: always\(\)\r?\n        uses: actions\/upload-artifact@v4/m);
 for(const name of ['bridge-mac-background.log','bridge-mac-background-smoke/result.json','bridge-auth-smoke.log','bridge-auth-smoke/result.json'])assert.ok(diagnostics.includes(name));assert.match(diagnostics,/if-no-files-found: warn/);assert.doesNotMatch(diagnostics,/userData|bridge-auth-data|bridge-mac-background-data|\*\*\//);
});
