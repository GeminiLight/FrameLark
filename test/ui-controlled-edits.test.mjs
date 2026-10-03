import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {toggleSelection, createLatestMutationQueue, samePreviewIdentity, imageMatchesIdentity, createPreviewGate, selectedCandidateCanAccept, protectionOutline, renderedViewCrop, guardActionReady} from '../skills/photo-retouch/scripts/ui/controlled-edits-model.js';
import {viewToOriginalPoint, originalToViewPoint} from '../skills/photo-retouch/scripts/engine/photo-geometry.js';

const items = [
  {id: 'light', title: '人物提亮', dependsOn: []},
  {id: 'color', title: '肤色', dependsOn: ['light']},
  {id: 'detail', title: '细节', dependsOn: ['color']},
  {id: 'sky', title: '天空', dependsOn: []},
];
const identity = (overrides = {}) => ({version: 'candidate-1', candidateId: 'candidate-1', selectionHash: 'hash-a', revision: 4, view: 'compare', currentId: 'version-0', ...overrides});
const metadata = (overrides = {}) => ({revision: '4', selectionHash: 'hash-a', frameSpec: '{"width":1400,"height":1000}', ...overrides});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
function fakeTimers() { let serial = 0; const timers = new Map(); return {schedule(fn) { const id = ++serial; timers.set(id, fn); return id; }, cancel(id) { timers.delete(id); }, size: () => timers.size}; }

 test('selecting includes all dependencies and preserves plan order, regardless of click order', () => {
  const result = toggleSelection(items, ['sky'], 'detail', true);
  assert.deepEqual(result.selectedItemIds, ['light', 'color', 'detail', 'sky']);
  assert.deepEqual(result.addedIds, ['light', 'color', 'detail']);
  assert.deepEqual(toggleSelection(items, ['detail', 'color', 'light'], 'sky', true).selectedItemIds, result.selectedItemIds);
  assert.deepEqual(toggleSelection(items, result.selectedItemIds, 'detail', true).addedIds, []);
});

test('deselecting cancels transitive dependents and leaves independent items', () => {
  const result = toggleSelection(items, ['light', 'color', 'detail', 'sky'], 'light', false);
  assert.deepEqual(result.selectedItemIds, ['sky']);
  assert.deepEqual(result.removedIds, ['light', 'color', 'detail']);
  assert.deepEqual(toggleSelection(items, ['light', 'color', 'detail'], 'detail', false).selectedItemIds, ['light', 'color']);
});

test('empty selections remain valid UI state; malformed dependency graphs fail visibly', () => {
  assert.deepEqual(toggleSelection(items, ['light'], 'light', false).selectedItemIds, []);
  assert.throws(() => toggleSelection([{id: 'a', dependsOn: ['b']}, {id: 'b', dependsOn: ['a']}], [], 'a', true), /循环/);
  assert.throws(() => toggleSelection([{id: 'a', dependsOn: ['missing']}], [], 'a', true), /缺失/);
  assert.throws(() => toggleSelection(items, [], 'missing', true), /找不到/);
});

test('rapid pre-dispatch changes debounce to exactly the newest selection', async () => {
  const timers = fakeTimers(), sent = [], pending = [];
  const queue = createLatestMutationQueue({...timers, send: async value => {sent.push(value); return value;}, onResult: () => {}, onError: error => {throw error;}, onPending: value => pending.push(value)});
  queue.enqueue({id: 'a', selectedItemIds: ['light']});
  queue.enqueue({id: 'a', selectedItemIds: ['light', 'sky']});
  queue.enqueue({id: 'a', selectedItemIds: []});
  assert.equal(timers.size(), 1); assert.equal(queue.pending(), true);
  await queue.flush();
  assert.deepEqual(sent, [{id: 'a', selectedItemIds: []}]);
  assert.deepEqual(pending, [true, false]); assert.equal(timers.size(), 0);
});

