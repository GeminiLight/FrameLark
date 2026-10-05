export class PhotoToolError extends Error {
  constructor(code,message,details){super(message);this.code=code;if(details)this.details=details;}
}
export const fail=(code,message,details)=>{throw new PhotoToolError(code,message,details);};
export const record=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
export const number=(minimum,maximum)=>({type:'number',minimum,maximum});
export const text=(maxLength=120)=>({type:'string',maxLength});
export const identifier={type:'string',minLength:1,maxLength:80,pattern:'^[-a-zA-Z0-9_]+$'};
export const point=record({x:number(0,1),y:number(0,1)});
export const rect=record({x:number(0,1),y:number(0,1),width:number(.005,1),height:number(.005,1)});
// This is the tool execution validator, independent of a provider's JSON mode.
export function validate(value,schema,path='$'){
  if(schema.anyOf){if(!schema.anyOf.some(s=>{try{validate(value,s,path);return true;}catch{return false;}}))fail('TOOL_INPUT_INVALID',`工具输入格式无效：${path}`);return;}
  const type=value===null?'null':Array.isArray(value)?'array':typeof value;
  if(!([schema.type].flat().includes(type)||schema.type==='integer'&&type==='number'&&Number.isInteger(value)))fail('TOOL_INPUT_INVALID',`工具输入类型无效：${path}`);
  if(schema.enum&&!schema.enum.includes(value))fail('TOOL_INPUT_INVALID',`工具输入值无效：${path}`);
  if(type==='number'&&(!Number.isFinite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))fail('TOOL_PARAMETER_RANGE',`工具参数超出范围：${path}`);
  if(type==='string'&&(value.length>(schema.maxLength??4000)||value.length<(schema.minLength??0)||schema.pattern&&!new RegExp(schema.pattern).test(value)))fail('TOOL_INPUT_INVALID',`工具文本无效：${path}`);
  if(type==='array'){
    if(value.length>(schema.maxItems??32)||value.length<(schema.minItems??0)||schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)fail('TOOL_INPUT_INVALID',`工具列表无效：${path}`);
    value.forEach((v,i)=>validate(v,schema.items,`${path}[${i}]`));
  }
  if(type==='object'){
    if((schema.required||[]).some(k=>!Object.hasOwn(value,k))||schema.additionalProperties===false&&Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k)))fail('TOOL_INPUT_INVALID',`工具字段无效：${path}`);
    for(const [k,v] of Object.entries(value))if(schema.properties?.[k])validate(v,schema.properties[k],`${path}.${k}`);
  }
}
export function cleanRect(r){validate(r,rect);if(r.x+r.width>1.00001||r.y+r.height>1.00001)fail('TOOL_TARGET_OUTSIDE','工具范围超出照片。');return structuredClone(r);}
