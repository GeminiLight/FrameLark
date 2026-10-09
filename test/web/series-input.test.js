import test from 'node:test';
import assert from 'node:assert/strict';
import {seriesInputLimits,seriesImageBudget,seriesRequestBody} from '../../apps/studio/public/series-input.js';

test('series preview budget retains UTF-8 metadata and fits the exact serialized request',()=>{
  const request={intent:'保留十二张的光线和肤色🙂',photos:Array.from({length:12},(_,i)=>({id:'p'+i,name:'中文照片'+i,intent:'局部的记忆',image:'',notes:[{note:'阴影与现场暖光🙂',rect:{x:.1,y:.2,width:.3,height:.4}}]}))};
  const before=structuredClone(request),budget=seriesImageBudget(request);
  assert.ok(budget<seriesInputLimits.imageCharacters);assert.deepEqual(request,before);
  for(const photo of request.photos)photo.image='a'.repeat(budget);
  const body=seriesRequestBody(request);assert.ok(Buffer.byteLength(body)<=seriesInputLimits.requestBytes);
  const received=JSON.parse(body);assert.deepEqual(received.photos.map(({image,...photo})=>photo),before.photos.map(({image,...photo})=>photo));
  request.photos[0].image+='a'.repeat(request.photos.length);assert.throws(()=>seriesRequestBody(request),/过大/);
});
test('metadata alone cannot bypass the series HTTP limit or silently drop members',()=>{
  const request={intent:'🙂'.repeat(seriesInputLimits.requestBytes/4),photos:[{id:'p1',image:''},{id:'p2',image:''}]};
  assert.throws(()=>seriesImageBudget(request),/过大/);assert.equal(request.photos.length,2);
  assert.throws(()=>seriesImageBudget({...request,photos:[request.photos[0]]}),/2–12/);
  assert.equal(seriesImageBudget({intent:'安静日常',photos:[{id:'p1',image:''},{id:'p2',image:''}]}),seriesInputLimits.imageCharacters);
});
