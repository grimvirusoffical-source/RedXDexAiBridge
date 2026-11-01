'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('public Markdown documentation uses neutral client terminology',()=>{
 const dir=path.resolve(__dirname,'..');
 const docs=fs.readdirSync(dir).filter(name=>/\.md$/i.test(name));
 assert.ok(docs.includes('README.md'));
 const forbidden=[/\bAI\b/i,/\bvibe[\s-]*cod(?:ing|ed)\b/i];
 for(const file of docs){
  const body=fs.readFileSync(path.join(dir,file),'utf8');
  for(const pattern of forbidden){
   assert.doesNotMatch(body,pattern,file+' must use precise, neutral terminology');
  }
 }
});
