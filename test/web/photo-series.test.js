import test from 'node:test';
import assert from 'node:assert/strict';
import {seriesBrief,seriesSchema,seriesCandidate,seriesSignature,restoreSeries,validateSeriesReview} from '../../apps/studio/public/photo-series.js';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';
import {snapshotSettings} from '../../apps/studio/public/batch-edits.js';
import {buildDraftWorkspace} from '../../apps/studio/public/draft-store.js';
import {createVisionService} from '../../apps/studio/server/ai/vision.mjs';
import {reviewPhotoSeries} from '../../apps/studio/server/ai/series.mjs';
const photo=id=>({id,imageName:id,creativeIntent:'保留安静',manual:neutralSettings(),active:new Set(),advisorLayers:[],analysis:{recommendations:[]},presetId:null,presetAmount:75,crop:null,annotations:[]});
const review=()=>({title:'安静的山间',summary:'从全景到细节。',preserve:'保留日出和阴影差异。',tradeoff:'共同定调会压低色彩。',order:['b','a'],sharedStyle:{presetId:'none',amount:0,reason:'保留现有光色。'},photos:['a','b'].map(id=>({id,role:id==='b'?'开场':'细节',reason:'看得见的光线层次。',preserve:'自然晨光。',tradeoff:'注意暗部。',cropNote:'保持原片，不切主体。',changes:[]}))});
test('a series can preserve every photo without adding adjustments',()=>{
 const original=photo('a'),candidate=seriesCandidate(original,validateSeriesReview(review(),['a','b']));
 assert.deepEqual(candidate.candidate,candidate.before);assert.deepEqual(original.active,new Set());
});
test('per-photo deltas preserve existing local, manual and crop work; a shared look is optional',()=>{
 const original=photo('a');original.manual.exposure=.25;original.crop={x:.1,y:0,width:.8,height:1};original.presetId='quiet-film';original.annotations=[{id:'person',note:'保留阴影',rect:{x:.2,y:.3,width:.1,height:.2},localSettings:{exposure:.1}}];
 const value=review();value.sharedStyle={presetId:'daily-soft',amount:35,reason:'淡彩'};value.photos[0].changes=[{key:'highlights',value:-8}];
 const accepted=seriesCandidate(original,value),noStyle=seriesCandidate(original,value,{useStyle:false});
 assert.equal(accepted.candidate.manual.exposure,.25);assert.deepEqual(accepted.candidate.crop,original.crop);assert.deepEqual(accepted.candidate.annotations,original.annotations);assert.equal(noStyle.candidate.presetId,'quiet-film');assert.equal(accepted.candidate.presetId,'daily-soft');assert.equal(snapshotSettings(noStyle.candidate).highlights,snapshotSettings(noStyle.before).highlights-8);assert.equal(original.advisorLayers.length,0);
});
test('review rejects omitted, repeated, unknown IDs and excessive or duplicated deltas',()=>{
 for(const change of [v=>v.order=['a','a'],v=>v.photos.pop(),v=>v.photos[0].id='unknown',v=>v.photos[0].changes=[{key:'exposure',value:.6}],v=>v.photos[0].changes=[{key:'shadows',value:5},{key:'shadows',value:4}]]){const value=review();change(value);assert.throws(()=>validateSeriesReview(value,['a','b']));}
});
test('stale detection follows edits, notes, membership and intent, while reordering remains safe',()=>{
 const a=photo('a'),b=photo('b'),brief=seriesBrief({intent:'保留真实光线'}),base=seriesSignature([a,b],brief);
 assert.equal(seriesSignature([b,a],brief),base);assert.notEqual(seriesSignature([a],brief),base);assert.notEqual(seriesSignature([a,b],{...brief,intent:'浓郁电影感'}),base);
 a.analysis.recommendations=[{id:'new',adjustments:{exposure:.2}}];assert.equal(seriesSignature([a,b],brief),base);a.active.add('new');assert.notEqual(seriesSignature([a,b],brief),base);a.active.clear();
 a.annotations=[{id:'one',note:'这里不动',rect:{x:0,y:0,width:.2,height:.2}}];assert.notEqual(seriesSignature([a,b],brief),base);
 a.annotations=[];a.manual.exposure=.2;assert.notEqual(seriesSignature([a,b],brief),base);
});
test('series brief and ordered members survive draft storage; removed photos are filtered',()=>{
 assert.deepEqual(restoreSeries(null),{intent:'',platform:'xiaohongshu',ratio:'original',purpose:'story',sequence:'visual',ids:[]});
 const a=photo('a'),b=photo('b');for(const p of [a,b])p.originalBlob=new Blob(['photo']);
 const series={ids:['b','a'],intent:'旅行随记',platform:'douyin',ratio:'3:4',purpose:'travel',sequence:'manual'},draft=buildDraftWorkspace('workspace',[a,b],'a',series);
 assert.deepEqual(restoreSeries(draft.series,['a','b']),series);assert.deepEqual(restoreSeries(draft.series,['a']).ids,['a']);assert.deepEqual(restoreSeries({...series,ids:['b','b','unknown']},['b']).ids,['b']);series.ids.reverse();assert.deepEqual(draft.series.ids,['b','a']);
});
test('real multimodal service contract sends each image and sanitized current context together',async()=>{
 let payload;
 const vision=await createVisionService({env:{VERCEL:'1',OPENAI_API_KEY:'test-key',OPENAI_API_URL:'https://example.test/v1/responses'},fetchImpl:async(url,init)=>{
  payload=JSON.parse(init.body);return new Response(JSON.stringify({model:'test-vision',output:[{content:[{type:'output_text',text:JSON.stringify(review())}]}]}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const body={intent:'保留真实光线',platform:'xiaohongshu',photos:['a','b'].map(id=>({id,image:'data:image/png;base64,aGVsbG8=',name:id,settings:{exposure:.2,malicious:'INJECT'},notes:[]}))};
 const result=await reviewPhotoSeries(vision,body);assert.equal(payload.input[0].content.filter(c=>c.type==='input_image').length,2);assert.equal(payload.text.format.name,'photo_series_review');assert.equal(payload.store,false);assert.doesNotMatch(JSON.stringify(payload.input),/INJECT/);assert.match(JSON.stringify(payload.input),/保留真实光线/);assert.equal(result.provenance.source,'vision');assert.equal(result.provenance.promptVersion,'photo-series-2026-10-03-v2');
 await assert.rejects(()=>reviewPhotoSeries(vision,{...body,photos:[body.photos[0]]}),/2–12/);await assert.rejects(()=>reviewPhotoSeries(vision,{...body,photos:[body.photos[0],body.photos[0]]}),/不完整/);await assert.rejects(()=>reviewPhotoSeries(vision,{...body,intent:''}),/一句话/);
 assert.ok(seriesSchema(['a','b']).properties.photos.minItems===2);
});
test('purpose and sequencing are persistent context, and manual order is enforced before applying AI output',async()=>{
 const a=photo('a'),b=photo('b'),base=seriesSignature([a,b],{intent:'展示真实颜色'});
 assert.notEqual(base,seriesSignature([a,b],{intent:'展示真实颜色',purpose:'catalog'}));
 assert.notEqual(base,seriesSignature([a,b],{intent:'展示真实颜色',sequence:'manual'}));
 assert.throws(()=>validateSeriesReview(review(),['a','b'],{sequence:'manual'}),/指定的顺序/);
 assert.equal(validateSeriesReview(review(),['b','a'],{sequence:'manual'}).order[0],'b');
 const value=review(),vision={request:async()=>({value,provenance:{source:'vision'}})},photos=['a','b'].map(id=>({id,image:'data:image/png;base64,aGVsbG8='}));
 await assert.rejects(reviewPhotoSeries(vision,{intent:'商品真实颜色',purpose:'catalog',sequence:'manual',photos}),{code:'INVALID_SERIES_REVIEW'});
});