test('in-flight writes are serialized; intermediate choices are skipped and next write uses acknowledged revision/hash', async () => {
  const first = deferred(), timers = fakeTimers(), sent = [], received = [], pending = [];
  let revision = 4, hash = 'hash-a', active = 0, maxActive = 0;
  const queue = createLatestMutationQueue({...timers,
    async send(value) { active++; maxActive = Math.max(maxActive, active); sent.push({...value, revision, hash}); if (sent.length === 1) await first.promise; active--; return {revision: revision + 1, hash: 'hash-' + sent.length}; },
    onResult(result, context) { revision = result.revision; hash = result.hash; received.push(context.latest); },
    onError(error) { throw error; }, onPending: value => pending.push(value),
  });
  queue.enqueue({selectedItemIds: ['light']}); const completion = queue.flush();
  queue.enqueue({selectedItemIds: ['light', 'color']}); queue.enqueue({selectedItemIds: ['sky']});
  assert.equal(sent.length, 1); first.resolve(); await completion;
  assert.equal(maxActive, 1); assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], {selectedItemIds: ['sky'], revision: 5, hash: 'hash-1'});
  assert.deepEqual(received, [false, true]); assert.deepEqual(pending, [true, false]);
});

test('conflicted writes do not blindly replay queued edits; a fresh user action can retry', async () => {
  const first = deferred(), timers = fakeTimers(), sent = [], errors = []; let settled;
  const queue = createLatestMutationQueue({...timers, async send(value) { sent.push(value); if (sent.length === 1) await first.promise; return value; }, onResult() {}, onError(error) { errors.push(error.message); }, onSettled(value) { settled = value; }});
  queue.enqueue(['light']); const completion = queue.flush(); queue.enqueue(['sky']);
  first.reject(new Error('STALE_REVISION')); await completion;
  assert.deepEqual(errors, ['STALE_REVISION']); assert.deepEqual(sent, [['light']]);
  assert.equal(queue.pending(), false); assert.equal(settled.failed, true);
  queue.enqueue(['sky']); await queue.flush(); assert.deepEqual(sent, [['light'], ['sky']]); assert.equal(settled.failed, false);
});

test('preview identity includes candidate ID, selection hash, revision, view and accepted base', () => {
  const base = identity(); assert.equal(samePreviewIdentity(base, {...base}), true);
  for (const key of ['version', 'candidateId', 'selectionHash', 'revision', 'view', 'currentId']) assert.equal(samePreviewIdentity(base, {...base, [key]: 'changed'}), false, key);
  assert.equal(samePreviewIdentity(null, base), false);
});

test('image metadata must match project revision and selected hash and supply frame specification', () => {
  assert.equal(imageMatchesIdentity(identity(), metadata()), true);
  assert.equal(imageMatchesIdentity(identity(), metadata({revision: '3'})), false);
  assert.equal(imageMatchesIdentity(identity(), metadata({selectionHash: 'old'})), false);
  assert.equal(imageMatchesIdentity(identity(), metadata({frameSpec: null})), false);
  assert.equal(imageMatchesIdentity(identity({selectionHash: ''}), metadata({selectionHash: ''})), true);
});

test('a click immediately invalidates an already displayed preview before debounce or a server response', () => {
  const gate = createPreviewGate(), current = identity(), ticket = gate.begin(current);
  assert.equal(gate.complete(ticket, current, metadata()), true); assert.equal(gate.readyFor(current), true);
  gate.invalidate(); assert.equal(gate.readyFor(current), false);
  assert.equal(gate.complete(ticket, current, metadata()), false);
});

test('slow out-of-order previews cannot replace a newer displayed image, even for the same candidate', () => {
  const gate = createPreviewGate(), old = identity(), newest = identity({selectionHash: 'hash-b', revision: 5});
  const oldRequest = gate.begin(old), newRequest = gate.begin(newest);
  assert.equal(gate.complete(newRequest, newest, metadata({selectionHash: 'hash-b', revision: '5'})), true);
  assert.equal(gate.complete(oldRequest, old, metadata()), false);
  assert.equal(gate.readyFor(newest), true); assert.equal(gate.readyFor(old), false);
  assert.equal(gate.complete(newRequest, identity({candidateId: 'candidate-2'}), metadata()), false);
});

