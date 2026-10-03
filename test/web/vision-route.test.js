import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const reviewFixture = JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url),'utf8'));
const retentionFixture = JSON.parse(await readFile(new URL('./fixtures/vision-retention.json',import.meta.url),'utf8'));

const projectDir = fileURLToPath(new URL('../..', import.meta.url));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));

test('vision route calls the configured image model and returns actionable analysis', async t => {
  const requests = [];
  const fakeProvider = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const requestBody = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(requestBody);
    const reassessment = {
      summary:'天空层次更完整，但前景变得稍亮。',observation:'检查人物轮廓与远山的分离度。',
      before:{light:68,highlights:57,shadows:62,color:73,contrast:70,detail:72},
      after:{light:74,highlights:79,shadows:76,color:75,contrast:73,detail:70}
    };
    Object.assign(reassessment,{beforeEvidence:reviewFixture.metricEvidence,afterEvidence:reviewFixture.metricEvidence,improvements:[{finding:'天空层次更完整。',evidence:'右上云层过渡更清楚。',condition:'以保留自然晨光为目标。'}],tradeoffs:[{finding:'前景稍亮。',evidence:'左下岩石的暗调变浅。',condition:'若希望低调，可降低强度。'}],preserved:[]});
    const analysis = structuredClone(reviewFixture);analysis.observations.emotion.location=null;
    const designReply = {clarification:{question:'',choices:[]},reply:'天空已有暖光，先收一点高光，保留云层。',principle:'先保护亮部，再调整暗部。',action:{steps:[],
      kind:'adjustment',label:'试用光线微调',goal:'保留天空层次',tradeoff:'检查暗调是否被改变',presetId:'none',changes:[{key:'highlights',value:-12}],crop:{x:0,y:0,width:1,height:1}
    }};
    response.writeHead(200, {'Content-Type':'application/json'});
    const payload = requestBody.text.format.name === 'design_agent_reply' ? designReply : requestBody.text.format.name === 'photo_reassessment' ? reassessment : analysis;
    response.end(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(payload)}]}]}));
  });
  const providerPort = await listen(fakeProvider);
  t.after(() => close(fakeProvider));

  const probe = http.createServer();
  const appPort = await listen(probe);
  await close(probe);
  const app = spawn(process.execPath, ['server.mjs'], {
    cwd:projectDir,
    env:{...process.env,PORT:String(appPort),OPENAI_API_KEY:'test-key',OPENAI_MODEL:'gpt-6-astra',OPENAI_API_URL:`http://127.0.0.1:${providerPort}/v1/responses`},
    stdio:'ignore'
  });
  t.after(() => { if (!app.killed) app.kill(); });
  const base = `http://127.0.0.1:${appPort}`;
  let status;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { status = await fetch(`${base}/api/status`); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 40)); }
  }
  assert.ok(status?.ok, 'app server starts with vision model enabled');
  assert.deepEqual(await status.json(), {aiAvailable:true,model:'gpt-6-astra',connectionStatus:'configured',verifiedAt:null,lastError:null});

  const result = await fetch(`${base}/api/analyze`, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:'data:image/png;base64,aGVsbG8=',creativeIntent:'保留清晨的安静',trials:[{image:'data:image/png;base64,aGVsbG8=',settings:{exposure:.7,instructions:'TRIAL_INJECTION'}}],photoReference:{width:3,height:1,mean:.3,p10:.1,p50:.3,p90:.6,darkFraction:.05,brightFraction:0,gridMean:[.1,.2,.3,null,null,null,null,null,null],instructions:'METERING_INJECTION'}})
  });
  assert.equal(result.status, 200);
  const returned = await result.json();
  const returnedAnalysis = returned.analysis;
  assert.equal(returned.provenance.source,'vision');
  assert.equal(returned.provenance.model,'gpt-6-astra');
  assert.equal(returned.provenance.promptVersion,'photo-review-2026-10-03-color-v4');
  assert.equal(returned.provenance.creativeIntent,'保留清晨的安静');
  assert.match(requests[0].input[0].content[0].text,/保留清晨的安静/);
  assert.match(requests[0].input[0].content[0].text,/附加光度参照/);
  assert.match(requests[0].input[0].content[0].text,/实际响应标定/);
  assert.equal(requests[0].input[0].content[0].text.includes('METERING_INJECTION'),false);
  assert.equal(requests[0].input[0].content.filter(item=>item.type==='input_image').length,2);
  assert.match(requests[0].input[0].content[2].text,/exposure=0.7/);
  assert.doesNotMatch(requests[0].input[0].content[2].text,/TRIAL_INJECTION/);
  assert.equal(requests[0].text.format.schema.properties.recommendations.items.properties.adjustments.properties.exposure.maximum,1.5);
  assert.ok(requests[0].text.format.schema.properties.recommendations.items.properties.adjustments.required.includes('denoise'));
  assert.ok(requests[0].text.format.schema.properties.recommendations.items.properties.adjustments.required.includes('sharpen'));
  assert.deepEqual(Object.keys(returnedAnalysis.observations),['subject','background','light','composition','order','emotion']);
  assert.deepEqual(returnedAnalysis.recommendations[0].observationIds,['light']);
  assert.equal((await (await fetch(base + '/api/status')).json()).connectionStatus,'ready');
  assert.equal(returnedAnalysis.recommendations[0].adjustments.highlights, -18);
  assert.equal(returnedAnalysis.crop.needed, true);
  assert.equal(returnedAnalysis.crop.width, .98);
  assert.equal(returnedAnalysis.styleMatches.length, 3);
  assert.equal(requests[0].model, 'gpt-6-astra');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].input[0].content[1].type, 'input_image');
  assert.equal(requests[0].input[0].content[1].detail, 'high');
  assert.equal(requests[0].text.format.type, 'json_schema');
  assert.equal(requests[0].text.format.strict, true);
  const emotion=requests[0].text.format.schema.properties.observations.properties.emotion;assert.ok(emotion.required.includes('location'));assert.deepEqual(emotion.properties.location.type,['string','null']);
  assert.equal(requests[0].text.format.schema.properties.recommendedStyle.enum.length, 15);
  assert.equal(requests[0].text.format.schema.properties.styleMatches.items.properties.id.enum.length, 14);
  assert.deepEqual(requests[0].text.format.schema.properties.crop.required,['needed','reason','x','y','width','height']);
  assert.match(requests[0].instructions,/边缘干扰、背景杂乱/);
  assert.match(requests[0].instructions, /不凑数量/);
  assert.equal(requests[0].text.format.schema.properties.styleMatches.maxItems,3);
  assert.deepEqual(requests[0].text.format.schema.properties.conclusion.properties.kind.enum,['keep','adjust','uncertain']);
  assert.equal(requests[0].text.format.schema.properties.recommendations.minItems,undefined);

  const assessmentResult = await fetch(`${base}/api/reassess`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({original:'data:image/png;base64,aGVsbG8=',edited:'data:image/png;base64,aGVsbG8=',creativeIntent:'保留清晨的安静',context:{settings:{exposure:.9,saturation:0,instructions:'CONTEXT_INJECTION'},localCount:0},baseline:{metrics:reviewFixture.metrics,evidence:reviewFixture.metricEvidence}})
  });
  assert.equal(assessmentResult.status,200);
  const reassessed=(await assessmentResult.json()).assessment;
  assert.equal(reassessed.after.highlights,79);
  assert.deepEqual(reassessed.before,reviewFixture.metrics);
  assert.equal(reassessed.baselineSource,'original-review');
  assert.match(requests[1].input[0].content[0].text,/实际编辑记录/);
  assert.match(requests[1].input[0].content[0].text,/exposure.*0.9/);
  assert.match(requests[1].input[0].content[0].text,/保持 before/);
  assert.doesNotMatch(requests[1].input[0].content[0].text,/CONTEXT_INJECTION/);
  assert.equal(requests[1].input[0].content.filter(item => item.type === 'input_image').length,2);
  assert.equal(requests[1].store,false);
  assert.match(requests[1].input[0].content[0].text,/保留清晨的安静/);

  const chatResult = await fetch(`${base}/api/design-chat`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:'data:image/png;base64,aGVsbG8=',question:'天空太亮了吗？',history:[{role:'user',text:'想自然一些'},{role:'assistant',text:'先保留晨光'}],context:{creativeIntent:'肤色真实',scene:'山地日出',hasEdits:false,annotations:[{rect:{x:.5,y:.1,width:.2,height:.2},note:'太阳刺眼'}],focusAnnotation:1,tasteProfile:{count:3,leadingMood:'airy'}}})
  });
  assert.equal(chatResult.status,200);
  const chatAnswer = (await chatResult.json()).answer;
  assert.equal(chatAnswer.action.kind,'adjustment');
  assert.deepEqual(chatAnswer.action.changes,[{key:'highlights',value:-12}]);
  assert.equal(requests[2].store,false);
  assert.equal(requests[2].input[0].content[1].type,'input_image');
  assert.match(requests[2].input[0].content[0].text,/想自然一些/);
  assert.match(requests[2].input[0].content[0].text,/太阳刺眼/);
  assert.match(requests[2].input[0].content[0].text,/leadingMood/);
  assert.match(requests[2].instructions,/focusAnnotation/);
  assert.match(requests[2].input[0].content[0].text,/肤色真实/);
  assert.match(requests[2].instructions,/优先于历史/);
  const actionSchema=requests[2].text.format.schema.properties.action;
  assert.ok(actionSchema.anyOf[0].properties.operations);assert.ok(actionSchema.anyOf.at(-1).properties.tradeoff);
  assert.ok(requests[2].text.format.schema.$defs.photoTarget);
  assert.ok(requests[2].text.format.schema.properties.clarification);
  assert.equal(actionSchema.anyOf.at(-1).properties.presetId.enum.length,15);

  const badQuestion = await fetch(`${base}/api/design-chat`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({image:'data:image/png;base64,aGVsbG8=',question:''})
  });
  assert.equal(badQuestion.status,400);

  const jpeg = await readFile(new URL('./fixtures/tiny.jpg', import.meta.url));
  const exportResult = await fetch(`${base}/api/export`, {
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':base},
    body:new URLSearchParams({image:`data:image/jpeg;base64,${jpeg.toString('base64')}`,filename:'测试修片.jpg'})
  });
  assert.equal(exportResult.status, 200);
  assert.match(exportResult.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await exportResult.arrayBuffer()), jpeg);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
  const pngResult = await fetch(`${base}/api/export`, {
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Origin':base},
    body:new URLSearchParams({image:`data:image/png;base64,${png.toString('base64')}`,filename:'测试修片.png'})
  });
  assert.equal(pngResult.status,200);
  assert.equal(pngResult.headers.get('content-type'),'image/png');
  assert.match(pngResult.headers.get('content-disposition'),/\.png/);
  assert.deepEqual(Buffer.from(await pngResult.arrayBuffer()),png);
});

