'use strict';
// Source-only hosted CI fixture. This helper is not shipped in the application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);
function hostedWindows(){
 if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.RUNNER_OS!=='Windows'||!process.env.RUNNER_TEMP)throw Error('GUI capture requires hosted Windows CI');
 return path.join(process.env.RUNNER_TEMP,'redx-gui-smoke-capture.exe');
}
async function build(){
 const helper=hostedWindows(),compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 await run(compiler,['/nologo','/optimize+','/target:exe','/platform:x64','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+helper,path.join(__dirname,'gui-smoke-capture.cs')],{windowsHide:true,timeout:15000,maxBuffer:100000});
 return helper;
}
function validateCapture({metadata,png,ownerPid,windowHandle}){
 if(metadata?.schema!==1||metadata.captureMode!=='desktopOwnedClientRect'||metadata.ownerPid!==ownerPid||metadata.windowHandle!==windowHandle||metadata.foreground!==true||metadata.unobscured!==true||metadata.coordinateSystem!=='physical-pixels')throw Error('GUI screenshot does not belong to the verified foreground fixture');
 const b=metadata.bounds,w=metadata.windowBounds;
 if(!b||!w||![b.x,b.y,b.width,b.height,w.x,w.y,w.width,w.height].every(Number.isInteger)||b.width<200||b.height<150||b.width>4096||b.height>4096||b.x<w.x||b.y<w.y||b.x+b.width>w.x+w.width||b.y+b.height>w.y+w.height)throw Error('GUI screenshot bounds are invalid');
 if(!Buffer.isBuffer(png)||png.length<1000||png.length>16*1024*1024||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==b.width||png.readUInt32BE(20)!==b.height||crypto.createHash('sha256').update(png).digest('hex')!==metadata.sha256)throw Error('GUI screenshot bytes do not match its native capture evidence');
 if(!Number.isInteger(metadata.distinctSampleColors)||metadata.distinctSampleColors<12||!Number.isInteger(metadata.minBrightness)||!Number.isInteger(metadata.maxBrightness)||metadata.minBrightness<0||metadata.maxBrightness>255||metadata.maxBrightness-metadata.minBrightness<30)throw Error('GUI screenshot contains no rendered page detail');
 return metadata;
}
async function capture({window,output,ownerPid=process.pid}){
 const helper=hostedWindows();if(!fs.existsSync(helper))throw Error('The CI GUI capture helper was not compiled');
 window.setAlwaysOnTop(true);window.show();window.focus();await new Promise(resolve=>setTimeout(resolve,250));
 if(window.isDestroyed()||!window.isVisible()||!window.isFocused())throw Error('GUI smoke window is not focused');
 const handle=window.getNativeWindowHandle(),windowHandle=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
 await run(helper,[windowHandle,String(ownerPid),output],{windowsHide:true,timeout:10000,maxBuffer:100000});
 const metadata=JSON.parse(fs.readFileSync(output.replace(/\.png$/i,'.capture.json'),'utf8')),png=fs.readFileSync(output);
 return validateCapture({metadata,png,ownerPid,windowHandle});
}
module.exports={build,capture,validateCapture};
if(require.main===module){if(process.argv[2]!=='--build')throw Error('Expected --build');build().then(()=>console.log('Hosted CI GUI capture helper compiled')).catch(error=>{console.error(error.message);process.exitCode=1;});}
