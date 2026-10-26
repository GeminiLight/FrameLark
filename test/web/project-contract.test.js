import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProjectWorkspace} from '../../apps/studio/public/project-workspace.js';

test('the shared collection opens a project by ID through the same workspace boundary',async t=>{
  const old=Object.fromEntries(['document','location','history','EventSource','fetch'].map(k=>[k,globalThis[k]]));
  const nodes=new Map(),requests=[],photo={id:'photo'};let opened=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){},insertAdjacentHTML(){}});return nodes.get(id);};
  Object.assign(globalThis,{document:{querySelector:node,getElementById:node,body:node('body')},location:{href:'http://localhost/'},history:{replaceState(){}},EventSource:class{close(){}}});
  const value={id:'project',path:'/owned/project',name:'photo',revision:1,currentId:'v1',current:{},supported:true,candidates:[],versions:[],exports:[]};
  globalThis.fetch=async url=>{requests.push(String(url));return new Response(JSON.stringify(value));};
  const workspace=createProjectWorkspace({getPhoto:()=>null,getPhotos:()=>[photo],getPatch:()=>({}),onLoad:()=>{opened++;return photo;},onUpdate(){},notify(){}});
  t.after(()=>{workspace.close();Object.assign(globalThis,old);});
  const source=await readFile(new URL('../../apps/studio/public/app.js',import.meta.url),'utf8'),marker='createCollectionWorkspace({notify:showToast,onEdit:',start=source.indexOf(marker)+marker.length,end=source.indexOf('\n}});',start);
  assert.ok(start>=marker.length&&end>start);
  const callback=Function('currentPhoto','projectWorkspace','fetch','return ('+source.slice(start,end)+'\n});')(()=>null,workspace,globalThis.fetch);
  await callback('project');assert.deepEqual(requests,['/api/projects/project']);assert.equal(opened,1);
  const open=workspace.openProject||workspace.load;
  await assert.rejects(async()=>open(value),{code:'PROJECT_ID_INVALID'});assert.equal(requests.length,1);
});
