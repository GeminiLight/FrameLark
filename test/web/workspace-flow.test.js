import test from 'node:test';
import assert from 'node:assert/strict';
import {photoPhase,editorTab,inspectionVisibility,panelGuidance} from '../../apps/studio/public/workspace-flow.js';

test('completion belongs only to the exact accepted or exported effect',()=>{
  const accepted={edited:true,signature:'a',acceptedSignature:'a',hasAcceptedRecord:true,exported:true};
  assert.equal(photoPhase(accepted).key,'finalized');
  assert.equal(photoPhase({...accepted,signature:'b',exported:false}).key,'editing');
  assert.equal(photoPhase({...accepted,hasAcceptedRecord:false}).key,'exported');
  assert.equal(photoPhase({acceptedSignature:'',signature:'',hasAcceptedRecord:true}).key,'original');
});
test('pending work is shown before a previous finalized status without losing it',()=>{
  const accepted={signature:'a',acceptedSignature:'a',hasAcceptedRecord:true};
  assert.equal(photoPhase({...accepted,loading:true}).key,'loading');
  assert.equal(photoPhase({...accepted,analyzing:true,analysisStatus:'queued'}).key,'queued');
  assert.equal(photoPhase({...accepted,analyzing:true}).key,'analyzing');
  assert.equal(photoPhase({...accepted,assessmentBusy:true}).key,'assessing');
  assert.equal(photoPhase(accepted).key,'finalized');
  assert.equal(photoPhase({...accepted,hasPhoto:false}).key,'empty');
});
test('returning to original hides effect tools while keeping the redo path',()=>{
  assert.deepEqual(inspectionVisibility({edited:true,past:1,sources:2,versions:2}),{comparison:true,history:true,sources:true,versionComparison:true});
  assert.deepEqual(inspectionVisibility({edited:false,past:0,future:1,sources:0,versions:1}),{comparison:false,history:true,sources:false,versionComparison:false});
  const empty=inspectionVisibility({hasPhoto:false,edited:true,past:1,sources:1});
  assert.equal(empty.comparison,false);assert.equal(empty.history,false);assert.equal(empty.sources,false);
});
test('zero reliable suggestions never direct the user to automatic optimization',()=>{
  assert.equal(panelGuidance({kind:'keep'}).action,'export');
  const uncertain=panelGuidance({kind:'uncertain',visual:false});
  assert.equal(uncertain.action,'adjust');assert.match(uncertain.description,/尚未识别/);
  assert.equal(panelGuidance({tab:'suggestions',pending:0}).action,'adjust');
  assert.equal(panelGuidance({pending:1}).action,'first-suggestion');
});
test('edited diagnosis prioritizes reassessment and exposes the exact completed version',()=>{
  assert.equal(panelGuidance({edited:true,assessed:false,pending:2}).action,'reassess');
  assert.equal(panelGuidance({edited:true,assessed:true}).action,'export');
  assert.equal(panelGuidance({edited:true,assessed:true,phase:'exported'}).action,'versions');
  assert.equal(panelGuidance({edited:true,assessed:true,phase:'finalized'}).action,'versions');
  assert.equal(panelGuidance({edited:true,assessed:false,phase:'finalized'}).action,'versions');
});
test('each editor mode has one concrete first action and pending work has a queue action',()=>{
  assert.equal(panelGuidance({tab:'adjust'}).action,'light');
  assert.equal(panelGuidance({tab:'presets',intent:'保留清晨的安静'}).action,'style');
  assert.match(panelGuidance({tab:'presets',intent:'保留清晨的安静'}).description,/清晨的安静/);
  assert.equal(panelGuidance({tab:'agent',hasConversation:false}).action,'compose');
  assert.match(panelGuidance({tab:'agent',visual:false}).description,/不识别/);
  assert.equal(panelGuidance({tab:'adjust',phase:'queued'}).action,'light');
  assert.equal(panelGuidance({phase:'loading'}).action,null);
});
test('professional mode stays in the editor while learning cannot become a repair tab',()=>{
  assert.equal(editorTab('adjust'),'adjust');assert.equal(editorTab('suggestions'),'diagnosis');assert.equal(editorTab('presets'),'presets');assert.equal(editorTab('learn'),'diagnosis');
  assert.equal(editorTab('unknown'),'diagnosis');
});
