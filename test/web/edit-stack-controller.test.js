import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditStackController} from '../../apps/studio/public/edit-stack-controller.js';
import {createDocument} from '../../apps/studio/public/edit-stack/document.js';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';
const recipe=id=>createDocument({documentId:id,source:{assetId:id,contentHash:'a'.repeat(64),width:8,height:8},base:{settings:neutralSettings(),locals:[]}});
const add=id=>[{type:'AddStep',step:{id,title:id,tool:'exposure',toolVersion:2,parameters:{ev:.3}}}];
function harness(persist){
  const a={id:'a',editDocument:recipe('a')},b={id:'b',editDocument:recipe('b')},history=[],views=[];let selected=a;
  const controller=createEditStackController({root:{},getPhoto:()=>selected,prepareDocument:async photo=>photo.editDocument,getSnapshot:photo=>structuredClone(photo),setSnapshot:(photo,snapshot)=>Object.assign(photo,snapshot),persist,onHistory:(photo,before)=>history.push({photo:photo.id,before}),createView:()=>({render(_document,options){views.push(options);},setMessage(){}})});
  return {a,b,history,views,controller,select:photo=>selected=photo};
}
test('switching photos during a file save keeps each recipe and history on its owner',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),h=harness(async(_photo,{document})=>{await gate;return document;});
  const saving=h.controller.command(add('light'));await new Promise(resolve=>setImmediate(resolve));h.select(h.b);release();await saving;
  assert.equal(h.a.editDocument.steps[0].id,'light');assert.equal(h.b.editDocument.steps.length,0);assert.deepEqual(h.history.map(item=>item.photo),['a']);
});
test('removing a photo aborts its persistence and ignores a late result',async()=>{
  let release,signal;const gate=new Promise(resolve=>release=resolve),h=harness(async(_photo,options)=>{signal=options.signal;await gate;return {...options.document,documentId:'late'};});
  const saving=h.controller.command(add('light'));await new Promise(resolve=>setImmediate(resolve));h.controller.release(h.a);h.select(h.b);release();await saving;
  assert.equal(signal.aborted,true);assert.equal(h.a.editDocument.documentId,'a');assert.equal(h.b.editDocument.steps.length,0);assert.equal(h.history.length,0);
});
test('a drag previews from its original recipe and commits one undo entry',async()=>{
  const h=harness();await h.controller.command(add('light'));h.history.length=0;
  h.controller.preview([{type:'SetStepOpacity',stepId:'light',opacity:.8}]);h.controller.preview([{type:'SetStepOpacity',stepId:'light',opacity:.4}]);await h.controller.commit([]);
  assert.equal(h.a.editDocument.revision,2);assert.equal(h.a.editDocument.steps[0].opacity,.4);assert.equal(h.history.length,1);assert.equal(h.history[0].before.editDocument.steps[0].opacity,1);
});
test('a failed save retains the recipe and retries the same request without adding a second undo entry',async()=>{
  const requests=[];let attempts=0;const h=harness(async(_photo,{proposal,document})=>{requests.push(proposal.requestId);if(!attempts++)throw Error('lost response');return document;});
  assert.equal(await h.controller.command(add('light')),false);assert.equal(h.a.editDocument.steps[0].id,'light');assert.equal(h.history.length,0);
  await h.controller.retry();assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal(h.history.length,1);assert.equal(h.a.editRetry,undefined);
});
test('failed persistence blocks further drag edits while keeping retry available',async()=>{
 let attempts=0;const h=harness(async(_photo,{document})=>{if(!attempts++)throw Error('lost response');return document;});
 await h.controller.command(add('light'));const failed=structuredClone(h.a.editDocument);
 assert.equal(h.views.at(-1).busy,true);assert.equal(h.views.at(-1).retryBusy,false);assert.equal(h.views.at(-1).canRetry,true);
 h.controller.preview([{type:'SetStepOpacity',stepId:'light',opacity:.4}]);await h.controller.commit([]);
 assert.deepEqual(h.a.editDocument,failed);assert.equal(h.a.editGestureBefore,undefined);assert.equal(h.history.length,0);
 await h.controller.retry();assert.deepEqual(h.a.editDocument,failed);assert.equal(h.views.at(-1).busy,false);assert.equal(h.history.length,1);
});
