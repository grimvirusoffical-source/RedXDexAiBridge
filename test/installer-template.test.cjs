'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepareTemplate}=require('../scripts/prepare-installer-template.cjs');
const packagePath=require.resolve('app-builder-lib/package.json');
const fixture=fs.readFileSync(path.join(path.dirname(packagePath),'templates/nsis/installSection.nsh'),'utf8');
test('theme patch accepts the actual pinned upstream template and is idempotent',()=>{
 const patched=prepareTemplate(fixture,'26.18.0');
 assert.doesNotMatch(patched,/SpiderBanner::Show/);
 assert.match(patched,/SetDetailsPrint textonly/);
 assert.match(patched,/!insertmacro CHECK_APP_RUNNING/);
 assert.match(patched,/!insertmacro uninstallOldVersion SHELL_CONTEXT/);
 assert.match(patched,/!insertmacro installApplicationFiles/);
 assert.equal(prepareTemplate(patched,'26.18.0'),patched);
 assert.equal(prepareTemplate(fixture.replace(/\r?\n/g,'\r\n'),'26.18.0'),patched);
});
test('theme patch rejects package upgrades and every unrelated template change',()=>{
 assert.throws(()=>prepareTemplate(fixture,'26.18.1'),/Review/);
 assert.throws(()=>prepareTemplate(fixture+'\n; changed\n','26.18.0'),/Unrecognized/);
 assert.throws(()=>prepareTemplate(fixture.replace('!insertmacro installApplicationFiles','; omitted application files'),'26.18.0'),/Unrecognized/);
 const patched=prepareTemplate(fixture,'26.18.0');
 assert.throws(()=>prepareTemplate(patched.replace('CHECK_APP_RUNNING','BROKEN_CHECK'),'26.18.0'),/Unrecognized/);
});
