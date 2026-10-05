import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentContext,annotationPreviewFrame,validAttachmentRect} from '../../apps/studio/public/annotation-attachments.js';

const rect={x:.62,y:.08,width:.21,height:.18};
test('sent attachment geometry and comments stay independent of later edits',()=>{
  const message={context:{annotations:[{id:'a',number:1,note:'这里太亮',rect:{...rect}}]}};
  const captured=attachmentContext(message);
  message.context.annotations[0].rect.x=.1;message.context.annotations[0].note='保留亮度';
  assert.deepEqual(captured[0],{id:'a',number:1,note:'这里太亮',rect});
});
test('legacy attachment geometry can be recovered only from its matching reply snapshot',()=>{
  const item={id:'a',number:1,note:'这里太亮'},message={text:'看这处',context:{annotations:[item]}};
  const reply={role:'assistant',requestQuestion:'看这处',baseAnnotations:JSON.stringify([{...item,rect}])};
  assert.deepEqual(attachmentContext(message,reply)[0].rect,rect);
  assert.equal(attachmentContext(message,{...reply,requestQuestion:'别的问题'})[0].rect,null);
  assert.equal(attachmentContext(message,{...reply,baseAnnotations:JSON.stringify([{...item,note:'新批注',rect}])})[0].rect,null);
  assert.equal(attachmentContext(message,{...reply,baseAnnotations:'not json'})[0].rect,null);
});
test('preview framing keeps the entire attachment with context and remains within source edges',()=>{
  for(const source of [{x:0,y:0,width:.03,height:.02},{x:.91,y:.88,width:.09,height:.12},{x:.1,y:.1,width:.8,height:.7},rect]) {
    for(const [width,height] of [[4000,3000],[3000,4000]]) {
      const frame=annotationPreviewFrame(source,width,height);
      assert.ok(frame.x>=0 && frame.y>=0 && frame.x+frame.width<=1.00001 && frame.y+frame.height<=1.00001);
      assert.ok(frame.x<=source.x && frame.y<=source.y);
      assert.ok(frame.x+frame.width>=source.x+source.width-.00001 && frame.y+frame.height>=source.y+source.height-.00001);
    }
  }
});
test('missing or corrupt historical ranges cannot draw a misleading preview',()=>{
  for(const invalid of [undefined,{x:NaN,y:0,width:.2,height:.2},{x:0,y:0,width:0,height:.2},{x:.9,y:0,width:.2,height:.2}]) {
    assert.equal(validAttachmentRect(invalid),null);
    assert.equal(annotationPreviewFrame(invalid,4000,3000),null);
  }
  const message={context:{annotations:[{id:'a',number:1,note:'旧评论'}]}};
  assert.equal(attachmentContext(message)[0].note,'旧评论');assert.equal(attachmentContext(message)[0].rect,null);
});