test('same-ID reloads and view changes invalidate decode callbacks and revision-only refreshes', () => {
  const gate = createPreviewGate(), current = identity(), first = gate.begin(current), second = gate.begin(current);
  assert.equal(gate.isCurrent(first, current), false); assert.equal(gate.isCurrent(second, current), true);
  assert.equal(gate.complete(second, identity({revision: 5}), metadata()), false);
  assert.equal(gate.complete(second, identity({view: 'original'}), metadata()), false);
});

test('accept gating rejects empty, unchanged, stale, pending or unseen selections; legacy candidates remain compatible', () => {
  const candidate = {id: 'candidate-1', items, selectedItemIds: ['sky']};
  assert.equal(selectedCandidateCanAccept(candidate, {previewReady: true}), true);
  assert.equal(selectedCandidateCanAccept({...candidate, selectedItemIds: []}, {previewReady: true}), false);
  assert.equal(selectedCandidateCanAccept({...candidate, noChange: true}, {previewReady: true}), false);
  assert.equal(selectedCandidateCanAccept({...candidate, stale: true}, {previewReady: true}), false);
  assert.equal(selectedCandidateCanAccept(candidate, {previewReady: true, pending: true}), false);
  assert.equal(selectedCandidateCanAccept(candidate), false);
  assert.equal(selectedCandidateCanAccept({id: 'legacy'}, {previewReady: true}), true);
});

test('protection outlines expose a hard core and outward rectangle/radial feather', () => {
  const mask = {origin: {x: .2, y: .3}, axisX: {x: .4, y: 0}, axisY: {x: 0, y: .2}, type: 'rectangle', feather: .1};
  const core = protectionOutline(mask), outer = protectionOutline(mask, undefined, true);
  assert.deepEqual(core[0], {x: .2, y: .3});
  assert.ok(outer[0].x < core[0].x && outer[0].y < core[0].y);
  const radial = protectionOutline({...mask, type: 'radial'}), radialOuter = protectionOutline({...mask, type: 'radial'}, undefined, true);
  assert.ok(Math.abs(radial[0].x - .6) < 1e-12); assert.ok(Math.abs(radial[0].y - .4) < 1e-12);
  assert.ok(Math.abs(radialOuter[0].x - .64) < 1e-12); assert.equal(radial.length, 64);
});

test('rotated original-space affine core projects back to the exact selected current-view shape', () => {
  const crop = {x: .1, y: .05, width: .8, height: .9, angle: 7}, width = 1200, height = 800;
  const rect = {x: .22, y: .3, width: .25, height: .2};
  const origin = viewToOriginalPoint(rect, crop, width, height);
  const right = viewToOriginalPoint({x: rect.x + rect.width, y: rect.y}, crop, width, height);
  const bottom = viewToOriginalPoint({x: rect.x, y: rect.y + rect.height}, crop, width, height);
  const mask = {origin, axisX: {x: right.x-origin.x, y: right.y-origin.y}, axisY: {x: bottom.x-origin.x, y: bottom.y-origin.y}, type: 'rectangle', feather: .08};
  const result = protectionOutline(mask, point => originalToViewPoint(point, crop, width, height));
  const expected = [[rect.x, rect.y], [rect.x+rect.width, rect.y], [rect.x+rect.width, rect.y+rect.height], [rect.x, rect.y+rect.height]];
  result.forEach((point, index) => { assert.ok(Math.abs(point.x-expected[index][0])<1e-12); assert.ok(Math.abs(point.y-expected[index][1])<1e-12); });
});

test('UI retains optional lettering and crop-only note protection, and provides explicit accepted-view protection controls', async () => {
  const html = await readFile(new URL('../skills/photo-retouch/scripts/ui/index.html', import.meta.url), 'utf8');
  for (const id of ['lettering-dialog', 'lettering-open', 'export-include-text', 'candidate-items', 'selection-status', 'guard-view-current', 'protect-feather', 'guard-save-region', 'geometry-lock-reason', 'local-lock-reason', 'restore-error']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /裁剪时保留这处/); assert.match(html, /核心内部不羽化/);
});

