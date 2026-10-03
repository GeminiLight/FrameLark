import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {qualityFixture,qualityRecipes,reviewIssues} from '../../scripts/photo-quality.mjs';import {renderPixels} from '../../public/editor-engine.js';
const folder=new URL('./fixtures/quality/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',folder))),baseline=JSON.parse(await readFile(new URL('baseline.json',folder)));
test('licensed real-photo set has intact source checksums and explicitly labels derived exposure/noise/frames',async()=>{
 assert.equal(manifest.independentPhotos,6);assert.equal(manifest.cases.length,11);assert.ok(manifest.cases.some(item=>item.height>item.width));assert.ok(manifest.cases.some(item=>item.variant.includes('noise')));
 for(const item of manifest.cases){assert.equal(createHash('sha256').update(await readFile(new URL(item.file,folder))).digest('hex'),item.sha256);const photo=await qualityFixture(item);assert.equal(photo.width,item.width);assert.equal(photo.height,item.height);if(item.parent)assert.notEqual(item.variant,'original');}
});
test('33 real-photo processing results match reviewed regression pixels without replacing the prior tests',async()=>{
 for(const item of manifest.cases){const {pixels,width,height}=await qualityFixture(item);for(const [name,settings] of Object.entries(qualityRecipes)){const out=renderPixels(pixels,width,height,settings),hash=createHash('sha256').update(out).digest('hex');assert.equal(hash,baseline[item.id+'/'+name],item.id+'/'+name+' changed; inspect photo before accepting a new baseline');}}
});
test('quality log identifies contradictory advice, strong edits needing review, and cuts through protected content',async()=>{
 const review=JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url)));review.recommendations[0].adjustments.exposure=.9;
 const issues=reviewIssues(review,[{x:0,y:0,width:.4,height:.6}]);assert.ok(issues.some(item=>item.type==='over-adjustment'));assert.ok(issues.some(item=>item.type==='unsafe-crop'));
 review.conclusion.kind='keep';assert.ok(reviewIssues(review).some(item=>item.type==='wrong-advice'));
});
