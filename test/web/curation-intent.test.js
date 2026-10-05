import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanIntent,describeIntent,styleSelections} from '../../apps/studio/public/creative-intent.js';
import {rankStyles} from '../../apps/studio/public/style-matcher.js';
import {localDesignReply,normalizeDesignReply} from '../../apps/studio/public/design-agent.js';
import {advisorCandidate,previewStillValid,actionExplanation} from '../../apps/studio/public/advisor-candidate.js';
import {buildDraftWorkspace,restoreDraftPhoto} from '../../apps/studio/public/draft-store.js';
import {snapshotSettings} from '../../apps/studio/public/batch-edits.js';
const base=()=>({manual:{exposure:.12,saturation:5},active:['light'],recommendations:[{id:'light',adjustments:{highlights:-8}}],advisorLayers:[{id:'old',settings:{shadows:6}}],crop:{x:.05,y:.05,width:.9,height:.9,angle:3},presetId:'daily-soft',presetAmount:48,annotations:[{id:'face',rect:{x:.2,y:.2,width:.2,height:.2},note:'太暗',feather:.8,localSettings:{exposure:.1}}],agentApplied:[]});
const message=action=>({id:'new',action,actionFingerprint:'new action'});
test('explicit intent outranks conflicting profile, favorites and previous visual style picks',()=>{
  const ranking=rankStyles({preference:'mono',favorites:['street-grain'],aiMatches:[{id:'street-grain',reason:'旧意图的推荐'}],creativeIntent:'肤色真实'});
  assert.equal(ranking[0].intentPriority,2);assert.equal(Boolean(ranking[0].preset.adjustments.monochrome),false);
  const mono=rankStyles({preference:'airy',creativeIntent:'黑白叙事'});assert.ok(mono[0].preset.adjustments.monochrome);
  const night=rankStyles({subject:'night',creativeIntent:'更有电影感',inspection:{stats:{mean:.4,deviation:.22,saturation:.25}}});assert.ok(night[0].preset.groups.includes('night'));
  assert.match(ranking[0].reason,/肤色真实/);assert.equal(ranking[0].source,'intent');
});
test('the same photo gets different local directions, with a candid skin preservation limit',()=>{
  const context={analysis:{summary:'本地光色统计',recommendations:[]},subject:'landscape',source:'local'};
  assert.equal(localDesignReply('先调整哪里',{...context,creativeIntent:'保留清晨的安静'}).action.presetId,'misty-air');
  assert.equal(localDesignReply('先调整哪里',{...context,creativeIntent:'更有电影感'}).action.presetId,'quiet-film');
  const natural=localDesignReply('先调整哪里',{...context,creativeIntent:'保留自然光色'});assert.equal(natural.action.kind,'none');assert.equal(natural.clarification,null);assert.match(natural.reply,/保留现有效果/);
  const skin=localDesignReply('先调整哪里',{...context,creativeIntent:'肤色真实'});assert.equal(skin.action.kind,'none');assert.match(skin.reply,/不能识别脸部/);
});
test('vague intent asks one concrete question with two directions and no edit',()=>{
  assert.equal(describeIntent('高级一点').vague,true);assert.equal(describeIntent('窗边逆光，保留轮廓').vague,false);
  const reply=localDesignReply('先调整哪里',{creativeIntent:'高级一点'});assert.equal(reply.action.kind,'none');assert.equal(reply.clarification.choices.length,2);assert.match(reply.clarification.question,/自然光色/);
  const conflict=localDesignReply('我想试试黑白',{creativeIntent:'肤色真实'});assert.equal(conflict.action.kind,'none');assert.deepEqual(conflict.clarification.choices,['肤色真实','我想试试黑白']);
});
test('clarification responses cannot carry a silently applied action',()=>{
  const result=normalizeDesignReply({clarification:{question:'哪个方向？',choices:['自然','电影']},action:{kind:'style',presetId:'daily-soft'}});
  assert.equal(result.action.kind,'none');assert.equal(result.clarification.choices.length,2);
  assert.equal(cleanIntent({text:'invalid'}),'');assert.equal(cleanIntent(' a\n b '),'a b');assert.equal(cleanIntent('x'.repeat(200)).length,180);
});
test('sidebar curation has no duplicate between recommendations and favorite picks',()=>{
  const ranked=rankStyles(),favorites=ranked.slice(0,5).map(item=>item.preset.id),picks=styleSelections(ranked,favorites);
  assert.equal(picks.recommended.length,2);assert.equal(picks.favorite.length,2);
  assert.equal(new Set([...picks.recommended,...picks.favorite].map(item=>item.preset.id)).size,4);
});
test('global preview is detached, cancels without touching any source, and adds only the proposed layer',()=>{
  const snapshot=base(),frozen=structuredClone(snapshot),before=snapshotSettings(snapshot);
  const candidate=advisorCandidate(snapshot,message({kind:'adjustment',label:'收住高光',changes:[{key:'highlights',value:-12}]}));
  assert.deepEqual(snapshot,frozen);assert.equal(candidate.advisorLayers.length,2);assert.deepEqual(candidate.manual,snapshot.manual);
  assert.equal(snapshotSettings(candidate).highlights,before.highlights-12);
  candidate.annotations[0].note='preview change';assert.equal(snapshot.annotations[0].note,'太暗');
});
test('local preview retains manual edits, feather, crop and all unrelated layers',()=>{
  const snapshot=base(),candidate=advisorCandidate(snapshot,message({kind:'region',annotationId:'face',label:'提阴影',changes:[{key:'shadows',value:12}]}));
  assert.deepEqual(snapshotSettings(candidate),snapshotSettings(snapshot));assert.equal(candidate.advisorLayers[1].annotationId,'face');assert.equal(candidate.annotations[0].feather,.8);assert.deepEqual(candidate.crop,snapshot.crop);
  assert.equal(advisorCandidate(snapshot,message({kind:'region',annotationId:'missing',changes:[]})),null);
});
test('style preview replaces only the style; crop preview changes only the frame',()=>{
  const snapshot=base(),style=advisorCandidate(snapshot,message({kind:'style',presetId:'quiet-film'}),{amount:35});
  assert.equal(style.presetAmount,35);assert.deepEqual(style.manual,snapshot.manual);assert.deepEqual(style.advisorLayers,snapshot.advisorLayers);
  const crop=advisorCandidate(snapshot,message({kind:'crop',crop:{x:.1,y:.1,width:.8,height:.8}}));assert.deepEqual(snapshotSettings(crop),snapshotSettings(snapshot));assert.equal(crop.crop.width,.8);assert.equal(crop.crop.angle,3);
  assert.match(actionExplanation({kind:'crop'}).tradeoff,/场景信息/);
});
test('a preview cannot be accepted after switching photos, editing, or changing the intent',()=>{
  const preview={photoId:'a',signature:'current',intent:'肤色真实'};assert.equal(previewStillValid(preview,{photoId:'a',signature:'current',intent:'肤色真实'}),true);
  for(const change of [{photoId:'b'},{signature:'changed'},{intent:'电影感'}])assert.equal(previewStillValid(preview,{photoId:'a',signature:'current',intent:'肤色真实',...change}),false);
});
test('creative intent belongs to each draft photo and older drafts still restore',()=>{
  const photos=['肤色真实','更有电影感'].map((creativeIntent,index)=>({id:String(index),...base(),active:new Set(),manual:{exposure:0},originalBlob:new Blob(['source']),creativeIntent,analysisIntent:creativeIntent,conversation:[],history:{past:[],future:[]},versions:[]}));
  const saved=buildDraftWorkspace('workspace',photos,'0');
  assert.deepEqual(saved.photos.map(item=>restoreDraftPhoto(item).creativeIntent),['肤色真实','更有电影感']);
  assert.equal(restoreDraftPhoto({...saved.photos[0],creativeIntent:undefined}).creativeIntent,'');
});
