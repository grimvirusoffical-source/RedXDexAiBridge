'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'..','distribution','cli'),name='redxai-cli-0.3.0.tgz',file=path.join(dir,name);
const expected=fs.readFileSync(path.join(dir,'SHA256SUMS-cli'),'utf8').trim().match(/^([a-f0-9]{64})\s+\*?(redxai-cli-0\.3\.0\.tgz)$/);
assert.ok(expected,'CLI checksum record');const bytes=fs.readFileSync(file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected[1]);
assert.equal(expected[1],'7e04e8171a4542a9ee8cb8c7fd5fda214313b326453cb28c054b6c4ee3efd4f9');console.log('Verified Red-XAI CLI 0.3.0 distribution integrity');
