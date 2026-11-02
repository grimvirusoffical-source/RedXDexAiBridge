'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const json=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
test('release metadata and installer versions are synchronized',()=>{
 const p=json('package.json'),lock=json('package-lock.json');
 assert.equal(p.version,'0.10.17');
 assert.equal(lock.version,p.version);
 assert.equal(lock.packages[''].version,p.version);
 assert.equal(p.build.nsis.oneClick,true);
 assert.equal(p.build.nsis.perMachine,false);
 assert.equal(p.build.nsis.deleteAppDataOnUninstall,false);
 assert.ok(fs.existsSync(path.join(root,'RELEASE-'+p.version+'.md')));
});
test('Windows/Linux release must pass platform jobs and keeps unsigned Mac out of artifacts',()=>{
 const yml=fs.readFileSync(path.join(root,'.github','workflows','desktop-release.yml'),'utf8');
 assert.match(yml,/push:\s*\n\s*tags:\s*\n\s*- 'v\*'/);
 assert.match(yml,/needs: \[build, mac-smoke\]/);
 assert.match(yml,/test "\$\(find artifacts -type f -name '\*\.exe' \| wc -l\)" -ge 1/);
 assert.match(yml,/\.AppImage/);
 assert.match(yml,/\.deb/);
 assert.match(yml,/gh release edit "\$RELEASE_TAG" --draft=false/);
 assert.doesNotMatch(yml,/gh release edit "\$RELEASE_TAG" --draft=false --prerelease/);
 assert.doesNotMatch(yml,/gh release upload.*\.dmg/);
});
