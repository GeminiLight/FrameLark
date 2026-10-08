const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const text={type:'string',minLength:1,maxLength:120};
const record=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
export const policyProvenanceSchema=record({version:text,task:{type:'string',enum:['diagnosis','plan','audit']},coreHash:hash,bundleHash:hash,references:{type:'array',minItems:1,maxItems:4,items:record({id:text,path:text,hash})}});
export const generatedBySchema=record({kind:{type:'string',enum:['user','agent']},model:text,effort:text},['kind']);
