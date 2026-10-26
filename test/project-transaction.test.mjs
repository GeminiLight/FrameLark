import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {initProject,loadProject,setIntent,createCandidate,saveResultAudit,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {recordDiagnosis} from '../skills/photo-retouch/scripts/workflow.mjs';
import {previewPhoto} from '../skills/photo-retouch/scripts/render.mjs';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'framelark-transaction-'));t.after(()=>rm(root,{recursive:true,force:true}));const image=join(root,'source.png'),folder=join(root,'project');await writeFile(image,await sharp({create:{width:16,height:16,channels:4,background:'#789abc'}}).png().toBuffer());await initProject(image,folder);return folder;}
for(const kind of ['diagnosis','audit'])test(`slow ${kind} rendering leaves edits writable and rejects a changed preparation`,async t=>{
 const folder=await fixture(t),p=await loadProject(folder),frame=await previewPhoto(folder,'current',{maxSide:800});
 let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r),renderPreview=async()=>{enter();await gate;return frame;};
 const common={revision:p.revision,versionId:p.currentId,maxSide:800,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash};
 const pending=kind==='diagnosis'?recordDiagnosis(folder,{...common,actorId:'test',goal:'保留',preserve:['光线'],checked:['整图'],findings:[]},{renderPreview}):saveResultAudit(folder,{...common,selectionHash:frame.selectionHash,decision:'ready',summary:'保留',checked:['整图'],strengths:['光线'],issues:[]},{renderPreview});
 const result=pending.then(value=>({value}),error=>({error}));await started;
 try{await setIntent(folder,{revision:p.revision,intent:'during rendering'});}finally{release();}
 assert.equal((await result).error?.code,'STALE_REVISION');const latest=await loadProject(folder);assert.equal(latest.intent,'during rendering');assert.equal(latest.resultAudits?.length||0,0);assert.equal(latest.diagnoses?.length||0,0);
});
test('prepared rendering detects an external edit even when its revision is unchanged',async t=>{
 const folder=await fixture(t),p=await loadProject(folder),frame=await previewPhoto(folder,'current',{maxSide:800});let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 const pending=recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:800,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,actorId:'test',goal:'保留',preserve:['光线'],checked:['整图'],findings:[]},{renderPreview:async()=>{enter();await gate;return frame;}});const result=pending.catch(error=>error);await started;
 const file=join(folder,'project.json'),raw=JSON.parse(await readFile(file));raw.intent='changed without revision';await writeFile(file,JSON.stringify(raw));release();assert.equal((await result).code,'STALE_REVISION');assert.equal((await loadProject(folder)).intent,raw.intent);
});

for(const kind of ['packet','accept'])test(`slow ${kind} preparation does not lock editing and cannot commit after a new intent`,async t=>{
 const {prepareReview}=await import('../skills/photo-retouch/scripts/workflow.mjs');const folder=await fixture(t);let p=await loadProject(folder),frame=await previewPhoto(folder,'current',{maxSide:800});
 await recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:800,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,actorId:'test',goal:'保留',preserve:['光线'],checked:['整图'],findings:[]});p=await loadProject(folder);
 const {candidate}=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{exposure:.1}});p=await loadProject(folder);frame=await previewPhoto(folder,candidate.id,{maxSide:800});
 if(kind==='accept'){await saveResultAudit(folder,{revision:p.revision,versionId:candidate.id,maxSide:800,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,selectionHash:frame.selectionHash,decision:'ready',summary:'保留',checked:['整图'],strengths:['光线'],issues:[]});p=await loadProject(folder);}
 let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r),renderPreview=async()=>{enter();await gate;return frame;};
 const pending=kind==='packet'?prepareReview(folder,{revision:p.revision,versionId:candidate.id,maxSide:800},{renderPreview}):acceptCandidate(folder,{revision:p.revision,id:candidate.id,selectionHash:candidate.selectionHash,requireAudit:true},{renderPreview});const result=pending.catch(error=>error);await started;
 try{await setIntent(folder,{revision:p.revision,intent:'changed during rendering'});}finally{release();}
 assert.equal((await result).code,'STALE_REVISION');const latest=await loadProject(folder);assert.equal(latest.versions.length,p.versions.length);assert.equal(latest.reviewPackets?.length||0,0);assert.equal(latest.candidates.length,1);
});
test('cancelled render preparation never commits and metadata remains usable without native libraries',async t=>{
 const folder=await fixture(t),p=await loadProject(folder),frame=await previewPhoto(folder,'current',{maxSide:800}),abort=new AbortController();
 await assert.rejects(recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:800,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,actorId:'test',goal:'保留',preserve:['光线'],checked:['整图'],findings:[]},{signal:abort.signal,renderPreview:async()=>{abort.abort();return frame;}}),{name:'AbortError'});
 assert.deepEqual(await loadProject(folder),p);
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const script=`import {register,default as Module} from 'node:module';
 register('data:text/javascript,'+encodeURIComponent('export async function resolve(specifier,context,next){if(["sharp","@napi-rs/canvas"].includes(specifier))throw Error("native import blocked");return next(specifier,context);}'),import.meta.url);
 const original=Module._load;Module._load=function(name,...args){if(name==='sharp'||name==='@napi-rs/canvas')throw Error('native load blocked');return original.call(this,name,...args);};
 const {loadProject,setIntent}=await import(${JSON.stringify(new URL('../skills/photo-retouch/scripts/project.mjs',import.meta.url).href)});
 const {configureWorkflow}=await import(${JSON.stringify(new URL('../skills/photo-retouch/scripts/workflow.mjs',import.meta.url).href)});
 const {ProjectBridge}=await import(${JSON.stringify(new URL('../apps/studio/server/projects/bridge.mjs',import.meta.url).href)});
 const bridge=new ProjectBridge({root:process.argv[1]});try{if((await bridge.capabilities()).projects)throw Error('image capability advertised without native runtime');}finally{await bridge.close();}
 const folder=process.argv[1],p=await loadProject(folder);await setIntent(folder,{revision:p.revision,intent:'metadata without native'});const current=await loadProject(folder);await configureWorkflow(folder,{revision:current.revision,mode:'manual'});`;
 await promisify(execFile)(process.execPath,['--input-type=module','-e',script,folder]);assert.equal((await loadProject(folder)).intent,'metadata without native');
});
