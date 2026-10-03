import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export class CodexError extends Error {
  constructor(code,message,{status=502,retryable=false}={}) {super(message);Object.assign(this,{code,status,retryable});}
}
export function codexFailure(message='') {
  if(/not logged|log in|login|unauthorized|401|authentication/i.test(message))return new CodexError('CODEX_LOGIN_REQUIRED','请先运行 codex login，使用 ChatGPT 登录。',{status:401});
  if(/quota|usage limit|rate limit|429/i.test(message))return new CodexError('CODEX_LIMIT','Codex 使用额度不足或请求过于频繁，请稍后重试。',{status:429,retryable:true});
  if(/model.*(not found|not supported|unavailable)|access.*model/i.test(message))return new CodexError('MODEL_NOT_FOUND','当前账户无法使用所选模型，请在设置中选择其他模型。',{status:422});
  return new CodexError('CODEX_FAILED','Codex 未能完成请求，请重试或检查本机登录状态。',{retryable:true});
}

// Keep the protocol private to the Node process: no unauthenticated RPC listener.
export class CodexAppServer {
  constructor({root=process.cwd(),spawnImpl=spawn,command='codex',args=null,rpcTimeout=30000}={}) {
    this.root=resolve(root,'.guangjian');this.cwd=resolve(this.root,'codex-workspace');
    this.sessionsFile=resolve(this.root,'codex-sessions.json');
    this.spawnImpl=spawnImpl;this.command=command;this.args=args;this.rpcTimeout=rpcTimeout;
    this.busySessions=new Set();this.pending=new Map();this.active=new Map();this.sessions=new Map();this.loaded=new Set();
    this.nextId=1;this.child=null;this.starting=null;this.generation=0;this.closing=Promise.resolve();this.closedChildren=new WeakSet();this.writeQueue=Promise.resolve();
  }
  async start() {
    if(this.starting)return this.starting;
    const generation=++this.generation;
    this.starting=this.initialize(generation).catch(error=>{if(this.generation===generation)this.stop(error);throw error;});
    return this.starting;
  }
  async initialize(generation) {
    const current=()=>{if(this.generation!==generation)throw new CodexError('CODEX_OFFLINE','Codex 连接已重置，请重试。',{retryable:true});};
    await this.closing;
    current();
    await mkdir(this.cwd,{recursive:true,mode:0o700});
    current();
    try {
      const saved=JSON.parse(await readFile(this.sessionsFile,'utf8'));
      current();
      for(const [key,value] of Object.entries(saved))if(/^[a-f0-9]{64}$/.test(key)&&typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value))this.sessions.set(key,value);
    }catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
    current();
    const disabled=['shell_tool','view_image','sleep_tool','tool_suggest','multi_agent','apps','plugins','hooks','memories','browser_use','computer_use','image_generation','code_mode','code_mode_host','skill_search'];
    const args=this.args || ['app-server','--listen','stdio://',...disabled.flatMap(name=>['--disable',name]),
      '-c','mcp_servers={}','-c','web_search="disabled"','-c','project_doc_max_bytes=0','-c','model_provider="openai"','-c','forced_login_method="chatgpt"'];
    const env={...process.env};delete env.CODEX_API_KEY;delete env.OPENAI_API_KEY;delete env.CODEX_THREAD_ID;
    const child=this.spawnImpl(this.command,args,{cwd:this.cwd,env,stdio:['pipe','pipe','pipe']});
    this.child=child;
    let diagnostic='';
    child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-8000);});
    child.stdin.on('error',()=>{});
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(this.child!==child)return;
      if(line.length>16_000_000){this.stop(new CodexError('CODEX_PROTOCOL','Codex 返回的数据过大。'));return;}
      try{this.receive(JSON.parse(line));}catch{/* Non-protocol diagnostics must never reach the browser. */}
    });
    child.once('error',error=>{if(this.child===child)this.stop(error.code==='ENOENT'?new CodexError('CODEX_NOT_FOUND','本机未找到 codex，请先安装 Codex CLI。',{status:503}):codexFailure(error.message));});
    child.once('close',()=>{
      this.closedChildren.add(child);
      lines.close();
      if(this.child!==child)return;
      this.stop(codexFailure(diagnostic));
    });
    await this.rpc('initialize',{clientInfo:{name:'frameyn',title:'Frameyn photo workspace',version:'0.3.0'}});
    current();
    this.send({method:'initialized',params:{}});
    // A user-level MCP configuration may be merged by Codex. Disable every discovered
    // server before creating threads; never expose those names or credentials to UI.
    const config=await this.rpc('config/read',{includeLayers:false});
    current();
    this.disabledMcp=Object.keys(config.config?.mcp_servers || {}).reduce((result,name)=>({...result,[`mcp_servers.${name}.enabled`]:false}),{});
  }
  send(message) {if(!this.child?.stdin?.writable)throw new CodexError('CODEX_OFFLINE','Codex 连接已断开，请重试。',{status:503,retryable:true});this.child.stdin.write(JSON.stringify(message)+'\n');}
  rpc(method,params={}) {
    return new Promise((resolve,reject)=>{
      const id=this.nextId++,timer=setTimeout(()=>{this.pending.delete(id);reject(new CodexError('CODEX_TIMEOUT','Codex 连接等待超时，请重试。',{retryable:true}));},this.rpcTimeout);
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  receive(message) {
    if(message.id!==undefined && !message.method) {
      const pending=this.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      message.error ? pending.reject(codexFailure(message.error.message)):pending.resolve(message.result);return;
    }
    // This integration only asks for structured photographic advice. It never grants
    // filesystem/tool approvals or executes dynamic tools requested by the model.
    if(message.id!==undefined) {this.send({id:message.id,error:{code:-32601,message:'Tools and approvals are unavailable in the photo advisor.'}});return;}
    const p=message.params || {},task=this.active.get(p.threadId);if(!task)return;
    const eventTurn=p.turnId || p.turn?.id;
    if(task.turnId && eventTurn && task.turnId!==eventTurn)return;
    if(eventTurn)task.turnId=eventTurn;
    if(message.method==='turn/started')task.emit({type:'progress',stage:'analyzing'});
    if(message.method==='item/agentMessage/delta') {
      task.text+=p.delta || '';
      if(task.text.length>200000){task.failure=new CodexError('INVALID_MODEL_RESPONSE','模型回复过长，请缩小问题后重试。');this.interrupt(p.threadId,task);return;}
      task.emit({type:'delta',delta:p.delta || ''});
    }
    if(message.method==='item/completed' && p.item?.type==='agentMessage' && p.item.phase!=='commentary')task.final=p.item.text;
    if(message.method==='turn/completed') {
      if(task.failure){task.reject(task.failure);return;}
      if(p.turn.status!=='completed'){task.reject(task.cancelled?new CodexError('CANCELLED','本次回复已取消。',{status:499}):codexFailure(p.turn.error?.message));return;}
      const final=p.turn.items?.filter(item=>item.type==='agentMessage'&&item.phase!=='commentary').at(-1)?.text || task.final || task.text;
      task.resolve({status:'completed',output_text:final,model:task.model,id:p.turn.id,threadId:p.threadId});
    }
  }
  failAll(error) {
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
    for(const task of this.active.values())task.reject(error);
  }
  stop(error=new CodexError('CODEX_OFFLINE','Codex 连接已关闭。',{retryable:true})) {
    const child=this.child;this.child=null;this.starting=null;this.generation++;this.loaded.clear();this.failAll(error);
    if(!child||this.closedChildren.has(child))return;
    this.closing=new Promise((resolve,reject)=>{
      let timer;const closed=()=>{clearTimeout(timer);resolve();};child.once('close',closed);
      timer=setTimeout(()=>{
        child.kill('SIGKILL');
        timer=setTimeout(()=>reject(new CodexError('CODEX_STOP_FAILED','旧 Codex 进程尚未退出，请重启本机工作台。',{status:503})),1000);timer.unref?.();
      },1500);timer.unref?.();child.kill('SIGTERM');
    });
    // stop() is also called during shutdown; startup still observes any failure.
    this.closing.catch(()=>{});
  }
  async info() {
    await this.start();
    const account=await this.rpc('account/read',{refreshToken:false});
    const models=[];let cursor=null;
    do {
      const page=await this.rpc('model/list',{cursor,limit:100});
      models.push(...(page.data || []).filter(item=>!item.hidden && (!item.inputModalities || item.inputModalities.includes('image'))).map(item=>({id:item.model,name:item.displayName,efforts:item.supportedReasoningEfforts.map(e=>e.reasoningEffort)})));
      cursor=page.nextCursor;
    }while(cursor && models.length<500);
    return {installed:true,authenticated:account.account?.type==='chatgpt',authType:account.account?.type || null,models};
  }
  async persistSessions() {
    const snapshot=JSON.stringify(Object.fromEntries(this.sessions));
    this.writeQueue=this.writeQueue.catch(()=>{}).then(async()=>{
      const temporary=this.sessionsFile+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,snapshot,{mode:0o600});await rename(temporary,this.sessionsFile);
    });
    return this.writeQueue;
  }
  interrupt(threadId,task) {
    if(task.interrupting)return;task.cancelled=true;
    if(!task.turnId){this.stop(new CodexError('CANCELLED','本次回复已取消。',{status:499}));return;}
    task.interrupting=true;
    this.rpc('turn/interrupt',{threadId,turnId:task.turnId}).catch(()=>{});
    task.cancelTimer=setTimeout(()=>{task.reject(task.failure||new CodexError('CANCELLED','本次回复已取消。',{status:499}));this.stop();},5000);
  }
  async request(payload,options={}) {
    const key=options.sessionKey;
    if(key&&this.busySessions.has(key))throw new CodexError('CODEX_BUSY','这张照片仍在回复中，请先等待或停止本次回复。',{status:409,retryable:true});
    if(key)this.busySessions.add(key);
    try{return await this.runRequest(payload,options);}finally{if(key)this.busySessions.delete(key);}
  }
  async runRequest(payload,{model,effort='low',signal,sessionKey,onEvent=()=>{}}={}) {
    if(signal?.aborted)throw new CodexError('CANCELLED','本次回复已取消。',{status:499});
    onEvent({type:'progress',stage:'connecting',model});
    await this.start();
    const generation=this.generation,current=()=>{if(this.generation!==generation)throw new CodexError('CODEX_OFFLINE','Codex 连接已重置，请重试。',{retryable:true});};
    const key=sessionKey?createHash('sha256').update(sessionKey).digest('hex'):null;
    let threadId=key && this.sessions.get(key);
    const settings={model,cwd:this.cwd,sandbox:'read-only',approvalPolicy:'never',modelProvider:'openai',environments:[],
      developerInstructions:payload.instructions,config:{...this.disabledMcp,'web_search':'disabled'}};
    if(threadId && !this.loaded.has(threadId)) {
      try{await this.rpc('thread/resume',{...settings,threadId,excludeTurns:true});}
      catch(error){throw new CodexError('CODEX_RESUME_FAILED','这张照片的 Codex 会话暂时无法恢复，请重试。',{retryable:true});}
      current();
      this.loaded.add(threadId);
    }
    if(!threadId) {
      const started=await this.rpc('thread/start',{...settings,ephemeral:!key});current();threadId=started.thread.id;this.loaded.add(threadId);
      if(key){this.sessions.set(key,threadId);await this.persistSessions();}
    }
    current();
    if(this.active.has(threadId))throw new CodexError('CODEX_BUSY','这张照片仍在回复中，请先等待或停止本次回复。',{status:409,retryable:true});
    if(signal?.aborted)throw new CodexError('CANCELLED','本次回复已取消。',{status:499});
    const input=[];
    for(const item of payload.input || [])for(const block of item.content || []) {
      if(block.type==='input_text')input.push({type:'text',text:block.text});
      else if(block.type==='input_image' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(block.image_url || '') && block.image_url.length<16_000_000)input.push({type:'image',url:block.image_url});
      else throw new CodexError('INVALID_REQUEST','图片请求格式不受支持。',{status:400});
    }
    // Send current constraints each turn, including after switching models or resuming.
    input.unshift({type:'text',text:payload.instructions+'\n仅根据当前图片和最新编辑状态回答。历史建议可能已被撤回。只返回指定 JSON，不使用工具。'});
    return new Promise((resolve,reject)=>{
      const finish=(error,result)=>{
        if(this.active.get(threadId)!==task)return;
        clearTimeout(task.cancelTimer);signal?.removeEventListener('abort',cancel);this.active.delete(threadId);
        if(!key){this.loaded.delete(threadId);this.rpc('thread/unsubscribe',{threadId}).catch(()=>{});}
        error?reject(error):resolve(result);
      };
      const task={model,text:'',final:'',turnId:null,emit:onEvent,resolve:value=>finish(null,value),reject:error=>finish(error)};
      const cancel=()=>this.interrupt(threadId,task);
      this.active.set(threadId,task);signal?.addEventListener('abort',cancel,{once:true});
      onEvent({type:'progress',stage:'analyzing',model,threadId});
      this.rpc('turn/start',{threadId,input,model,effort,environments:[],outputSchema:payload.text.format.schema,approvalPolicy:'never',sandboxPolicy:{type:'readOnly',networkAccess:false}})
        .then(result=>{if(this.active.get(threadId)!==task)return;task.turnId=result.turn.id;if(signal?.aborted)this.interrupt(threadId,task);})
        .catch(error=>{
          if(this.active.get(threadId)!==task)return;
          // A timed-out start may already be running upstream. Retire this transport
          // before releasing the photo; late messages must never reach its retry.
          if(error.code==='CODEX_TIMEOUT'&&task.turnId){task.failure=error;this.interrupt(threadId,task);}
          else if(error.code==='CODEX_TIMEOUT')this.stop(error);
          else task.reject(error);
        });
    });
  }
}
