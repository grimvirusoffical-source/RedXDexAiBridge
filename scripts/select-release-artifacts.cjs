'use strict';
const {isDeepStrictEqual}=require('node:util');
const REQUIRED_NAMES=['bridge-win','bridge-linux'];
const MIN_ARCHIVE_BYTES=1024*1024;
function positiveInteger(value,label){
 if(typeof value==='string'&&/^[1-9][0-9]*$/.test(value))value=Number(value);
 if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid '+label);
 return value;
}
function creationTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))throw Error('Missing or invalid artifact created_at');
 const time=Date.parse(value),canonical=value.includes('.')?value:value.slice(0,-1)+'.000Z';
 if(!Number.isFinite(time)||new Date(time).toISOString()!==canonical)throw Error('Invalid artifact created_at');
 return time;
}
function selectReleaseArtifacts({pages,runId,headSha,repositoryId}={}){
 runId=positiveInteger(runId,'workflow run ID');repositoryId=positiveInteger(repositoryId,'repository ID');
 if(typeof headSha!=='string'||!/^[a-f0-9]{40}$/.test(headSha))throw Error('Invalid workflow commit SHA');
 if(!Array.isArray(pages)||!pages.length)throw Error('Complete paginated artifact metadata is required');
 let total;const artifacts=new Map();
 for(const page of pages){
  if(!page||!Number.isSafeInteger(page.total_count)||page.total_count<0||!Array.isArray(page.artifacts))throw Error('Invalid artifact metadata page');
  if(total===undefined)total=page.total_count;else if(page.total_count!==total)throw Error('Artifact listing changed during pagination');
  for(const artifact of page.artifacts){
   if(!artifact||typeof artifact.name!=='string')throw Error('Invalid artifact metadata');
   if(!Number.isSafeInteger(artifact.id)||artifact.id<=0)throw Error('Invalid artifact ID');
   const id=artifact.id;
   if(artifacts.has(id)&&!isDeepStrictEqual(artifacts.get(id),artifact))throw Error('Conflicting metadata for artifact '+id);
   artifacts.set(id,artifact);
  }
 }
 if(artifacts.size!==total)throw Error('Incomplete artifact listing; all pages are required');
 const selected=REQUIRED_NAMES.map(name=>{
  const candidates=[...artifacts.values()].filter(artifact=>artifact.name===name);
  if(!candidates.length)throw Error('Missing release artifact '+name);
  for(const artifact of candidates){
   const binding=artifact.workflow_run;
   if(!binding||binding.id!==runId||binding.head_sha!==headSha||binding.repository_id!==repositoryId||binding.head_repository_id!==repositoryId)throw Error('Artifact '+name+' is not bound to this repository, run and commit');
   creationTime(artifact.created_at);
  }
  // Artifact IDs are not chronological. A newer upload may have a lower ID.
  const newestTime=Math.max(...candidates.map(artifact=>creationTime(artifact.created_at)));
  const newest=candidates.filter(artifact=>creationTime(artifact.created_at)===newestTime);
  if(newest.length!==1)throw Error('Ambiguous newest release artifact '+name);
  const artifact=newest[0];
  // Never fall back to an older successful upload if the newest is invalid.
  if(artifact.expired!==false)throw Error('Newest release artifact '+name+' is expired or missing expiration metadata');
  if(!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<MIN_ARCHIVE_BYTES)throw Error('Newest release artifact '+name+' is missing or unexpectedly small');
  if(typeof artifact.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest))throw Error('Newest release artifact '+name+' lacks a valid SHA-256 digest');
  return{id:artifact.id,name,created_at:artifact.created_at,size_in_bytes:artifact.size_in_bytes,digest:artifact.digest};
 });
 return{runId,headSha,repositoryId,artifacts:selected,artifactIds:selected.map(artifact=>artifact.id),artifactIdsCsv:selected.map(artifact=>artifact.id).join(',')};
}
if(require.main===module){
 try{
  const fs=require('node:fs');
  if(process.argv.length!==3||!process.env.GITHUB_OUTPUT)throw Error('Artifact metadata file and GitHub output file are required');
  const selected=selectReleaseArtifacts({pages:JSON.parse(fs.readFileSync(process.argv[2],'utf8')),runId:process.env.GITHUB_RUN_ID,headSha:process.env.GITHUB_SHA,repositoryId:process.env.GITHUB_REPOSITORY_ID});
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'artifact_ids='+selected.artifactIdsCsv+'\n');
  console.log(JSON.stringify(selected,null,2));
 }catch(error){console.error('RELEASE BLOCKED: '+error.message);process.exitCode=1;}
}
module.exports={selectReleaseArtifacts};
