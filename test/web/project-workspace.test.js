import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectWorkspace} from '../../public/project-workspace.js';

function fixture(t,{photo={id:'photo'},patch={settings:{exposure:0}},fetchImpl,onLoad=()=>photo,onUpdate=()=>{},getVersions=()=>[]}={}){
  const previous={document:globalThis.document,location:globalThis.location,history:globalThis.history,EventSource:globalThis.EventSource,fetch:globalThis.fetch};
  const nodes=new Map(),events=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},insertAdjacentHTML(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  globalThis.document={querySelector:node,getElementById:node,body:node('body')};globalThis.location={href:'http://localhost:3177/'};globalThis.history={replaceState(){}};
  globalThis.EventSource=class{constructor(){events.push(this);}close(){this.closed=true;}};globalThis.fetch=fetchImpl;
  const workspace=createProjectWorkspace({getPhoto:()=>photo,getPhotos:()=>[photo],getPatch:()=>patch,getVersions,onLoad,onUpdate,notify(){}});
  t.after(()=>{workspace.close();Object.assign(globalThis,previous);});return {workspace,photo,patch,events,node};
}
const data=(revision=1)=>({id:'project',path:'/tmp/owned-project',name:'test',revision,currentId:'current',supported:true,current:{},candidates:[],versions:[],exports:[]});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

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
  const env=fixture(t,{fetchImpl:()=>new Promise(resolve=>{finish=()=>resolve(response(data(2)));}),onUpdate:()=>{throw Error('must not overwrite local edits');}});
  await env.workspace.attach(env.photo,data());const read=env.events[0].onmessage({data:JSON.stringify({revision:2})});
  await Promise.resolve();env.patch.settings.exposure=.3;finish();await read;
  assert.equal(env.photo.projectRevision,1);assert.equal(env.patch.settings.exposure,.3);assert.equal(env.workspace.hasPending(),true);
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
