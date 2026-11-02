'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function dimensions(bytes,type){
 let width=0,height=0;
 if(type==='image/png'){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes.readUInt32BE(8)!==13||bytes.subarray(12,16).toString()!=='IHDR')throw Error('Invalid PNG image');
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);let offset=8,ended=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset);if(length>bytes.length-offset-12)throw Error('Truncated PNG image');const kind=bytes.subarray(offset+4,offset+8).toString();offset+=length+12;if(kind==='IEND'){ended=true;break;}}
  if(!ended||offset!==bytes.length)throw Error('Invalid PNG container');
 }else if(type==='image/jpeg'){
  if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Invalid JPEG image');let offset=2;
  while(offset+4<bytes.length){if(bytes[offset++]!==255)throw Error('Invalid JPEG marker');let marker=bytes[offset++];while(marker===255)marker=bytes[offset++];if(marker===218)break;if(marker===216||marker===217||marker===1||(marker>=208&&marker<=215))continue;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw Error('Truncated JPEG image');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw Error('Invalid JPEG dimensions');height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);}offset+=length;}
 }else if(type==='image/webp'){
  if(bytes.length<30||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Invalid WebP image');const kind=bytes.subarray(12,16).toString();if(kind==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}else if(kind==='VP8 '&&bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}else if(kind==='VP8L'&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
 }else throw Error('Upload a PNG, JPEG or WebP image');
 if(!width||!height||width>4096||height>4096||width*height>16000000)throw Error('Plugin image dimensions must be at most 4096 pixels per side and 16 million pixels');
 return{width,height};
}
class PluginMediaStore{
 constructor(directory){this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true,mode:0o700});}
 put(bytes,type){if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>5*1024*1024)throw Error('Plugin image must be at most 5 MiB');dimensions(bytes,type);const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];const name=crypto.createHash('sha256').update(bytes).digest('hex')+'.'+ext;try{fs.writeFileSync(path.join(this.directory,name),bytes,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}return '/bridge-platform/media/'+name;}
 get(name){if(!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name))return null;try{return{bytes:fs.readFileSync(path.join(this.directory,name)),type:name.endsWith('.png')?'image/png':name.endsWith('.jpg')?'image/jpeg':'image/webp'};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
}
module.exports={PluginMediaStore,dimensions};
