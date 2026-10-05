import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../apps/studio/public/edit-stack/commands.js';
import {neutralSettings} from '../apps/studio/public/editor-engine.js';
import {documentHash,sha256} from '../apps/studio/public/edit-stack/identity.js';
import {validatePlannerAction,strictProviderSchema,documentActionSchema,legacyIntentProposal} from '../apps/studio/public/edit-stack/planner.js';
import {compileDocumentProposal} from '../apps/studio/public/edit-stack/proposals.js';
const base=()=>applyCommands(createDocument({documentId:'document',source:{assetId:'source',contentHash:sha256('source'),width:8,height:6},base:{settings:neutralSettings(),locals:[]}}),[{type:'AddStep',step:{id:'light',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.3}}}]).next;
test('language-directed updates target the existing ID and cannot escape explicit scope',()=>{
 const d=base(),action={kind:'document',proposal:{baseRevision:d.revision,baseHash:documentHash(d),items:[{id:'weaken',title:'弱一点',commands:[{type:'SetStepOpacity',stepId:'light',opacity:.7}]}]}};
 const valid=validatePlannerAction(d,action,{scopeStepId:'light'}),next=compileDocumentProposal(d,valid.proposal).document;assert.equal(next.steps.length,1);assert.equal(next.steps[0].id,'light');assert.equal(next.steps[0].opacity,.7);
 const bad=structuredClone(action);bad.proposal.items[0].commands=[{type:'AddStep',step:{id:'negative',title:'反向',tool:'exposure',toolVersion:2,parameters:{ev:-.1}}}];assert.throws(()=>validatePlannerAction(d,bad,{scopeStepId:'light'}),{code:'PROPOSAL_SCOPE'});
});
test('scope validation rejects indirect shared-mask and cascade changes to other steps',()=>{
 let d=applyCommands(base(),[{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'constant',value:.5},reference:{kind:'live-input'}}}]).next;
 d=applyCommands(d,[{type:'AddStep',step:{...structuredClone(d.steps[0]),id:'second',title:'后继',dependsOn:['light']}}]).next;
 const action=commands=>({kind:'document',proposal:{baseRevision:d.revision,baseHash:documentHash(d),items:[{id:'edit',title:'只修改第一步',commands}]}});
 for(const commands of [[{type:'ReplaceStepMask',stepId:'light',shared:true,mask:{expression:{kind:'constant',value:.2},reference:{kind:'live-input'}}}],[{type:'RemoveStep',stepId:'light',cascade:true}]])assert.throws(()=>validatePlannerAction(d,action(commands),{scopeStepId:'light'}),{code:'PROPOSAL_SCOPE'});
});
test('strict provider records declare every property, while nullable optional fields decode safely',()=>{
 function walk(schema){if(schema.type==='object'){assert.deepEqual(new Set(schema.required),new Set(Object.keys(schema.properties)));assert.equal(schema.additionalProperties,false);}for(const value of Object.values(schema))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(v=>v&&typeof v==='object'&&walk(v));else walk(value);}}walk(documentActionSchema);
 const schema=strictProviderSchema({type:'object',properties:{optional:{enum:['a']},required:{type:'number'}},required:['required']});assert.equal(schema.properties.optional.anyOf[1].type,'string');
 const d=base(),action={kind:'document',proposal:{baseRevision:d.revision,baseHash:documentHash(d),requestId:null,name:null,goal:null,tradeoff:null,items:[{id:'mask',title:'移除范围',dependsOn:null,commands:[{type:'ReplaceStepMask',stepId:'light',maskRef:null,shared:null}]}]}};assert.equal(validatePlannerAction(d,action).proposal.items[0].commands[0].maskRef,null);
});
test('legacy intent adapters generate declared independent nodes rather than changing final aggregate state',()=>{
 const d=base(),proposal=legacyIntentProposal(d,{kind:'adjustment',label:'稍亮稍暖',changes:[{key:'exposure',value:.1},{key:'warmth',value:3}]},{id:'new-intent'}),next=compileDocumentProposal(d,proposal).document;assert.equal(next.steps[0].id,'light');assert.equal(next.steps[0].parameters.ev,.3);assert.equal(next.steps.length,3);assert.equal(next.base.state.settings.exposure,0);
});
