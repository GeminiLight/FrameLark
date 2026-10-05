import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {neutralSettings} from '../apps/studio/public/editor-engine.js';
import {createDocument,validateDocument,compileRenderPlan} from '../apps/studio/public/edit-stack/document.js';
import {applyCommands,restoreTransaction,duplicateCommands} from '../apps/studio/public/edit-stack/commands.js';
import {sha256,documentHash,renderHash} from '../apps/studio/public/edit-stack/identity.js';
const source={assetId:'source',contentHash:sha256('source'),width:8,height:6};
const document=()=>createDocument({documentId:'photo',source,base:{settings:neutralSettings(),locals:[]}});
const step=(id='light',tool='exposure',parameters={ev:.5})=>({id,tool,toolVersion:2,title:id,parameters});
const add=(d,id='light')=>applyCommands(d,[{type:'AddStep',step:step(id)}]).next;
test('portable SHA identities agree with Node on text, binary and block boundaries',()=>{
 for(const input of ['', 'abc','照片', 'x'.repeat(55),'x'.repeat(64),'x'.repeat(1000),Uint8Array.from({length:256},(_,i)=>i)])assert.equal(sha256(input),createHash('sha256').update(input).digest('hex'));
});
test('an accepted node can be updated under the same ID while preserving independent successors',()=>{
 let d=add(add(document(),'first'),'second');d=applyCommands(d,[{type:'UpdateStepParameters',stepId:'first',parameters:{ev:.2}}]).next;
 assert.deepEqual(d.steps.map(s=>[s.id,s.parameters.ev]),[['first',.2],['second',.5]]);
 d=applyCommands(d,[{type:'RemoveStep',stepId:'first'}]).next;assert.deepEqual(d.steps.map(s=>s.id),['second']);
});
test('all commands are validated atomically and list order is never silently sorted',()=>{
 const d=add(document());assert.throws(()=>applyCommands(d,[{type:'RenameStep',stepId:'light',title:'new'},{type:'SetStepOpacity',stepId:'light',opacity:2}]),{code:'INVALID_DOCUMENT'});assert.equal(d.steps[0].title,'light');
 const linked=applyCommands(d,[{type:'AddStep',step:{...step('child'),dependsOn:['light']}}]).next;
 assert.throws(()=>applyCommands(linked,[{type:'MoveStep',stepId:'child',index:0}]),{code:'INVALID_ORDER'});assert.deepEqual(linked.steps.map(s=>s.id),['light','child']);
 assert.throws(()=>applyCommands(linked,[{type:'SetStepEnabled',stepId:'light',enabled:false}]),{code:'DEPENDENCY_REQUIRED'});
 assert.throws(()=>applyCommands(linked,[{type:'RemoveStep',stepId:'light'}]),{code:'DEPENDENCY_REQUIRED'});
 assert.equal(applyCommands(linked,[{type:'RemoveStep',stepId:'light',cascade:true}]).next.steps.length,0);
});
test('shared mask editing creates immutable versions and defaults to only the selected node',()=>{
 let d=add(add(document(),'a'),'b');const mask={expression:{kind:'luminance',mode:'exclude-highlights',start:.55,end:.8},reference:{kind:'live-input'}};
 d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'a',mask}]).next;
 d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'b',maskRef:d.steps[0].maskRef}]).next;
 const old=structuredClone(d.masks[0]);d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'a',mask:{...mask,expression:{...mask.expression,start:.4}}}]).next;
 assert.equal(d.steps[0].maskRef.version,2);assert.equal(d.steps[1].maskRef.version,1);assert.deepEqual(d.masks[0],old);
 d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'a',maskRef:d.steps[1].maskRef}]).next;
 d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'a',mask,shared:true}]).next;assert.deepEqual(d.steps[0].maskRef,d.steps[1].maskRef);
});
test('undo and redo restore complete nodes and resources with monotonically increasing revisions',()=>{
 const initial=add(document()),removed=applyCommands(initial,[{type:'RemoveStep',stepId:'light'}]);
 const restored=restoreTransaction(removed.next,removed.transaction,'undo');assert.equal(restored.steps[0].id,'light');assert.equal(documentHash(restored),documentHash(initial));assert.ok(restored.revision>removed.next.revision);
 const redone=restoreTransaction(restored,removed.transaction,'redo');assert.equal(redone.steps.length,0);assert.ok(redone.revision>restored.revision);
 assert.throws(()=>restoreTransaction(add(restored,'another'),removed.transaction,'redo'),{code:'STALE_REVISION'});
});
test('idempotent command retry never adds another node and conflicts are explicit',()=>{
 const command={type:'AddStep',step:step()},d=document(),first=applyCommands(d,[command],{requestId:'request'});
 const retry=applyCommands(first.next,[command],{requestId:'request',expectedRevision:0});assert.equal(retry.reused,true);assert.equal(retry.next.steps.length,1);
 assert.throws(()=>applyCommands(first.next,[{type:'RemoveStep',stepId:'light'}],{requestId:'request'}),{code:'REQUEST_CONFLICT'});
 assert.throws(()=>applyCommands(first.next,[{type:'RemoveStep',stepId:'light'}],{expectedRevision:0}),{code:'STALE_REVISION'});
});
test('titles, groups and view-independent revisions do not invalidate pixel identities',()=>{
 const d=add(document()),changed=applyCommands(d,[{type:'RenameStep',stepId:'light',title:'前景稍亮'}]);
 assert.notEqual(documentHash(changed.next),documentHash(d));assert.equal(renderHash(changed.next),renderHash(d));assert.equal(changed.invalidation,null);
 const frame={width:8,height:6};assert.equal(compileRenderPlan(d,frame).prefixes[0].prefixHash,compileRenderPlan(changed.next,frame).prefixes[0].prefixHash);
});
test('unknown versions, executable fields, cyclic masks and incorrect source references fail closed',()=>{
 assert.throws(()=>applyCommands(document(),[{type:'AddStep',step:{...step(),toolVersion:99}}]),{code:'TOOL_VERSION_UNSUPPORTED'});
 assert.throws(()=>applyCommands(document(),[{type:'AddStep',step:{...step(),command:'anything'}}]),{code:'INVALID_DOCUMENT'});
 const d=add(document());assert.throws(()=>applyCommands(d,[{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'constant',value:1},reference:{kind:'frozen-source',sourceHash:sha256('different')}}}]),{code:'SOURCE_CHANGED'});
 const bad=structuredClone(d);bad.masks=[{id:'mask',version:1,reference:{kind:'live-input'},expression:{kind:'reference',id:'mask',version:1}}];assert.throws(()=>validateDocument(bad),{code:'DEPENDENCY_CYCLE'});
 let expression={kind:'constant',value:1};for(let i=0;i<8;i++)expression={kind:'invert',input:expression};assert.throws(()=>applyCommands(d,[{type:'ReplaceStepMask',stepId:'light',mask:{expression,reference:{kind:'live-input'}}}]),{code:'MASK_DEPTH_EXCEEDED'});
});
test('duplicate nodes share immutable ranges until explicitly modified and have distinct IDs',()=>{
 const d=add(document()),next=applyCommands(d,duplicateCommands(d,'light','light-copy')).next;
 assert.deepEqual(next.steps.map(s=>s.id),['light','light-copy']);assert.equal(next.steps[1].parameters.ev,.5);
});
