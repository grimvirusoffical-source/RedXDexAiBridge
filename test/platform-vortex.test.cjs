'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const vortex = require('../app/vortex.cjs');
const preferences = require('../app/vortex-settings.cjs');
const {childEnvironment} = require('../app/platform.cjs');
const linux = require('../app/linux-control.cjs');
const {captureDesktop} = require('../app/capture.cjs');

const key = 'redx_ai_unit_test_only';
test('API endpoints are normalized and insecure remote or credential-bearing URLs rejected', () => {
  assert.equal(vortex.normalizeEndpoint('https://example.com/v1/chat/completions'), 'https://example.com/v1');
  assert.equal(vortex.normalizeEndpoint('http://127.0.0.1:18091'), 'http://127.0.0.1:18091/v1');
  for (const url of ['http://remote.example/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=test', 'https://example.com/admin']) assert.throws(() => vortex.normalizeEndpoint(url));
});
test('opaque keys reach the inference server without a client-side prefix restriction', async () => {
  const result = await vortex.models('opaque-valid-key', async (url, options) => {
    assert.equal(url,'https://custom.example/api/v1/models');
    assert.equal(options.headers.Authorization,'Bearer opaque-valid-key');
    assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({data:[{id:'vortex-pro'}]})};
  }, 'https://custom.example/api/v1');
  assert.deepEqual(result,['vortex-pro']);
});
test('DNS errors do not falsely accuse the key and never contain it', async () => {
  await assert.rejects(vortex.models(key,async()=>{throw Object.assign(Error('fetch failed'),{cause:{code:'ENOTFOUND'}});}), error => error.code==='DNS' && /not been rejected/.test(error.message) && !error.message.includes(key));
});
test('HTML proxy errors, rate limits, invalid model responses and malformed chat are explicit', async () => {
  await assert.rejects(vortex.models(key,async()=>({ok:false,status:403,headers:{get:()=> 'text/html'}})),/website\/proxy/);
  await assert.rejects(vortex.models(key,async()=>({ok:false,status:429,headers:{get:n=>n==='retry-after'?'30':'application/json'}})),error=>error.retryAfter==='30');
  assert.throws(()=>vortex.parseModels({not:'models'}),/model list/);
  await assert.rejects(vortex.chat(key,[{role:'bogus',content:'x'}]),/Invalid chat/);
});
test('endpoint preferences and editor configuration never persist or export API credentials', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rxb-vortex-'));
  try {
    const file=path.join(dir,'connection.json');
    const config=preferences.save(file,{endpoint:'http://127.0.0.1:18091/v1',model:'vortex-pro',apiKey:key});
    assert.deepEqual(preferences.load(file),config);
    assert.ok(!fs.readFileSync(file,'utf8').includes(key));
    const editor=preferences.editorConfiguration(config);
    assert.match(editor,/secrets.VORTEX_API_KEY/);assert.ok(!editor.includes(key));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Windows processes retain required system variables without passing unrelated secrets', () => {
  const result=childEnvironment({SystemRoot:'C:\\Windows',PATH:'C:\\Tools',USERPROFILE:'C:\\Users\\test',APPDATA:'C:\\Users\\test\\AppData',PRIVATE_TOKEN:'never-forward'},'win32');
  assert.equal(result.SystemRoot,'C:\\Windows');assert.equal(result.USERPROFILE,'C:\\Users\\test');assert.equal(result.PRIVATE_TOKEN,undefined);
});
test('Linux input refuses Wayland and validates coordinates/key arguments without shell evaluation', async () => {
  const calls=[];
  const options={env:{DISPLAY:':99',XDG_SESSION_TYPE:'x11'},binary:'/test/xdotool',execute:async args=>{calls.push(args);}};
  await linux.control({action:'type',text:'--not-a-flag; $(anything)'},options);
  assert.deepEqual(calls[0],['type','--clearmodifiers','--delay','1','--','--not-a-flag; $(anything)']);
  await assert.rejects(linux.control({action:'key',key:'Return;bad'},options));
  await assert.rejects(linux.control({action:'move',x:Infinity,y:0},options));
  await assert.rejects(linux.control({action:'type',text:'no'}, {...options,env:{WAYLAND_DISPLAY:'wayland-0'}}),/Wayland input permissions are not bypassed/);
});
test('macOS capture denial is respected before screen sources are requested', async () => {
  let called=false;
  await assert.rejects(captureDesktop({platform:'darwin',systemPreferences:{getMediaAccessStatus:()=> 'denied'},screen:{getPrimaryDisplay:()=>({})},desktopCapturer:{getSources:async()=>{called=true;}}}),/Enable RedXDexAiBridge/);
  assert.equal(called,false);
});
test('cross-platform capture selects primary display and returns bounded image data', async () => {
  const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
  const image={isEmpty:()=>false,toPNG:()=>bytes};
  const result=await captureDesktop({platform:'win32',screen:{getPrimaryDisplay:()=>({id:7,scaleFactor:1,size:{width:1920,height:1080}})},desktopCapturer:{getSources:async()=>[{display_id:'7',thumbnail:image}]}});
  assert.equal(Buffer.from(result,'base64').compare(bytes),0);
});
