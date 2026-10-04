import assert from 'node:assert/strict';

// Fixed model responses isolate UI behavior; the tool route and renderer are real.
export async function checkPhotoToolUI({browser,evaluate,visible,frame}) {
  await browser('set','viewport','1280','577');
  await browser('click','#panel-agent');
  await evaluate(`(()=>{
    const original=window.fetch.bind(window);
    const models=[{id:'qa-limited',name:'QA limited',efforts:['low','medium']},{id:'qa-complete',name:'QA complete',efforts:['low','medium','high','ultra']}];
    const tiers={fast:{model:'qa-limited',effort:'low'},standard:{model:'qa-limited',effort:'high'},deep:{model:'qa-complete',effort:'ultra'}};
    const mask={kind:'region',coordinateSpace:'view',mask:{shape:'rectangle',rect:{x:.1,y:.1,width:.7,height:.7},feather:.2,exclude:[{x:.3,y:.3,width:.2,height:.2}]}};
    const op=(id,title,tool,target,parameters,dependsOn=[])=>({id,title,tool,version:1,target,parameters,dependsOn});
    const operations=[op('select','前景范围','mask',mask,{}),op('light','提亮前景','tone',{kind:'output',operationId:'select'},{mode:'delta',changes:[{key:'exposure',value:.2}]},['select']),op('rotate','轻微扶正','rotate',{kind:'image'},{angle:1})];
    const json=value=>Promise.resolve(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));
    window.fetch=(input,init)=>{
      if(String(input)==='/api/codex-status')return json({authenticated:true,models});
      if(String(input)==='/api/vision-config')return json({configurationEditable:true,provider:'codex',model:'qa-limited',tiers,aiAvailable:true,connectionStatus:'ready',endpoint:'https://api.openai.com/v1',hasKey:false});
      if(String(input)==='/api/design-chat')return json({answer:{reply:'先提亮前景，保留光源，再轻微扶正。比较后应用。',principle:'保留亮部',clarification:{question:'',choices:[]},action:{kind:'tools',label:'前景与扶正',goal:'看清前景',tradeoff:'保留光源',operations}}});
      return original(input,init);
    };return JSON.stringify(true);
  })()`);
  await browser('click','#agent-mode');
  await browser('wait','--fn','document.querySelector("#codex-use").hidden===false');
  const effort=tier=>evaluate(`JSON.stringify({value:document.querySelector('#tier-${tier}-effort').value,choices:[...document.querySelector('#tier-${tier}-effort').options].filter(o=>!o.disabled).map(o=>o.value)})`);
  assert.deepEqual(await effort('standard'),{value:'medium',choices:['low','medium']},'Saved unsupported effort falls back to an available effort');
  assert.equal((await effort('deep')).value,'ultra','Supported saved extended effort is retained');
  await browser('select','#tier-standard-choice','qa-complete');
  assert.ok((await effort('standard')).choices.includes('ultra'));
  await browser('select','#tier-standard-choice','qa-limited');
  await browser('select','#vision-provider','api');
  assert.ok((await effort('standard')).choices.includes('high'),'API choices do not inherit Codex restrictions');
  await browser('select','#vision-provider','codex');
  await browser('click','#vision-settings-connect');
  await browser('wait','--fn','!document.querySelector("#vision-settings-dialog").open');
  const before=await frame();
  await browser('fill','#agent-input','提亮前景，保留光源，轻微扶正');
  await browser('click','#agent-form button[type=submit]');
  await browser('wait','--fn','document.querySelector("#advisor-preview-dialog").open&&!document.querySelector("#advisor-preview-accept").disabled');
  for(const [w,h,density] of [[1280,577,2],[390,844,1],[320,720,1]]){
    await browser('set','viewport',String(w),String(h),String(density));
    await browser('click','#advisor-preview-fit');
    await browser('wait','--fn','!document.querySelector("#advisor-preview-accept").disabled');
    for(const id of ['#advisor-preview-cancel','#advisor-preview-accept'])assert.equal(await evaluate(visible(id)),true,id+' visible at '+w+' × '+h);
    assert.equal(await evaluate('JSON.stringify(document.documentElement.scrollWidth>innerWidth)'),false);
    assert.equal(await evaluate('JSON.stringify([...document.querySelectorAll("#advisor-preview-dialog canvas")].every(c=>c.width===Math.round(c.clientWidth*devicePixelRatio)&&c.height===Math.round(c.clientHeight*devicePixelRatio)))'),true,'Comparison renders at display pixel density');
  }
  await browser('set','viewport','1280','577');
  await browser('uncheck','[data-operation-id="select"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("[data-operation-id=light]").checked)'),false,'Dependent step is deselected');
  await browser('wait','--fn','!document.querySelector("#advisor-preview-accept").disabled');
  await browser('uncheck','[data-operation-id="rotate"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#advisor-preview-accept").disabled)'),true,'Empty selection cannot apply');
  await browser('check','[data-operation-id="light"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("[data-operation-id=select]").checked)'),true,'Selecting a dependent step includes its prerequisite');
  await browser('wait','--fn','!document.querySelector("#advisor-preview-accept").disabled');
  await browser('click','#advisor-mask-toggle');
  await browser('wait','--fn','!document.querySelector("#advisor-preview-accept").disabled');
  await browser('click','#advisor-preview-cancel');
  assert.deepEqual(await frame(),before,'Preview and cancellation preserve current pixels and parameters');
  await browser('click','#photo-proposal-preview');
  await browser('wait','--fn','!document.querySelector("#advisor-preview-accept").disabled');
  await browser('click','#advisor-preview-accept');
  await browser('wait','--fn','!document.querySelector("#advisor-preview-dialog").open&&!document.querySelector("#export-button").disabled');
  assert.notEqual((await frame()).hash,before.hash,'Applying the real tool result changes the rendered photo');
  await browser('focus','#panel-adjust');
  await browser('press','Control+z');
  await browser('wait','--fn','!document.querySelector("#export-button").disabled');
  assert.deepEqual(await frame(),before,'Undo restores pixels and parameters');
  console.log('Photo tool UI passed: model effort discovery/provider switching, three viewport sizes, dependencies, empty selection, mask preview, cancel, apply and undo.');
}
