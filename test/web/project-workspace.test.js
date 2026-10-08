import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectWorkspace} from '../../apps/studio/public/project-workspace.js';
import {createDocument} from '../../apps/studio/public/edit-stack/document.js';
import {documentHash,sha256} from '../../apps/studio/public/edit-stack/identity.js';

function fixture(t,{photo={id:'photo'},patch={settings:{exposure:0}},fetchImpl,onLoad=()=>photo,onUpdate=()=>{},onOpenVersions,getVersions=()=>[],getPhotos=()=>[photo],getPatch=()=>patch}={}){
  const previous={document:globalThis.document,location:globalThis.location,history:globalThis.history,EventSource:globalThis.EventSource,fetch:globalThis.fetch};
  const nodes=new Map(),events=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},insertAdjacentHTML(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  globalThis.document={querySelector:node,getElementById:node,body:node('body')};globalThis.location={href:'http://localhost:3177/'};globalThis.history={replaceState(){}};
  globalThis.EventSource=class{constructor(){events.push(this);}close(){this.closed=true;}};globalThis.fetch=fetchImpl;
  const workspace=createProjectWorkspace({getPhoto:()=>photo,getPhotos,getPatch,getVersions,onLoad,onUpdate,onOpenVersions,notify(){}});
  t.after(()=>{workspace.close();Object.assign(globalThis,previous);});return {workspace,photo,patch,events,node};
}
const data=(revision=1)=>({id:'project',path:'/tmp/owned-project',name:'test',revision,currentId:'current',supported:true,current:{},candidates:[],versions:[],exports:[]});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('candidate preview reads the committed selection even before the editor receives its file event',async t=>{
  let reads=0;const candidate={id:'trial',name:'试片',goal:'提亮',tradeoff:'复看',items:[],selectedItemIds:[],selectionHash:'old'};
  const env=fixture(t,{fetchImpl:async()=>response({...data(++reads),candidates:[{...candidate,selectionHash:reads===1?'old':'new'}]})});
  await env.workspace.load('project');assert.equal(env.photo.projectRevision,1);
  await env.node('project-details').listeners.click({target:{closest:()=>({dataset:{projectPreview:'trial'},hasAttribute:()=>false})}});
  assert.equal(reads,2);assert.match(env.node('project-after').src,/revision=2$/);assert.match(env.node('project-before').src,/revision=2$/);
});
test('the project entry opens edition management for its current photo after closing the project dialog',async t=>{
  const opened=[],env=fixture(t,{onOpenVersions:photo=>{assert.equal(env.node('project-dialog').open,false);opened.push(photo);},fetchImpl:async url=>response(url==='/api/local-capabilities'?{local:true,projects:true}:{projects:[]})});
  await env.workspace.attach(env.photo,data());await env.workspace.open();
  assert.ok(env.node('project-details').innerHTML.includes('data-project-editions'));
  await env.node('project-details').listeners.click({target:{closest:()=>({hasAttribute:key=>key==='data-project-editions'})}});
  assert.deepEqual(opened,[env.photo]);
});
test('an outdated project dialog cannot open editions for a different selected project',async t=>{
  let calls=0;const env=fixture(t,{onOpenVersions:()=>calls++,fetchImpl:async url=>response(url==='/api/local-capabilities'?{local:true,projects:true}:{projects:[]})});
  await env.workspace.attach(env.photo,data());await env.workspace.open();env.photo.projectId='other-project';
  await env.node('project-details').listeners.click({target:{closest:()=>({hasAttribute:key=>key==='data-project-editions'})}});
  assert.equal(calls,0);assert.equal(env.node('project-dialog').open,true);
});
test('opening the project dialog retries an unavailable initial runtime capability',async t=>{
 let probes=0;const env=fixture(t,{fetchImpl:async url=>url==='/api/local-capabilities'?response({local:true,projects:++probes>1}):response({projects:[]})});
 assert.equal((await env.workspace.capabilities()).projects,false);await env.workspace.open();assert.equal(probes,2);assert.equal(env.node('project-create').disabled,false);assert.equal(env.node('project-notice').textContent,'');
});
test('project creation waits for the dialog initial data to finish loading',async t=>{
  let finish;const env=fixture(t,{fetchImpl:async url=>url==='/api/local-capabilities'?response({local:true,projects:true}):new Promise(resolve=>{finish=()=>resolve(response({projects:[]}));})});
  await env.workspace.capabilities();const opening=env.workspace.open();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.node('project-dialog').open,true);assert.equal(env.node('project-dialog').ariaBusy,'true');assert.equal(env.node('project-create').disabled,true);
  finish();await opening;
  assert.equal(env.node('project-dialog').ariaBusy,'false');assert.equal(env.node('project-create').disabled,false);assert.ok(env.node('project-recent').innerHTML.includes('尚未保存文件项目'));
});
test('export-only events advance the file revision without turning owned edits into a conflict',async t=>{
 let saved;const photo={id:'photo'},patch={settings:{exposure:0}},remote={...data(2),exports:[{versionId:'current',path:'test.png'}]};
 const env=fixture(t,{photo,patch,fetchImpl:async(_url,options)=>{if(options?.method==='POST'){saved=JSON.parse(options.body);return response({...remote,revision:3});}return response(remote);}});
 await env.workspace.attach(photo,data());patch.settings.exposure=.2;photo.editSaving=true;await env.events[0].onmessage({data:JSON.stringify({revision:2})});assert.equal(photo.projectRevision,1);
 photo.editSaving=false;await env.workspace.refresh(photo);env.workspace.schedule(photo);await env.workspace.flush(photo);assert.equal(saved.revision,2);assert.equal(saved.settings.exposure,.2);assert.equal(env.workspace.hasPending(),false);
});
for(const change of [
  {label:'new Agent candidate',candidates:[{id:'candidate',name:'trial',selectedItemIds:[],items:[]}]},
  {label:'handoff progress',collaboration:{status:'running',request:{id:'handoff',summary:'checking the photo'}}},
  {label:'named version',versions:[{id:'edition',name:'自然版'}]}
])test(`${change.label} advances revision while keeping the dirty browser patch saveable`,async t=>{
  const {label,...metadata}=change;let saved,updates=0;
  const remote={...data(2),...metadata};
  const env=fixture(t,{onUpdate:()=>{updates++;},fetchImpl:async(_url,options)=>{
    if(options?.method==='POST'){saved=JSON.parse(options.body);return response({...remote,revision:3});}return response(remote);
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;env.workspace.schedule(env.photo);
  await env.events[0].onmessage({data:JSON.stringify({revision:2})});
  assert.equal(env.photo.projectRevision,2,'metadata refresh adopts the latest revision');
  assert.equal(env.patch.settings.exposure,.3,'the owned edit is retained');assert.equal(updates,0,'metadata cannot replace a dirty photo');
  await env.workspace.flush(env.photo);assert.equal(saved.revision,2);assert.equal(saved.settings.exposure,.3);assert.equal(env.workspace.hasPending(),false);
});
test('a remote workflow change still conflicts with dirty browser edits',async t=>{
  const env=fixture(t,{fetchImpl:async()=>response({...data(2),supported:false,limitations:'reviewed workflow'})});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;env.workspace.schedule(env.photo);
  await env.events[0].onmessage({data:JSON.stringify({revision:2})});
  assert.equal(env.photo.projectRevision,1);await assert.rejects(env.workspace.flush(env.photo),/项目已在另一处更新/);assert.equal(env.patch.settings.exposure,.3);
});
test('a metadata-only edit racing an in-flight save retries the latest owned patch',async t=>{
  const remote={...data(2),collaboration:{status:'running'}};let finish,ready;const submissions=[],waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{fetchImpl:async(_url,options)=>{
    if(options?.method!=='POST')return response(remote);
    submissions.push(JSON.parse(options.body));
    if(submissions.length===1)return new Promise(resolve=>{finish=()=>resolve(new Response(JSON.stringify({error:{code:'STALE_REVISION',message:'changed'}}),{status:409}));ready();});
    return response({...remote,revision:3});
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;env.workspace.schedule(env.photo);
  const saving=env.workspace.flush(env.photo);await waiting;
  env.patch.settings.exposure=.5;await env.events[0].onmessage({data:JSON.stringify({revision:2})});finish();await saving;
  assert.equal(submissions.length,2);assert.equal(submissions[1].revision,2);assert.equal(submissions[1].settings.exposure,.5);assert.equal(env.workspace.hasPending(),false);
});
test('a real context edit racing a save is preserved as a conflict and never retried',async t=>{
  let posts=0;const env=fixture(t,{fetchImpl:async(_url,options)=>{
    if(options?.method!=='POST')return response({...data(2),currentId:'foreign'});
    posts++;return new Response(JSON.stringify({error:{code:'STALE_REVISION',message:'foreign edit'}}),{status:409});
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;
  await assert.rejects(env.workspace.flush(env.photo),{code:'STALE_REVISION'});
  assert.equal(posts,1);assert.equal(env.patch.settings.exposure,.3);assert.equal(env.photo.projectRevision,1);assert.equal(env.workspace.hasPending(),true);
});
test('a failed stale-save reconciliation reports its failure and retains the owned patch',async t=>{
  const env=fixture(t,{fetchImpl:async(_url,options)=>{
    if(options?.method!=='POST')throw Error('connection lost during refresh');
    return new Response(JSON.stringify({error:{code:'STALE_REVISION',message:'changed'}}),{status:409});
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;
  await assert.rejects(env.workspace.flush(env.photo),/connection lost during refresh/);assert.equal(env.patch.settings.exposure,.3);assert.equal(env.workspace.hasPending(),true);
});
test('repeated metadata races stop retrying but leave the next save usable',async t=>{
  let revision=1,posts=0,allowSave=false;
  const env=fixture(t,{fetchImpl:async(_url,options)=>{
    if(options?.method!=='POST')return response({...data(revision),collaboration:{status:'running'}});
    posts++;if(allowSave)return response(data(++revision));revision++;
    return new Response(JSON.stringify({error:{code:'STALE_REVISION',message:'progress changed'}}),{status:409});
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.3;
  await assert.rejects(env.workspace.flush(env.photo),{code:'STALE_REVISION'});assert.equal(posts,2);assert.equal(env.workspace.hasPending(),true);
  allowSave=true;await env.workspace.flush(env.photo);assert.equal(posts,3);assert.equal(env.patch.settings.exposure,.3);assert.equal(env.workspace.hasPending(),false);
});
test('receipt/revision differences on the same document do not create a false draft conflict',async t=>{
 const document=createDocument({documentId:'doc',source:{assetId:'source',contentHash:'a'.repeat(64),width:8,height:8},base:{settings:{},locals:[]}}),patch={settings:{exposure:0},document};let posts=0;
 const env=fixture(t,{patch,fetchImpl:async()=>{posts++;return response(data(2));}});await env.workspace.attach(env.photo,data());patch.document={...structuredClone(document),revision:1};env.workspace.schedule(env.photo);await env.workspace.flush(env.photo);assert.equal(posts,0);assert.equal(env.workspace.hasPending(),false);
});
test('an inactive project cannot replace the active photo status or URL',async t=>{
 const a={id:'a'},b={id:'b'},env=fixture(t,{photo:a,getPhotos:()=>[a,b]});await env.workspace.attach(a,{...data(),id:'a-project',path:'/tmp/a'});await env.workspace.attach(b,{...data(),id:'b-project',path:'/tmp/b'});env.workspace.status(b);assert.equal(env.node('project-sync-status').title,'/tmp/a');assert.equal(a.projectId,'a-project');assert.equal(b.projectId,'b-project');
});
test('an export-only revision change renews the same candidate preview token once',async t=>{
 const document=createDocument({documentId:'doc',source:{assetId:'source',contentHash:'a'.repeat(64),width:8,height:8},base:{settings:{},locals:[]}}),bytes=Uint8Array.of(1,2,3),token={id:'trial',revision:1,selectionHash:'choice',documentHash:documentHash(document)},base={...data(),document},remote={...base,revision:2,exports:[{versionId:'current'}],candidates:[{id:'trial',document,selectionHash:'choice',stale:false}]};let previews=0;
 const env=fixture(t,{patch:{document},fetchImpl:async url=>{if(!url.includes('/preview?'))return response(remote);if(!previews++)return new Response(JSON.stringify({error:{code:'STALE_REVISION',message:'changed'}}),{status:409});return new Response(bytes,{headers:{'X-Project-Revision':'2','X-Version-Id':'trial','X-Selection-Hash':'choice','X-Document-Hash':token.documentHash,'X-Frame-Spec':'frame','X-Png-Hash':sha256(bytes)}});}});await env.workspace.attach(env.photo,base);assert.deepEqual(new Uint8Array(await env.workspace.renderDocumentPreview(env.photo,token)),bytes);assert.equal(previews,2);assert.equal(token.revision,2);assert.equal(env.photo.projectRevision,2);
});
test('preview renewal refuses foreign context or candidate changes',async t=>{
 const document=createDocument({documentId:'doc',source:{assetId:'source',contentHash:'a'.repeat(64),width:8,height:8},base:{settings:{},locals:[]}}),base={...data(),document},token={id:'trial',revision:1,selectionHash:'choice',documentHash:documentHash(document)};let previews=0;
 const env=fixture(t,{patch:{document},fetchImpl:async url=>{if(url.includes('/preview?')){previews++;return new Response(JSON.stringify({error:{code:'STALE_REVISION'}}),{status:409});}return response({...base,revision:2,currentId:'foreign',candidates:[{id:'trial',document,selectionHash:'choice',stale:true}]});}});await env.workspace.attach(env.photo,base);await assert.rejects(env.workspace.renderDocumentPreview(env.photo,token),{code:'STALE_REVISION'});assert.equal(previews,1);assert.equal(env.photo.projectRevision,1);
});

test('loading another project cannot suppress the active photo save',async t=>{
  const first={id:'first'},second={id:'second'},patches={first:{settings:{exposure:0}},second:{settings:{exposure:0}}};
  let release,ready,saved;
  const waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{photo:first,getPhotos:()=>[first,second],getPatch:p=>patches[p.id],
    fetchImpl:async(url,options)=>{
      if(url.endsWith('/save')){saved=JSON.parse(options.body);return response({...data(2),id:'first-project'});}
      return response({...data(),id:'second-project'});
    },onLoad:async()=>{ready();await new Promise(resolve=>{release=resolve;});return second;}});
  await env.workspace.attach(first,{...data(),id:'first-project'});
  const opening=env.workspace.load('second-project');await waiting;
  try{
    patches.first.settings.exposure=.35;env.workspace.schedule(first);
    assert.equal(env.workspace.hasPending(),true,'The active edit remains pending while another source loads');
    await env.workspace.flush(first);assert.equal(saved.settings.exposure,.35);
  }finally{release();await opening;}
});

test('opening the same file project twice shares one pending import',async t=>{
  let release,ready,loads=0;const waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{fetchImpl:async()=>response(data()),onLoad:async()=>{loads++;ready();await new Promise(resolve=>{release=resolve;});return env.photo;}});
  const first=env.workspace.load('project');await waiting;
  const second=env.workspace.load('project');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(loads,1,'one source decode and one photo insertion');
  release();await Promise.all([first,second]);assert.equal(env.events.length,1);
});

test('different imports serialize, and a failed open does not block the next one',async t=>{
  let release,ready;const waiting=new Promise(resolve=>{ready=resolve;}),opened=[];
  const env=fixture(t,{fetchImpl:async url=>response({...data(),id:url.split('/').at(-1)}),onLoad:async d=>{
    opened.push(d.id);if(d.id==='first'){ready();await new Promise(resolve=>{release=resolve;});throw Error('broken image');}return env.photo;
  }});
  const first=env.workspace.load('first'),rejected=assert.rejects(first,/broken image/);await waiting;
  const next=env.workspace.load('second');await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(opened,['first']);
  release();await rejected;await next;assert.deepEqual(opened,['first','second']);assert.equal(env.photo.projectId,'second');
  env.workspace.release(env.photo);assert.equal(env.events[0].closed,true);assert.equal(env.workspace.hasPending(),false);
});

test('an external event during a candidate mutation is drained before it finishes',async t=>{
  let finish,getCount=0,updated;
  const env=fixture(t,{fetchImpl:async(_url,options)=>options?.method==='POST'?new Promise(resolve=>{finish=value=>resolve(response(value));}):(getCount++,response(data(3))),onUpdate:(_photo,d)=>{updated=d;}});
  await env.workspace.attach(env.photo,data());const pending=env.workspace.discard(env.photo,{id:'candidate'});
  await Promise.resolve();await env.events[0].onmessage({data:JSON.stringify({revision:3})});finish(data(2));await pending;
  assert.equal(env.photo.projectRevision,3);assert.equal(updated.revision,3);assert.equal((await env.workspace.flush()).revision,3);assert.equal(getCount,1);
});

test('a remote update never overwrites an edit made while it is being read',async t=>{
  let finish;
  const env=fixture(t,{fetchImpl:()=>new Promise(resolve=>{finish=()=>resolve(response({...data(2),current:{settings:{exposure:.7}}}));}),onUpdate:()=>{throw Error('must not overwrite local edits');}});
  await env.workspace.attach(env.photo,data());const read=env.events[0].onmessage({data:JSON.stringify({revision:2})});
  await Promise.resolve();env.patch.settings.exposure=.3;finish();await read;
  assert.equal(env.photo.projectRevision,1);assert.equal(env.patch.settings.exposure,.3);assert.equal(env.workspace.hasPending(),true);
});

test('a lost mutation response still reconciles its committed file event',async t=>{
  let rejectWrite,updated;
  const env=fixture(t,{fetchImpl:async(_url,options)=>options?.method==='POST'?new Promise((_resolve,reject)=>{rejectWrite=reject;}):response(data(2)),onUpdate:(_photo,value)=>{updated=value;}});
  await env.workspace.attach(env.photo,data());const write=env.workspace.discard(env.photo,{id:'candidate'});
  await Promise.resolve();await env.events[0].onmessage({data:JSON.stringify({revision:2})});rejectWrite(Error('lost response'));await write;
  assert.equal(env.photo.projectRevision,2);assert.equal(updated.revision,2);assert.equal(env.workspace.hasPending(),false);
});

test('a failed version migration keeps the browser draft; retry reuses its staged project',async t=>{
  const originalBlob=new Blob(['original']),versions=[{id:'edition',name:'自然版'}],photo={id:'photo',imageName:'test.png',originalBlob,versions};let created=0,saves=0;
  const env=fixture(t,{photo,getVersions:()=>versions,fetchImpl:async(url,options)=>{
    if(url==='/api/local-capabilities')return response({local:true,projects:true});
    if(url==='/api/projects/create'){created++;return response(data());}
    if(url.endsWith('/save')){saves++;assert.deepEqual(JSON.parse(options.body).versions,versions);return saves===1?new Response(JSON.stringify({error:{message:'save failed'}}),{status:400}):response({...data(2),versions});}
    if(url==='/api/projects')return response({projects:[]});throw Error(url);
  }});
  await env.workspace.capabilities();await env.node('project-create').listeners.click();
  assert.equal(photo.projectId,undefined);assert.equal(photo.originalBlob,originalBlob);assert.equal(photo.versions,versions);
  await env.node('project-create').listeners.click();assert.equal(created,1);assert.equal(saves,2);assert.equal(photo.projectId,'project');assert.equal(photo.pendingProject,undefined);
});

test('edits and named editions made during migration commit before reporting saved',async t=>{
  let finish,ready,serverPatch,serverVersions=[],saves=0;
  const waiting=new Promise(resolve=>{ready=resolve;}),versions=[];
  const env=fixture(t,{photo:{id:'photo',originalBlob:new Blob(['source'])},patch:{settings:{exposure:.2}},getVersions:()=>versions,fetchImpl:async(url,options)=>{
    if(url==='/api/local-capabilities')return response({local:true,projects:true});
    if(url==='/api/projects/create')return response(data());
    if(url.endsWith('/save')){const submitted=JSON.parse(options.body);saves++;serverPatch=submitted;serverVersions.push(...submitted.versions||[]);
      if(saves===1)return new Promise(resolve=>{finish=()=>resolve(response({...data(2),versions:serverVersions}));ready();});
      return response({...data(3),versions:serverVersions});
    }
    if(url==='/api/projects')return response({projects:[]});throw Error(url);
  }});
  await env.workspace.capabilities();const migration=env.node('project-create').listeners.click();await waiting;
  env.patch.settings.exposure=.5;versions.push({id:'late-edition',name:'等候期间保存的版本'});finish();await migration;
  assert.equal(serverPatch.settings.exposure,.5);assert.equal(saves,2);assert.equal(serverVersions[0].id,'late-edition');assert.equal(env.workspace.hasPending(),false);
});

test('a named file edition uses the clicked snapshot even if editing continues during flush',async t=>{
  let release,ready,captured;const waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{fetchImpl:async(url,options)=>{
    const value=JSON.parse(options.body);
    if(url.endsWith('/save')&&value.settings.exposure===.2)return new Promise(resolve=>{release=()=>resolve(response(data(2)));ready();});
    if(url.endsWith('/save'))return response(data(3));
    if(url.endsWith('/versions')){captured=value.patch;return response(data(4));}throw Error(url);
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.2;
  const save=env.workspace.saveEdition(env.photo,'自然版');await waiting;env.patch.settings.exposure=.5;release();await save;
  assert.equal(captured.settings.exposure,.2);assert.equal(env.patch.settings.exposure,.5);
});

test('editing during a version restore preserves the new edit as an explicit conflict',async t=>{
  let release,ready,updates=0;const waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{onUpdate:()=>{updates++;},fetchImpl:async url=>{
    if(url.endsWith('/restore'))return new Promise(resolve=>{release=()=>resolve(response(data(2)));ready();});throw Error(url);
  }});
  await env.workspace.attach(env.photo,data());const restore=env.workspace.restoreEdition(env.photo,'original');
  const rejected=assert.rejects(restore,/等待期间/);await waiting;env.patch.settings.exposure=.3;release();await rejected;
  assert.equal(env.patch.settings.exposure,.3);assert.equal(updates,0);assert.equal(env.workspace.hasPending(),true);assert.equal(env.photo.projectPending,true);
});

test('an old save response cannot change the identity or baseline of a newly attached project',async t=>{
  let release,ready;const waiting=new Promise(resolve=>{ready=resolve;});
  const env=fixture(t,{fetchImpl:async url=>{
    if(url==='/api/projects/project/save')return new Promise(resolve=>{release=()=>resolve(response(data(2)));ready();});throw Error('must not send a stale save to '+url);
  }});
  await env.workspace.attach(env.photo,data());env.patch.settings.exposure=.2;
  const save=env.workspace.flush();await waiting;
  const replacement={...data(),id:'new-project',currentId:'new-current'};await env.workspace.attach(env.photo,replacement);
  release();await save;
  assert.equal(env.photo.projectId,'new-project');assert.equal(env.photo.projectCurrentId,'new-current');assert.equal(env.photo.projectData.id,'new-project');
  assert.equal((await env.workspace.flush()).id,'new-project');assert.equal(env.workspace.hasPending(),false);
});

test('export dimensions are rendered as text even if a malformed response bypasses the server',async t=>{
  const payload='<img src=x onerror="window.bad=true">',project={...data(),exports:[{path:'test',width:payload,height:1}]};
  const env=fixture(t,{fetchImpl:async()=>response(project)});await env.workspace.load(project.id);
  assert.equal(env.node('project-details').innerHTML.includes(payload),false);assert.ok(env.node('project-details').innerHTML.includes('&lt;img'));
});