test('local connection route verifies vision, protects config, and surfaces safe review errors',async t => {
  const {mkdtemp,rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const root = await mkdtemp(join(tmpdir(),'guangjian-route-test-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  let mode = 'success';
  const provider = http.createServer(async (request,response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (mode === 'failure') {
      response.writeHead(503,{'Content-Type':'application/json'});
      response.end(JSON.stringify({error:{code:'server_error',message:'private-route-test-key upstream raw error'}}));
      return;
    }
    const isProbe = body.text.format.name === 'vision_connection_probe';
    const value = isProbe ? {shape:'circle',foreground:'red',background:'blue'} : structuredClone(reviewFixture);
    if (mode === 'invalid' && !isProbe) delete value.observations.background;
    if (mode === 'empty' && !isProbe) value.recommendations = [];
    if (mode === 'keep' && !isProbe) Object.assign(value,structuredClone(retentionFixture));
    if (mode === 'contradictory' && !isProbe) value.conclusion.kind = 'keep';
    response.writeHead(200,{'Content-Type':'application/json'});
    response.end(JSON.stringify({id:'mock-route-response',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}));
  });
  const providerPort = await listen(provider);
  t.after(() => close(provider));
  const probe = http.createServer();
  const appPort = await listen(probe);
  await close(probe);
  const app = spawn(process.execPath,[projectDir + 'server.mjs'],{cwd:root,env:{...process.env,PORT:String(appPort),OPENAI_API_KEY:'',OPENAI_MODEL:'test-only-vision',OPENAI_API_URL:`http://127.0.0.1:${providerPort}/v1/responses`},stdio:'ignore'});
  t.after(() => { if (!app.killed) app.kill(); });
  const base = `http://127.0.0.1:${appPort}`;
  for (let attempt=0;attempt<50;attempt++) {
    try { if ((await fetch(base + '/api/status')).ok) break; } catch { /* Wait for this test server only. */ }
    await new Promise(resolve => setTimeout(resolve,30));
  }
  const review = () => fetch(base + '/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'data:image/png;base64,aGVsbG8='})});
  const configure = origin => fetch(base + '/api/vision-config',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({apiKey:'private-route-test-key',model:'test-only-vision',endpoint:`http://127.0.0.1:${providerPort}/v1/responses`,remember:false})});
  const unavailable = await review();
  assert.equal(unavailable.status,503);
  assert.equal((await unavailable.json()).error.code,'AI_NOT_CONFIGURED');
  assert.equal((await configure('https://untrusted.example')).status,403);
  const connected = await configure(base);
  assert.equal(connected.status,200);
  const connectedConfig = await connected.json();
  assert.equal(connectedConfig.connectionStatus,'ready');
  assert.equal(connectedConfig.hasKey,true);
  assert.doesNotMatch(JSON.stringify(connectedConfig),/private-route-test-key/);
  assert.doesNotMatch(await (await fetch(base + '/api/vision-config')).text(),/private-route-test-key/);
  mode = 'invalid';
  const invalid = await review();
  assert.equal(invalid.status,502);
  assert.equal((await invalid.json()).error.code,'INVALID_MODEL_RESPONSE');
  mode = 'failure';
  const failed = await review();
  assert.equal(failed.status,502);
  const failedText = await failed.text();
  assert.match(failedText,/PROVIDER_UNAVAILABLE/);
  assert.doesNotMatch(failedText,/private-route-test-key|upstream raw error/);
  assert.equal((await (await fetch(base + '/api/status')).json()).connectionStatus,'error');
  mode = 'empty';
  const fresh = await review();
  assert.equal(fresh.status,200);
  assert.equal((await fresh.json()).analysis.recommendations.length,0);
  assert.equal((await (await fetch(base + '/api/status')).json()).connectionStatus,'ready');
  mode = 'keep';
  const preserved = await review();
  assert.equal(preserved.status,200);
  const retained = await preserved.json();
  assert.equal(retained.provenance.source,'vision');
  assert.equal(retained.analysis.conclusion.kind,'keep');
  assert.ok(retained.analysis.conclusion.reason.length > 0);
  assert.deepEqual(retained.analysis.recommendations,[]);
  assert.equal(retained.analysis.crop.needed,false);
  assert.deepEqual(retained.analysis.styleMatches,[]);
  assert.equal(retained.analysis.recommendedStyle,'none');
  mode = 'contradictory';
  const contradictory = await review();
  assert.equal(contradictory.status,502);
  const contradiction = await contradictory.json();
  assert.equal(contradiction.error.code,'INCONSISTENT_REVIEW');
  assert.equal(contradiction.error.retryable,true);
  assert.equal(contradiction.analysis,undefined);
});
