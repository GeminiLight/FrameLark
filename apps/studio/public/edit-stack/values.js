export class StackError extends Error {constructor(code,message,details){super(message);this.name='StackError';this.code=code;if(details)this.details=details;}}
export function fail(code,message,details){throw new StackError(code,message,details);}
export function object(value,keys,required=keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('INVALID_DOCUMENT','编辑文档包含未知字段或缺少必要数据。');return value;}
export function number(value,min,max){if(!Number.isFinite(value)||value<min||value>max)fail('INVALID_DOCUMENT','编辑数值超出范围。');return value;}
export function identifier(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(value))fail('INVALID_DOCUMENT','编辑步骤或资源编号无效。');return value;}
export function title(value,max=120){if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_DOCUMENT','请提供简短且有效的编辑名称。');return value;}
export function hashValue(value){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))fail('INVALID_DOCUMENT','图像或文档身份无效。');return value;}
export function ids(values,max=64){if(!Array.isArray(values)||values.length>max||new Set(values).size!==values.length)fail('INVALID_DOCUMENT','编辑编号重复或数量超出限制。');values.forEach(identifier);return values;}
export function bool(value){if(typeof value!=='boolean')fail('INVALID_DOCUMENT','编辑开关必须为布尔值。');return value;}

// Derived display names reserve affixes within the same validated title limit.
export function derivedTitle(value,{prefix="",suffix=""}={}){title(value);const room=120-prefix.length-suffix.length;if(room<1)fail("INVALID_DOCUMENT","编辑名称的前后缀过长。");return title(prefix+value.slice(0,room).replace(/[\uD800-\uDBFF]$/,"")+suffix);}