test('protection overlays map through the same rounded source grid as the rendered photo', () => {
  const nominal = {x: .05, y: .03, width: .9, height: .94, angle: 5};
  const actual = renderedViewCrop(nominal, 512, 512);
  assert.equal(actual.x, 26 / 512); assert.equal(actual.y, 15 / 512);
  assert.notEqual(actual.x, nominal.x); assert.equal(actual.angle, 5);
  const selected = {x: .2, y: .3};
  const original = viewToOriginalPoint(selected, actual, 512, 512);
  const projected = originalToViewPoint(original, actual, 512, 512);
  assert.ok(Math.abs(projected.x-selected.x)<1e-12); assert.ok(Math.abs(projected.y-selected.y)<1e-12);
  assert.deepEqual(renderedViewCrop(null, 512, 400), {x:0, y:0, width:1, height:1, angle:0});
});

test('UI mutation queue and preview identity complete a real HTTP selection-to-accept contract', async t => {
  const {mkdtemp, rm} = await import('node:fs/promises');
  const os = await import('node:os'), path = await import('node:path');
  const {createRequire} = await import('node:module');
  const sharp = createRequire(new URL('../skills/photo-retouch/package.json', import.meta.url))('sharp');
  const {initProject, createCandidate} = await import('../skills/photo-retouch/scripts/project.mjs');
  const {serveProject} = await import('../skills/photo-retouch/scripts/server.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'frameyn-ui-contract-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const image = path.join(root, 'source.png'), folder = path.join(root, 'project');
  await sharp({create: {width:64, height:48, channels:4, background:{r:100,g:120,b:150,alpha:1}}}).png().toFile(image);
  const initialized = await initProject(image, folder);
  const created = await createCandidate(folder, {revision:initialized.project.revision, baseVersion:initialized.project.currentId, items:[
    {id:'light', title:'提亮', patch:{settings:{exposure:.3}}},
    {id:'sky', title:'阴影', patch:{settings:{shadows:12}}},
  ]});
  const server = await serveProject(folder, {quiet:true}); t.after(() => server.close());
  const url = new URL(server.session.url), base = url.origin;
  const headers = {'X-Guangjian-Token':new URLSearchParams(url.hash.slice(1)).get('token'), 'Content-Type':'application/json'};
  async function api(route, value) { return fetch(base+'/api/'+route, {headers, ...(value ? {method:'POST', body:JSON.stringify(value)} : {})}); }
  for (const route of ['/app.js','/controlled-edits.js','/controlled-edits-model.js','/preview-requests.js','/lettering.js','/engine/crop-utils.js']) {
    const response = await fetch(base+route); assert.equal(response.status,200,route); assert.match(response.headers.get('content-type'), /javascript/);
  }
  let project = await (await api('project')).json(), candidate = project.candidates[0], errors = [];
  const dispatched = [], gate = createPreviewGate(), timers = fakeTimers();
  const queue = createLatestMutationQueue({...timers,
    async send(value) {
      const request = {...value, id:candidate.id, revision:project.revision, selectionHash:candidate.selectionHash}; dispatched.push(request);
      const response = await api('candidate-selection',request); const result = await response.json();
      if(!response.ok)throw Error(result.error.message); return result;
    },
    onResult(result) { project=result.project; candidate=result.candidate; }, onError(error) {errors.push(error);}, onPending(value) {if(value)gate.invalidate();},
  });
  queue.enqueue({selectedItemIds:['light']}); const first = queue.flush();
  queue.enqueue({selectedItemIds:['light','sky']}); queue.enqueue({selectedItemIds:[]}); await first;
  assert.deepEqual(errors,[]); assert.equal(dispatched.length,2); assert.equal(dispatched[1].revision,created.project.revision+1);
  assert.notEqual(dispatched[1].selectionHash,dispatched[0].selectionHash); assert.deepEqual(candidate.selectedItemIds,[]);
  assert.equal(selectedCandidateCanAccept(candidate,{previewReady:true}),false);
  const beforeCount=project.versions.length;
  const emptyAccept=await api('accept',{id:candidate.id,revision:project.revision,selectionHash:candidate.selectionHash});
  assert.equal(emptyAccept.status,400); assert.equal((await emptyAccept.json()).error.code,'NO_CHANGE');
  queue.enqueue({selectedItemIds:['sky']}); await queue.flush();
  const context=identity({version:candidate.id,candidateId:candidate.id,selectionHash:candidate.selectionHash,revision:project.revision,currentId:project.currentId});
  const ticket=gate.begin(context);
  const preview=await api(`image?version=${candidate.id}&selectionHash=${candidate.selectionHash}&revision=${project.revision}`);
  assert.equal(preview.status,200);
  const responseIdentity={revision:preview.headers.get('X-Project-Revision'),selectionHash:preview.headers.get('X-Selection-Hash'),frameSpec:preview.headers.get('X-Frame-Spec')};
  assert.ok((await preview.arrayBuffer()).byteLength>0); assert.equal(gate.complete(ticket,context,responseIdentity),true);
  assert.equal(selectedCandidateCanAccept(candidate,{previewReady:gate.readyFor(context)}),true);
  const accepted=await api('accept',{id:candidate.id,revision:project.revision,selectionHash:candidate.selectionHash});
  assert.equal(accepted.status,200); const result=await accepted.json();
  assert.equal(result.project.versions.length,beforeCount+1); assert.equal(result.version.state.settings.exposure,0); assert.equal(result.version.state.settings.shadows,12);
  const staleImage=await api(`image?version=${candidate.id}&selectionHash=${candidate.selectionHash}&revision=${project.revision}`);
  assert.equal(staleImage.status,409);
});

test('broken protected previews still permit explicit unlock recovery, but cannot create locks or protect unseen pixels', () => {
  const context = {current:{id:'saved'},candidate:null,view:'current',previewReady:false,busy:false,dirty:false};
  assert.equal(guardActionReady(context),false);
  assert.equal(guardActionReady(context,{needsPreview:false}),true);
  for(const changed of [{candidate:{id:'trial'}},{view:'original'},{busy:true},{dirty:true}]) assert.equal(guardActionReady({...context,...changed},{needsPreview:false}),false);
  assert.equal(guardActionReady(context,{needsPreview:false,pending:true}),false);
  assert.equal(guardActionReady({...context,previewReady:true}),true);
});

test('HTTP unlock-all recovery previews and accepts a clean candidate while preserving parameter locks', async t => {
  const {mkdtemp, rm, writeFile} = await import('node:fs/promises');
  const os = await import('node:os'), path = await import('node:path');
  const {createRequire} = await import('node:module');
  const sharp = createRequire(new URL('../skills/photo-retouch/package.json', import.meta.url))('sharp');
  const {initProject, changeGuards, loadProject, currentVersion} = await import('../skills/photo-retouch/scripts/project.mjs');
  const {serveProject} = await import('../skills/photo-retouch/scripts/server.mjs');
  const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-ui-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const image=path.join(root,'source.png'),folder=path.join(root,'project');
  await sharp({create:{width:64,height:64,channels:4,background:{r:120,g:140,b:160,alpha:1}}}).png().toFile(image);
  let {project}=await initProject(image,folder);
  ({project}=await changeGuards(folder,{revision:project.revision,operation:'lock',parameters:['exposure']}));
  for(const x of [.1,.65]) ({project}=await changeGuards(folder,{revision:project.revision,operation:'protect',coordinateSpace:'view',rect:{x,y:.2,width:.2,height:.3},feather:0}));
  // Simulate a project from an older renderer, leaving its historical records intact.
  for(const region of currentVersion(project).state.guards.regions)region.pipeline='older-renderer';
  await writeFile(path.join(folder,'project.json'),JSON.stringify(project));
  const runtime=await serveProject(folder,{quiet:true});t.after(()=>runtime.close());
  const url=new URL(runtime.session.url),headers={'X-Guangjian-Token':new URLSearchParams(url.hash.slice(1)).get('token'),'Content-Type':'application/json'};
  const api=(route,value)=>fetch(url.origin+'/api/'+route,{headers,...(value?{method:'POST',body:JSON.stringify(value)}:{})});
  const initial=await api('project');assert.equal(initial.status,200);project=await initial.json();
  const failed=await api(`image?version=current&revision=${project.revision}`);assert.equal(failed.status,400);assert.equal((await failed.json()).error.code,'REFERENCE_PIPELINE_CHANGED');
  const regionIds=currentVersion(project).state.guards.regions.map(region=>region.id);
  const result=await api('guards',{operation:'unlock',revision:project.revision,parameterKeys:[],localIds:[],regionIds});assert.equal(result.status,200);
  const unlocked=await result.json();assert.equal(unlocked.candidate.state.guards.regions.length,0);assert.equal(unlocked.candidate.state.guards.parameters[0].key,'exposure');
  assert.equal(currentVersion(unlocked.project).state.guards.regions.length,2);
  const preview=await api(`image?version=${unlocked.candidate.id}&revision=${unlocked.project.revision}&selectionHash=${unlocked.candidate.selectionHash}`);
  assert.equal(preview.status,200);assert.ok((await preview.arrayBuffer()).byteLength);
  const accepted=await api('accept',{id:unlocked.candidate.id,revision:unlocked.project.revision,selectionHash:unlocked.candidate.selectionHash});assert.equal(accepted.status,200);
  const final=currentVersion(await loadProject(folder));assert.equal(final.state.guards.regions.length,0);assert.equal(final.state.guards.parameters[0].key,'exposure');
});

test('clean preview and export remain available for lettering retained only in protected references',async()=>{
  const {hasLetteringContent}=await import('../skills/photo-retouch/scripts/ui/controlled-edits-model.js');
  assert.equal(hasLetteringContent({textOverlays:[],guards:{regions:[]}}),false);
  assert.equal(hasLetteringContent({textOverlays:[{text:'A'}]}),true);
  assert.equal(hasLetteringContent({textOverlays:[],guards:{regions:[{snapshot:{pixelHash:'full'},cleanSnapshot:{pixelHash:'clean'}}]}}),true);
  assert.equal(hasLetteringContent({textOverlays:[],guards:{regions:[{snapshot:{pixelHash:'same'},cleanSnapshot:{pixelHash:'same'}}]}}),false);
});

test('refinement pins the selected candidate combination and rejects changed, stale, discarded or unlock sources', async () => {
  const {refinementSource, refinementSourceMatches}=await import('../skills/photo-retouch/scripts/ui/controlled-edits-model.js');
  const current={id:'accepted'}, candidate={id:'trial',selectionHash:'chosen-a'};
  const project={currentId:current.id,candidates:[candidate]};
  const source=refinementSource(project,candidate);
  assert.deepEqual(source,{baseVersion:'accepted',fromCandidate:'trial',selectionHash:'chosen-a'});
  assert.equal(refinementSourceMatches(source,project),true);
  assert.equal(refinementSourceMatches(source,{...project,revision:9}),true);
  for(const changed of [{selectionHash:'chosen-b'},{stale:true},{guardOperation:{regionIds:['guard']}}]) assert.equal(refinementSourceMatches(source,{...project,candidates:[{...candidate,...changed}]}),false);
  assert.equal(refinementSourceMatches(source,{...project,candidates:[]}),false);
  assert.equal(refinementSourceMatches(source,{...project,currentId:'new-accepted'}),false);
  assert.equal(refinementSourceMatches(refinementSource(project,current),project),true);
});

test('preview cancellation covers decode waits and late promises without validating old image tickets', async () => {
  const {abortable}=await import('../skills/photo-retouch/scripts/ui/controlled-edits-model.js');
  const deferredDecode=deferred(), controller=new AbortController(), gate=createPreviewGate(), context=identity();
  const ticket=gate.begin(context), wait=abortable(deferredDecode.promise,controller.signal);
  controller.abort('timeout');gate.invalidate();
  await assert.rejects(wait,{name:'AbortError',reason:'timeout'});
  deferredDecode.resolve('late image');
  assert.equal(gate.complete(ticket,context,metadata()),false);
  const alreadyAborted=new AbortController();alreadyAborted.abort('replaced');
  await assert.rejects(abortable(Promise.reject(new Error('late network failure')),alreadyAborted.signal),{name:'AbortError',reason:'replaced'});
  assert.equal(await abortable(Promise.resolve('decoded'),new AbortController().signal),'decoded');
});

test('merged UI retains upstream recovery and refinement controls alongside protected clean lettering', async () => {
  const directory=new URL('../skills/photo-retouch/scripts/ui/',import.meta.url);
  const html=await readFile(new URL('index.html',directory),'utf8'),app=await readFile(new URL('app.js',directory),'utf8'),lettering=await readFile(new URL('lettering.js',directory),'utf8'),css=await readFile(new URL('style.css',directory),'utf8');
  for(const id of ['preview-error','preview-error-message','retry-image','candidate-pending','manual-source','lettering-source','guard-unlock-regions']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(app,/controller\.abort\('timeout'\)/);assert.match(app,/candidate-expired/);
  assert.match(app,/fromCandidate:manualSource\.fromCandidate/);assert.match(app,/fromCandidate:localDraft\.source\.fromCandidate/);
  assert.match(app,/getBase:\(\)=>showing\(\)/);assert.match(lettering,/refinementSourceMatches\(sourceIdentity,getProject\(\)\)/);
  assert.match(lettering,/hasLetteringContent\(state\)/);assert.match(css,/\.photo-stage\.is-comparing/);
});

// Exercise the same DOM-free request coordinators used by app.js. Pending and
// decoded previews both retain their exact revision/hash/view identity.
test('repeated high-resolution zooms share one request and reuse the displayed preview', async () => {
  const {createPreviewRequests}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const requests=createPreviewRequests(), first=deferred(), controllers=[];
  const render=controller=>{controllers.push(controller);return first.promise;};
  const pending=requests.load(identity(),8192,render);
  assert.equal(requests.load(identity(),8192,render),pending);
  assert.equal(requests.load(identity(),1400,render),pending);
  await Promise.resolve();assert.equal(controllers.length,1);assert.equal(controllers[0].signal.aborted,false);
  first.resolve(true);assert.equal(await pending,true);
  assert.equal(await requests.load(identity(),8192,render),true);
  assert.equal(await requests.load(identity(),1400,render),true);
  assert.equal(controllers.length,1);assert.equal(controllers[0].signal.aborted,false);
});

test('detail upgrades replace low-resolution work once and stale completion cannot clear newer in-flight work', async () => {
  const {createPreviewRequests}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const requests=createPreviewRequests(), low=deferred(), high=deferred(), controllers=[];
  const initial=requests.load(identity(),1400,controller=>{controllers.push(controller);return low.promise;});
  await Promise.resolve();
  const upgrade=requests.load(identity(),8192,controller=>{controllers.push(controller);return high.promise;});
  await Promise.resolve();assert.equal(controllers[0].signal.reason,'replaced');
  low.resolve(true);assert.equal(await initial,false);
  assert.equal(requests.load(identity(),8192,()=>{throw Error('duplicate');}),upgrade);
  assert.equal(controllers[1].signal.aborted,false);
  high.resolve(true);await upgrade;
  assert.equal(await requests.load(identity(),8192,()=>{throw Error('duplicate');}),true);
});

test('every preview identity component defeats reuse and explicit invalidation permits same-identity reloads', async () => {
  const {createPreviewRequests}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  for(const key of ['version','candidateId','selectionHash','revision','view','currentId']){
    const requests=createPreviewRequests(), old=deferred();let controller;
    const pending=requests.load(identity(),8192,value=>{controller=value;return old.promise;});
    await Promise.resolve();
    assert.equal(await requests.load(identity({[key]:'changed'}),8192,async()=>true),true,key);
    assert.equal(controller.signal.reason,'replaced',key);old.resolve(true);await pending;
    let fresh=0;await requests.load(identity(),8192,async()=>{fresh++;return true;});assert.equal(fresh,1,key);
    requests.invalidate();await requests.load(identity(),8192,async()=>{fresh++;return true;});assert.equal(fresh,2,key);
  }
});

test('failed, aborted and invalidated image requests are retryable and never become reusable previews', async () => {
  const {createPreviewRequests}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const requests=createPreviewRequests();let calls=0;
  await assert.rejects(requests.load(identity(),8192,async()=>{calls++;throw Error('network failure');}),/network failure/);
  assert.equal(await requests.load(identity(),8192,async()=>{calls++;return false;}),false);
  assert.equal(await requests.load(identity(),8192,async controller=>{calls++;controller.abort('timeout');return true;}),false);
  const cancelled=requests.load(identity(),8192,async()=>{throw Error('must not dispatch after invalidation');});
  requests.invalidate();assert.equal(await cancelled,false);
  await requests.load(identity(),8192,async()=>{calls++;return true;});assert.equal(calls,4);
});

function pollTimers(){
  let serial=0;const timers=new Map();
  return {
    schedule(fn){const id=++serial;timers.set(id,fn);return id;},cancel(id){timers.delete(id);},
    size:()=>timers.size,
    tick(){assert.equal(timers.size,1);const [id,fn]=timers.entries().next().value;timers.delete(id);return fn();},
  };
}

test('project polling never overlaps a slow read or image update and start is idempotent', async()=>{
  const {createProjectPoller}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const timers=pollTimers(), read=deferred(), updated=deferred();let reads=0,updates=0,connected=0;
  const poller=createProjectPoller({...timers,read:()=>{reads++;return read.promise;},getProject:()=>({revision:1}),blocked:()=>false,update:()=>{updates++;return updated.promise;},connected:()=>connected++});
  poller.start();poller.start();assert.equal(timers.size(),1);
  const pending=timers.tick();poller.start();assert.equal(timers.size(),0);assert.equal(reads,1);
  read.resolve({revision:2});await Promise.resolve();assert.equal(updates,1);assert.equal(timers.size(),0);
  updated.resolve();await pending;assert.equal(timers.size(),1);assert.equal(connected,1);
  poller.stop();assert.equal(timers.size(),0);
});

test('project polling recovers from an initially disconnected project and retries later failures', async()=>{
  const {createProjectPoller}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const timers=pollTimers(), failures=[], previousProjects=[];let project,attempt=0,connections=0;
  const poller=createProjectPoller({...timers,read:async()=>{if(++attempt%2)throw Error('disconnected');return {revision:0,currentId:'saved'};},getProject:()=>project,blocked:()=>false,
    update:async(next,previous)=>{previousProjects.push(previous);project=next;},connected:()=>connections++,onError:error=>failures.push(error.message)});
  poller.start();await timers.tick();assert.equal(project,undefined);assert.equal(timers.size(),1);
  await timers.tick();assert.deepEqual(previousProjects,[undefined]);assert.equal(project.currentId,'saved');assert.equal(connections,1);
  await timers.tick();await timers.tick();assert.equal(connections,2);assert.equal(previousProjects.length,1);
  assert.deepEqual(failures,['disconnected','disconnected']);poller.stop();
});

test('polling checks draft/navigation blocks again after reads and ignores older project snapshots', async()=>{
  const {createProjectPoller}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const timers=pollTimers();let blocked=true,reads=0,updates=0,connections=0,read=deferred();
  const poller=createProjectPoller({...timers,read:()=>{reads++;return read.promise;},getProject:()=>({revision:4}),blocked:()=>blocked,update:async()=>updates++,connected:()=>connections++});
  poller.start();await timers.tick();assert.equal(reads,0);
  blocked=false;const pending=timers.tick();blocked=true;read.resolve({revision:5});await pending;assert.equal(updates,0);assert.equal(connections,0);
  blocked=false;read=deferred();const stale=timers.tick();read.resolve({revision:3});await stale;assert.equal(updates,0);assert.equal(connections,0);
  read=deferred();const same=timers.tick();read.resolve({revision:4});await same;assert.equal(updates,0);assert.equal(connections,1);
  poller.stop();
});

test('stopping a poll suppresses late read delivery and later restart retains one timer', async()=>{
  const {createProjectPoller}=await import('../skills/photo-retouch/scripts/ui/preview-requests.js');
  const timers=pollTimers(), read=deferred();let updates=0,connections=0;
  const poller=createProjectPoller({...timers,read:()=>read.promise,getProject:()=>undefined,blocked:()=>false,update:async()=>updates++,connected:()=>connections++});
  poller.start();const pending=timers.tick();poller.stop();read.resolve({revision:1});await pending;
  assert.equal(updates,0);assert.equal(connections,0);assert.equal(timers.size(),0);
  poller.start();assert.equal(timers.size(),1);poller.stop();
});
