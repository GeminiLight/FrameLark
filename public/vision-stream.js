import {readServiceJSON} from './service-response.js';

// Only the reply string is shown while streaming. No partial action is executable.
export function partialReply(json) {
  const match=/"reply"\s*:\s*"/.exec(json);if(!match)return '';
  const start=match.index+match[0].length;let escaped=false;
  for(let i=start;i<json.length;i++) {
    if(!escaped && json[i]==='"'){try{return JSON.parse('"'+json.slice(start,i)+'"').slice(0,700);}catch{return '';}}
    if(!escaped && json[i]==='\\')escaped=true;else escaped=false;
  }
  let fragment=json.slice(start);if(escaped)fragment=fragment.slice(0,-1);
  fragment=fragment.replace(/\\u[0-9a-f]{0,3}$/i,'');
  try{return JSON.parse('"'+fragment+'"').slice(0,700);}catch{return '';}
}

export async function readVisionStream(response,onEvent=()=>{}) {
  if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return readServiceJSON(response,'视觉对话');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result,failed,total=0;
  const consume=line=>{
    if(!line.trim())return;
    const event=JSON.parse(line);
    if(event.type==='result')result=event.value;
    else if(event.type==='error')failed=event.error;
    else onEvent(event);
  };
  try {
    while(true){
      const {value,done}=await reader.read();if(done)break;
      total+=value.length;if(total>1_000_000)throw new Error('回复数据过大，请重试。');
      buffer+=decoder.decode(value,{stream:true});let end;
      while((end=buffer.indexOf('\n'))!==-1){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())consume(buffer);
    if(failed)throw Object.assign(new Error(failed.message),{visionFailure:failed});
    if(!result)throw new Error('回复中断，尚未生成可应用的建议，请重试。');
    return result;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
