import test from 'node:test';
import assert from 'node:assert/strict';
import {neutralSettings} from '../apps/studio/public/editor-engine.js';
import {srgbToLinear,linearToSrgb} from '../apps/studio/public/tone-processing.js';
import {renderPhotoPixels} from '../apps/studio/public/photo-rendering.js';
import {createDocument} from '../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../apps/studio/public/edit-stack/commands.js';
import {sha256} from '../apps/studio/public/edit-stack/identity.js';
import {renderStackPixels,displayMask,createStackRenderCache} from '../apps/studio/public/edit-stack/render.js';
import {presetCommands} from '../apps/studio/public/edit-stack/styles.js';
const document=(width=8,height=6,base={settings:neutralSettings(),locals:[]})=>createDocument({documentId:'photo',source:{assetId:'source',contentHash:sha256('source'),width,height},base});
const step=(id,tool,parameters)=>({id,title:id,tool,toolVersion:2,parameters});
const add=(d,id,tool,parameters)=>applyCommands(d,[{type:'AddStep',step:step(id,tool,parameters)}]).next;
const image=(width=8,height=6,color=[64,64,64,255])=>{const pixels=new Uint8ClampedArray(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set(color,i);return pixels;};
const render=(d,pixels,extra={})=>renderStackPixels({pixels,width:d.source.width,height:d.source.height,document:d,...extra}).pixels;
test('bounded prefix reuse matches cold pixels after changing the last or middle step',()=>{
 const pixels=image(),cache=createStackRenderCache({byteBudget:100000});let d=add(add(add(document(),'a','exposure',{ev:.3}),'b','tone',{contrast:20}),'c','color',{warmth:12});render(d,pixels,{cache});
 const last=applyCommands(d,[{type:'UpdateStepParameters',stepId:'c',parameters:{warmth:-8}}]).next,hot=renderStackPixels({pixels,width:8,height:6,document:last,cache});assert.equal(hot.cachedPrefix,2);assert.deepEqual(hot.pixels,render(last,pixels));
 const middle=applyCommands(last,[{type:'UpdateStepParameters',stepId:'b',parameters:{contrast:-10}}]).next;assert.deepEqual(render(middle,pixels,{cache}),render(middle,pixels));assert.ok(cache.bytes<=100000);
 const repeated=renderStackPixels({pixels,width:8,height:6,document:middle,cache});assert.equal(repeated.cached,true);repeated.pixels[0]=255;assert.deepEqual(render(middle,pixels,{cache}),render(middle,pixels));
});
test('cache binds sampled bytes and the frame, even under the same source/document identity',()=>{
 const cache=createStackRenderCache(),d=add(document(),'grain','finish',{grain:40}),pixels=image();render(d,pixels,{cache});
 const different=image(8,6,[100,80,60,255]);assert.deepEqual(render(d,different,{cache}),render(d,different));
 const frame={fullWidth:8,fullHeight:6,sourceRect:{x:1,y:1,width:6,height:4},angle:0};assert.deepEqual(render(d,pixels,{cache,frame}),render(d,pixels,{frame}));
});
test('disabled, zero opacity, neutral and zero masks strictly bypass all RGBA including hidden RGB',()=>{
 const pixels=image();pixels.set([123,45,67,0],0);let d=add(document(),'light','exposure',{ev:1});
 for(const command of [{type:'SetStepEnabled',stepId:'light',enabled:false},{type:'SetStepOpacity',stepId:'light',opacity:0},{type:'UpdateStepParameters',stepId:'light',parameters:{ev:0}},{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'constant',value:0},reference:{kind:'live-input'}}}])assert.deepEqual(render(applyCommands(d,[command]).next,pixels),pixels);
});
test('Float32 exposure does not quantize or clip intermediate stages',()=>{
 const pixels=image(8,6,[120,80,60,96]);let d=add(document(),'up','exposure',{ev:3,headroomPolicy:'unbounded'});d=add(d,'down','exposure',{ev:-3,headroomPolicy:'unbounded'});assert.deepEqual(render(d,pixels),pixels);
});
test('opacity mixes a computed result and is distinct from scaling the EV parameter',()=>{
 const pixels=image(),full=add(document(),'light','exposure',{ev:1,headroomPolicy:'unbounded'}),half=applyCommands(full,[{type:'SetStepOpacity',stepId:'light',opacity:.5}]).next,halfEv=applyCommands(full,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.5}}]).next;
 const value=render(half,pixels)[0],expected=Math.round(linearToSrgb(srgbToLinear(64/255)*1.5)*255);assert.equal(value,expected);assert.notEqual(value,render(halfEv,pixels)[0]);
});
test('input luminance protection keeps bright pixels byte-identical while lifting dark pixels',()=>{
 const pixels=image();pixels.set([240,240,240,122],0);let d=add(document(),'light','exposure',{ev:.6});d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.55,end:.8},reference:{kind:'live-input'}}}]).next;
 const output=render(d,pixels);assert.deepEqual(output.slice(0,4),pixels.slice(0,4));assert.ok(output[4]>pixels[4]);for(let i=3;i<output.length;i+=4)assert.equal(output[i],pixels[i]);
});
test('positive headroom limits avoid a saturated channel overshoot without losing alpha',()=>{
 const pixels=image(8,6,[250,15,25,96]),d=add(document(),'light','exposure',{ev:2}),output=render(d,pixels);assert.ok(output[0]<=255);assert.ok(output[0]>=250);assert.equal(output[3],96);assert.ok(output[1]<100);
});
test('nonlinear tone and exposure have real order-sensitive pixel output',()=>{
 let d=add(document(),'exposure','exposure',{ev:.8,headroomPolicy:'unbounded'});d=add(d,'tone','tone',{contrast:40,highlights:-30});const reversed=applyCommands(d,[{type:'MoveStep',stepId:'tone',index:0}]).next,pixels=image(8,6,[170,120,90,255]);assert.notDeepEqual(render(d,pixels),render(reversed,pixels));
});
test('a frozen original reference differs from live-input selection after an upstream change',()=>{
 const pixels=image(8,6,[160,160,160,255]);let d=add(document(),'first','exposure',{ev:1,headroomPolicy:'unbounded'});d=add(d,'second','exposure',{ev:1,headroomPolicy:'unbounded'});
 const expression={kind:'luminance',mode:'exclude-highlights',start:.4,end:.6},live=applyCommands(d,[{type:'ReplaceStepMask',stepId:'second',mask:{expression,reference:{kind:'live-input'}}}]).next,frozen=applyCommands(d,[{type:'ReplaceStepMask',stepId:'second',mask:{expression,reference:{kind:'frozen-source',sourceHash:d.source.contentHash}}}]).next;
 assert.ok(render(frozen,pixels)[0]>render(live,pixels)[0]);
});
test('drawn masks retain exact affine geometry and exclusions instead of an expanded bounding box',()=>{
 const pixels=image(8,8);let d=add(document(8,8),'light','exposure',{ev:1});d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'drawn',mask:{shape:'rectangle',rect:{x:0,y:0,width:1,height:1},feather:0,exclude:[]},basis:{origin:{x:.5,y:0},xAxis:{x:.5,y:.5},yAxis:{x:-.5,y:.5}}},reference:{kind:'live-input'}}}]).next;
 const output=render(d,pixels);assert.equal(output[0],pixels[0]);assert.ok(output[(3*8+4)*4]>pixels[(3*8+4)*4]);
 const shown=displayMask({pixels,width:8,height:8,document:d,maskRef:d.steps[0].maskRef,mode:'bw'});assert.equal(shown[0],0);assert.equal(shown[(3*8+4)*4],255);
});
test('color, detail and finish kernels preserve alpha and ignore hidden transparent neighbor colors',()=>{
 let d=add(document(),'color','color',{warmth:10,saturation:8});d=add(d,'detail','detail',{denoise:30,sharpen:5});d=add(d,'finish','finish',{vignette:8,grain:5});const pixels=image(8,6,[90,100,120,128]),other=new Uint8ClampedArray(pixels);pixels.set([0,255,0,0],0);other.set([255,0,255,0],0);
 const a=render(d,pixels),b=render(d,other);assert.deepEqual(a.slice(4),b.slice(4));assert.deepEqual(a.slice(0,4),pixels.slice(0,4));for(let i=3;i<a.length;i+=4)assert.equal(a[i],pixels[i]);
});
test('memory budgets and cancelled jobs fail before presenting an authoritative result',()=>{
 const pixels=image(),d=add(document(),'detail','detail',{denoise:20});assert.throws(()=>render(d,pixels,{memoryBudgetBytes:1}),{code:'RENDER_BUDGET_EXCEEDED'});
 const controller=new AbortController();controller.abort();assert.throws(()=>render(d,pixels,{signal:controller.signal}),{code:'RENDER_CANCELLED'});
});
test('legacy rendering stays byte-identical and new documents do not read shadow aggregate settings',()=>{
 const pixels=image(),settings={...neutralSettings(),warmth:12,shadows:8},base={settings,locals:[]},d=document(8,6,base),legacy=renderPhotoPixels({pixels,width:8,height:6,settings,annotations:[]}),withDocument=renderPhotoPixels({pixels,width:8,height:6,settings:{...neutralSettings(),exposure:3},annotations:[],document:d});assert.deepEqual(withDocument,legacy);
});
test('style recipes expand into independently editable nodes with pinned preset provenance',()=>{
 const d=applyCommands(document(),presetCommands('daily-soft',70,{groupId:'look'})).next;assert.ok(d.steps.length>1);assert.equal(d.groups[0].provenance.presetVersion,1);
 const id=d.steps[0].id,edited=applyCommands(d,[{type:'SetStepOpacity',stepId:id,opacity:.2}]).next;assert.equal(edited.steps[0].opacity,.2);assert.deepEqual(edited.steps.slice(1),d.steps.slice(1));assert.ok(render(d,image()).some((value,index)=>value!==image()[index]));
});
test('mask display samples the actual upstream Float32 input even while its effect is paused',()=>{
 const pixels=image(8,6,[160,160,160,255]);let d=add(document(),'first','exposure',{ev:1,headroomPolicy:'unbounded'});d=add(d,'second','exposure',{ev:1});d=applyCommands(d,[{type:'ReplaceStepMask',stepId:'second',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.4,end:.6},reference:{kind:'live-input'}}},{type:'SetStepEnabled',stepId:'second',enabled:false}]).next;
 const output=renderStackPixels({pixels,width:8,height:6,document:d,maskView:{stepId:'second',mode:'bw'}});assert.equal(output.pixels[0],0);assert.equal(output.displayOnly,true);assert.ok(render(d,pixels)[0]>pixels[0]);
});
