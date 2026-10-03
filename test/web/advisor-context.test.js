import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotAnnotations,annotationsChanged} from '../../public/advisor-context.js';
const notes=()=>[{id:'a',rect:{x:.1,y:.2,width:.2,height:.3},note:'这里太亮'},
  {id:'b',rect:{x:.5,y:.2,width:.1,height:.1},note:'保留这处的暖光',localSettings:{exposure:.1}}];
test('advisor sends every current note and resolves an explicit focus without retaining mutable references',()=>{
  const input=notes(),snapshot=snapshotAnnotations(input,'b');
  assert.equal(snapshot.focusNumber,2);assert.equal(snapshot.count,2);assert.equal(snapshot.notedCount,2);
  input[1].note='这里偏黄';input[1].rect.x=.8;input[1].localSettings.exposure=.2;
  assert.equal(snapshot.items[1].note,'保留这处的暖光');assert.equal(snapshot.items[1].rect.x,.5);assert.equal(snapshot.items[1].currentAdjustments.exposure,.1);
});
test('changed, removed, or reordered notes invalidate advice; merely changing chat focus does not',()=>{
  const input=notes(),message={baseAnnotations:snapshotAnnotations(input,'a').signature};
  assert.equal(annotationsChanged(message,input),false);
  assert.equal(snapshotAnnotations(input,'a').signature,snapshotAnnotations(input,'b').signature);
  assert.equal(annotationsChanged(message,input.toReversed()),true);
  assert.equal(annotationsChanged(message,input.slice(1)),true);
  input[0].note='保留这处';assert.equal(annotationsChanged(message,input),true);
  assert.equal(annotationsChanged({},input),false);
});
test('deleted focus returns whole-photo context and empty notes remain honest',()=>{
  const input=notes();input[0].note='';const snapshot=snapshotAnnotations(input,'deleted');
  assert.equal(snapshot.focusNumber,null);assert.equal(snapshot.notedCount,1);
});
