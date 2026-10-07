import test from 'node:test';
import assert from 'node:assert/strict';

const sample=()=>({id:'set',revision:1,snapshotHash:'pixels-1',brief:{theme:'安静',purpose:'travel',sequence:'visual',targetCount:2,mustKeep:['P0001'],constraints:[]},photos:[{id:'P0001'},{id:'P0002'}],plan:null});
async function model(){
  const value=await import('../../apps/studio/public/collection-model.js').catch(error=>{
    if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('collection-model.js'))return {};throw error;
  });
  assert.equal(typeof value.collectionDraft,'function','Shared selection needs a stable draft model');return value;
}
test('a user plan preserves previous Agent observations while changing order',async()=>{
  const m=await model(),c=sample();c.plan={id:'plan',title:'安静的旅行',rationale:'从环境到细节',order:['P0001','P0002'],decisions:[{id:'P0001',decision:'select',observations:'人物与窗框留有间隔',reason:'保留互动',preserve:'原有侧光',role:'开场'},{id:'P0002',decision:'select',observations:'树影形成背景',reason:'环境变化',preserve:'阴影',role:'停顿'}]};
  c.plan.anchorId='P0002';
  const draft=m.collectionDraft(c);m.moveCollectionPhoto(draft,'P0002',-1);
  const plan=m.collectionPlan(draft,c);assert.deepEqual(plan.order,['P0002','P0001']);assert.equal(plan.decisions[0].observations,'人物与窗框留有间隔');
  assert.equal(plan.anchorId,'P0002','Reordering keeps the Agent-selected tonal reference');
});
test('must-keep decisions and stale context cannot be silently overwritten',async()=>{
  const m=await model(),c=sample(),draft=m.collectionDraft(c);
  assert.throws(()=>m.setCollectionDecision(draft,'P0001','exclude'),/必留/);
  assert.throws(()=>m.collectionPlan(draft,{...c,snapshotHash:'changed'}),/更新/);
});
test('export progress alone can advance the draft revision without changing its selection',async()=>{
  const m=await model(),c=sample(),draft=m.collectionDraft(c),next={...c,revision:3,jobs:[{status:'done'}]};
  assert.equal(m.sameCollectionContext(c,next),true);draft.revision=next.revision;
  assert.equal(m.collectionPlan(draft,next).revision,3);
  assert.equal(m.sameCollectionContext(c,{...next,plan:{id:'another-plan'}}),false);
});
test('downloads of a saved old snapshot cannot be labelled as current finished images',async()=>{
  const m=await model(),c=sample();c.plan={id:'plan'};
  const job={status:'done',snapshotHash:c.snapshotHash,planId:'plan',stale:false};
  assert.equal(typeof m.collectionExportStatus,'function');
  assert.equal(m.collectionExportStatus(c,job).current,true);
  assert.equal(m.collectionExportStatus({...c,snapshotHash:'new-pixels'},job).current,false);
  assert.equal(m.collectionExportStatus(c,{...job,stale:true}).current,false);
});
