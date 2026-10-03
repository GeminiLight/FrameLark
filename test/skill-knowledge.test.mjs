import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runKnowledge} from '../skills/guangjian-retouch/scripts/knowledge.mjs';

test('Chinese artist requests retrieve style and subject constraints together',async()=>{
 const result=await runKnowledge('search',{query:'滨田英明 柔光人像，保留肤色'});
 assert.equal(result.results[0].presetId,'daily-soft');
 assert.ok(result.results.some(r=>r.id==='portrait'));
 assert.ok(result.results.every(r=>r.path.startsWith(new URL('../skills/guangjian-retouch/references/',import.meta.url).pathname)));
});
test('English artist and technical aliases route without substring false positives',async()=>{
 const artist=await runKnowledge('search',{query:'Saul Leiter'});assert.equal(artist.results[0].presetId,'quiet-film');
 const color=await runKnowledge('search',{query:'orangeLuminance'});assert.equal(color.results[0].id,'color-relations');
 const irrelevant=await runKnowledge('search',{query:'unrelated unicorn'});assert.deepEqual(irrelevant.results,[]);
});
test('unmatched topics have no fabricated recommendation and section reads are bounded',async()=>{
 const unmatched=await runKnowledge('search',{query:'量子纠缠'});assert.deepEqual(unmatched.results,[]);assert.ok(unmatched.next);
 const section=await runKnowledge('read',{id:'local-masks'});assert.equal(section.text.split('\n').filter(l=>l.startsWith('## ')).length,1);
 await assert.rejects(()=>runKnowledge('read',{id:'../../.env.local'}),{code:'UNKNOWN_TOPIC'});
});
test('video requests retrieve color and temporal checks rather than treating stills as full clips',async()=>{
 const result=await runKnowledge('search',{query:'视频 Log HDR 镜头匹配和剪辑',limit:8});
 for(const id of ['video-color','video-match','video-edit','video-capabilities'])assert.ok(result.results.some(r=>r.id===id),id);
});
test('knowledge stays synchronized with real engine and rejects invalid search sizes',async()=>{
 const result=await runKnowledge('check');assert.ok(result.sections>0);assert.ok(result.files>0);
 await assert.rejects(()=>runKnowledge('search',{query:'人像',limit:0}),{code:'LIMIT'});
 await assert.rejects(()=>runKnowledge('search',{query:'人像',limit:9}),{code:'LIMIT'});
 await assert.rejects(()=>runKnowledge('search',{query:''}),{code:'QUERY'});
});
test('multi-photo requests discover curation, narrative and purpose knowledge with executable tool references',async()=>{
 const cull=await runKnowledge('search',{query:'一堆图 选片 连拍 联系表',limit:8});assert.ok(cull.results.some(r=>r.id==='collection-cull'));
 const sequence=await runKnowledge('search',{query:'组图 叙事 排序',limit:8});assert.ok(sequence.results.some(r=>r.id==='collection-sequence'));
 const catalog=await runKnowledge('search',{query:'catalog'});assert.equal(catalog.results[0].id,'collection-purpose');
 const tools=await runKnowledge('search',{query:'collection-export'});assert.equal(tools.results[0].id,'collection-plan-tools');
});
test('a rejected or indistinguishable look retrieves actual audition and acceptance guidance',async()=>{
 const taste=await runKnowledge('search',{query:'不好看 风格平庸'});assert.ok(taste.results.some(r=>r.id==='look-direction'));
 const tools=await runKnowledge('search',{query:'look-sheet'});assert.equal(tools.results[0].id,'look-compare');
 const evidence=await runKnowledge('search',{query:'preferenceChoices'});assert.equal(evidence.results[0].id,'look-acceptance');
 const section=await runKnowledge('read',{id:tools.results[0].id});assert.ok(section.text.length>100);
});
