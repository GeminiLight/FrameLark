import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const turns=new Map(),send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const log=process.argv[2];
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(log)appendFileSync(log,JSON.stringify(m)+'\n');
  if(!m.method)return;
  const p=m.params || {},result=value=>send({id:m.id,result:value});
  if(m.method==='initialize')return result({});
  if(m.method==='initialized')return;
  if(m.method==='config/read')return result({config:{mcp_servers:{unrelated:{enabled:true}}}});
  if(m.method==='account/read')return result({account:{type:'chatgpt',email:'private@example.test'},requiresOpenaiAuth:true});
  if(m.method==='model/list')return result({data:[{model:'gpt-6.1-sol',displayName:'Sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}],inputModalities:['image'],hidden:false}]});
  if(m.method==='thread/start')return result({thread:{id:randomUUID()},model:p.model});
  if(m.method==='thread/resume')return result({thread:{id:p.threadId}});
  if(m.method==='thread/unsubscribe')return result({});
  if(m.method==='turn/interrupt'){
    clearTimeout(turns.get(p.turnId));result({});
    return send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted',items:[]}}});
  }
  if(m.method==='turn/start'){
    const id=randomUUID(),text=p.input.filter(i=>i.type==='text').map(i=>i.text).join(' ');
    if(text.includes('crash-fixture'))return process.exit(2);
    if(text.includes('quota-fixture'))return send({id:m.id,error:{message:'usage limit reached SECRET'}});
    send({method:'turn/started',params:{threadId:p.threadId,turn:{id,status:'inProgress',items:[]}}});
    result({turn:{id,status:'inProgress',items:[]}});
    const final=JSON.stringify({reply:text.includes('oversize-fixture')?'x'.repeat(200001):'人物在左边，可以保留原片。'});
    const timer=setTimeout(()=>{
      send({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:id,itemId:'reply',delta:final.slice(0,16)}});
      send({method:'item/agentMessage/delta',params:{threadId:p.threadId,turnId:id,itemId:'reply',delta:final.slice(16)}});
      send({method:'item/completed',params:{threadId:p.threadId,turnId:id,item:{id:'reply',type:'agentMessage',text:final,phase:'final_answer'}}});
      send({method:'turn/completed',params:{threadId:p.threadId,turn:{id,status:'completed',items:[]}}});
    },text.includes('slow-fixture')?30000:15);turns.set(id,timer);
  }
});
