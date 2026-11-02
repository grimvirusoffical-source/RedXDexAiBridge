'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {selectReleaseArtifacts}=require('../scripts/select-release-artifacts.cjs');
const runId=41463269617,repositoryId=1436326204,headSha='d5ca49b799df6ada6a3694ce1cb65bb2d46f50a8';
const workflow_run={id:runId,repository_id:repositoryId,head_repository_id:repositoryId,head_branch:'v0.10.17',head_sha:headSha};
// Real retry incident metadata: the correct later upload has the LOWER ID.
const correctWin={id:13150139466,name:'bridge-win',size_in_bytes:137112606,expired:false,created_at:'2026-11-02T14:42:53Z',digest:'sha256:39adb2809faeadede5157d2656aa560c4d28d9311a1445aa1eba624abb1edfb0',workflow_run};
const staleWin={id:13150851044,name:'bridge-win',size_in_bytes:92120,expired:false,created_at:'2026-11-02T14:36:11Z',digest:'sha256:bf76d2aa21682c8e1945ab7ecf56e6e05a413e8914f06f01f828ab0497fff410',workflow_run};
const linux={id:13150637723,name:'bridge-linux',size_in_bytes:266827368,expired:false,created_at:'2026-11-02T14:37:59Z',digest:'sha256:3da9def06adff915b8e2d80ff89b389314f00da3f5a4540b4d23dbed08b2720d',workflow_run};
const defaults=()=>[staleWin,linux,correctWin].map(value=>structuredClone(value));
function select(artifacts=defaults(),overrides={}){return selectReleaseArtifacts({pages:[{total_count:artifacts.length,artifacts}],runId,headSha,repositoryId,...overrides});}
test('selects the newest creation time, not ID, response order or update time',()=>{
 for(const artifacts of [defaults(),defaults().reverse(),[structuredClone(correctWin),structuredClone(staleWin),structuredClone(linux)]]){
  artifacts.find(value=>value.id===staleWin.id).updated_at='2026-11-02T14:59:59Z';
  const result=select(artifacts);assert.deepEqual(result.artifactIds,[correctWin.id,linux.id]);assert.equal(result.artifactIdsCsv,'13150139466,13150637723');assert.equal(result.artifacts[0].digest,correctWin.digest);
 }
 assert.deepEqual(select(defaults(),{runId:String(runId),repositoryId:String(repositoryId)}).artifactIds,[correctWin.id,linux.id]);
 const expiredOld=defaults();expiredOld[0].expired=true;assert.deepEqual(select(expiredOld).artifactIds,[correctWin.id,linux.id]);
});
test('requires every page and safely deduplicates identical pagination overlap',()=>{
 const artifacts=defaults();const result=selectReleaseArtifacts({runId,headSha,repositoryId,pages:[{total_count:3,artifacts:artifacts.slice(0,2)},{total_count:3,artifacts:[artifacts[1],artifacts[2]]}]});assert.deepEqual(result.artifactIds,[correctWin.id,linux.id]);
 assert.throws(()=>select(artifacts,{pages:[{total_count:3,artifacts:artifacts.slice(0,2)}]}),/Incomplete/);
 assert.throws(()=>select(artifacts,{pages:[{total_count:3,artifacts},{total_count:4,artifacts:[]}]}),/changed during pagination/);
 assert.throws(()=>select([...artifacts,{...correctWin,digest:'sha256:'+'a'.repeat(64)}]),/Conflicting metadata/);
});
test('refuses ambiguous newest creation times instead of breaking ties with IDs',()=>{
 assert.throws(()=>select([...defaults(),{...correctWin,id:correctWin.id+1}]),/Ambiguous/);
 assert.throws(()=>select([...defaults(),{...correctWin,id:correctWin.id+1,created_at:'2026-11-02T14:42:53.000Z'}]),/Ambiguous/);
});
test('rejects missing releases and any candidate with wrong run, SHA or repository binding',()=>{
 for(const name of ['bridge-win','bridge-linux'])assert.throws(()=>select(defaults().filter(value=>value.name!==name)),/Missing release artifact/);
 for(const mutate of [v=>delete v.workflow_run,v=>v.workflow_run.id++,v=>v.workflow_run.head_sha='a'.repeat(40),v=>v.workflow_run.repository_id++,v=>v.workflow_run.head_repository_id++,v=>delete v.workflow_run.head_sha]){
  const artifacts=defaults();mutate(artifacts[2]);assert.throws(()=>select(artifacts),/not bound/);
 }
 const artifacts=defaults();artifacts[0].workflow_run.head_sha='b'.repeat(40);assert.throws(()=>select(artifacts),/not bound/);
});
test('refuses invalid newest metadata without reverting to an older upload',()=>{
 for(const mutate of [v=>v.expired=true,v=>delete v.expired,v=>delete v.digest,v=>v.digest='sha256:no',v=>v.digest='md5:'+'a'.repeat(64),v=>v.size_in_bytes=92120,v=>delete v.size_in_bytes,v=>v.size_in_bytes=Infinity,v=>v.size_in_bytes=1048576.5]){
  const artifacts=defaults();artifacts[0].size_in_bytes=correctWin.size_in_bytes;mutate(artifacts[2]);assert.throws(()=>select(artifacts),/Newest release artifact/);
 }
});
test('rejects missing, invalid and normalized-invalid dates, pages and identifiers',()=>{
 for(const date of [undefined,'not-a-date','2026-02-30T14:42:53Z','2026-11-02T14:42:53+00:00']){const artifacts=defaults();artifacts[2].created_at=date;assert.throws(()=>select(artifacts),/created_at/);}
 for(const overrides of [{pages:[]},{pages:[{}]},{runId:'NaN'},{repositoryId:0},{headSha:'short'},{headSha:'A'.repeat(40)}])assert.throws(()=>select(defaults(),overrides));
 for(const value of [undefined,0,-1,'13150139466',Infinity]){const artifacts=defaults();artifacts[2].id=value;assert.throws(()=>select(artifacts),/artifact ID/);}
});
test('release workflow downloads explicit selector IDs and overwrites retry uploads',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','desktop-release.yml'),'utf8');
 assert.match(workflow,/overwrite: true/);assert.match(workflow,/actions: read/);assert.match(workflow,/gh api --paginate --slurp/);
 assert.match(workflow,/artifact-ids: \$\{\{ steps\.release-artifacts\.outputs\.artifact_ids \}\}/);assert.match(workflow,/run-id: \$\{\{ github\.run_id \}\}/);
 assert.match(workflow,/node scripts\/check-production-auth\.cjs/);assert.match(workflow,/Release tag does not match package version/);assert.match(workflow,/isDraft --jq \.isDraft/);
});
