import {normalizeMask} from '../photo-tools/targets.js';
import {maskWeight} from '../local-masks.js';
import {viewToOriginalPoint} from '../photo-geometry.js';
import {object,identifier,number,hashValue,fail} from './values.js';
const key=ref=>ref.id+'@'+ref.version;
export function validateMaskRef(ref){object(ref,['id','version']);identifier(ref.id);if(!Number.isInteger(ref.version)||ref.version<1||ref.version>10000)fail('INVALID_DOCUMENT','蒙版版本无效。');return ref;}
export function validateExpression(expression,depth=0){
  if(depth>=8)fail('MASK_DEPTH_EXCEEDED','蒙版组合超过 8 层，请简化范围。');
  if(!expression||typeof expression!=='object')fail('INVALID_DOCUMENT','蒙版表达式无效。');
  switch(expression.kind){
    case 'constant':object(expression,['kind','value']);number(expression.value,0,1);break;
    case 'luminance':object(expression,['kind','mode','start','end']);if(!['include-highlights','exclude-highlights','range'].includes(expression.mode))fail('INVALID_DOCUMENT','明度范围模式无效。');number(expression.start,0,1);number(expression.end,0,1);if(expression.end<=expression.start)fail('INVALID_DOCUMENT','明度范围的结束必须大于开始。');break;
    case 'drawn':{
      object(expression,['kind','mask','basis'],['kind','mask']);normalizeMask(expression.mask);
      if(expression.basis){object(expression.basis,['origin','xAxis','yAxis']);for(const value of Object.values(expression.basis)){object(value,['x','y']);number(value.x,-2,2);number(value.y,-2,2);}const {xAxis:x,yAxis:y}=expression.basis;if(Math.abs(x.x*y.y-x.y*y.x)<1e-8)fail('INVALID_DOCUMENT','蒙版坐标变换不可逆。');}break;
    }
    case 'reference':object(expression,['kind','id','version']);validateMaskRef({id:expression.id,version:expression.version});break;
    case 'invert':object(expression,['kind','input']);validateExpression(expression.input,depth+1);break;
    case 'union':case 'subtract':case 'intersect':object(expression,['kind','a','b']);validateExpression(expression.a,depth+1);validateExpression(expression.b,depth+1);break;
    default:fail('INVALID_DOCUMENT','不支持这种蒙版范围。');
  }
  return expression;
}
export function validateMasks(masks,source){
  if(!Array.isArray(masks)||masks.length>256)fail('MASK_LIMIT','蒙版版本超过保存上限。');const records=new Map();
  for(const mask of masks){object(mask,['id','version','expression','reference','provenance'],['id','version','expression','reference']);validateMaskRef({id:mask.id,version:mask.version});validateExpression(mask.expression);object(mask.reference,['kind','sourceHash'],mask.reference.kind==='frozen-source'?['kind','sourceHash']:['kind']);if(!['live-input','frozen-source'].includes(mask.reference.kind))fail('MASK_REFERENCE_MISSING','尚不支持这个冻结参考。');if(mask.reference.kind==='frozen-source'){hashValue(mask.reference.sourceHash);if(mask.reference.sourceHash!==source.contentHash)fail('SOURCE_CHANGED','冻结蒙版的原片身份不一致。');}if(mask.provenance!==undefined){object(mask.provenance,['name','source','confidence','annotationId'],[]);if(JSON.stringify(mask.provenance).length>600)fail('INVALID_DOCUMENT','蒙版来源说明过长。');}if(records.has(key(mask)))fail('INVALID_DOCUMENT','蒙版编号和版本重复。');records.set(key(mask),mask);}
  function walk(expr,seen=[],depth=0){if(depth>=8)fail('MASK_DEPTH_EXCEEDED','蒙版引用嵌套过深。');if(expr.kind==='reference'){const id=key(expr),record=records.get(id);if(!record)fail('MASK_REFERENCE_MISSING','引用的蒙版版本已丢失。');if(seen.includes(id))fail('DEPENDENCY_CYCLE','蒙版引用形成循环。');walk(record.expression,[...seen,id],depth+1);}else if(expr.kind==='invert')walk(expr.input,seen,depth+1);else if(expr.a){walk(expr.a,seen,depth+1);walk(expr.b,seen,depth+1);}}
  masks.forEach(mask=>walk(mask.expression,[key(mask)]));return records;
}
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export function maskSampler(document,ref,input,original,{width,height,frame,crop}){
  const records=new Map(document.masks.map(mask=>[key(mask),mask])),root=records.get(key(ref));if(!root)fail('MASK_REFERENCE_MISSING','步骤的蒙版版本已丢失。');
  const world=(x,y)=>viewToOriginalPoint({x:(x+.5)/width,y:(y+.5)/height},crop,frame.fullWidth,frame.fullHeight);
  function build(record){const pixels=record.reference.kind==='frozen-source'?original:input;
    function expression(expr){
      if(expr.kind==='constant')return ()=>expr.value;
      if(expr.kind==='reference')return build(records.get(key(expr)));
      if(expr.kind==='luminance')return (_x,_y,index)=>{const value=.2126*pixels[index]+.7152*pixels[index+1]+.0722*pixels[index+2];if(expr.mode==='range')return smooth(expr.start-.02,expr.start,value)*(1-smooth(expr.end,expr.end+.02,value));const coverage=smooth(expr.start,expr.end,value);return expr.mode==='exclude-highlights'?1-coverage:coverage;};
      if(expr.kind==='drawn'){
        const m=expr.mask,layer={maskType:m.shape,rect:m.rect,feather:m.feather,exclude:m.exclude,start:m.start,end:m.end,points:m.points,brushRadius:m.radius};
        return (x,y)=>{let p=world(x,y);if(expr.basis){const {origin:o,xAxis:a,yAxis:b}=expr.basis,dx=p.x-o.x,dy=p.y-o.y,det=a.x*b.y-a.y*b.x;p={x:(dx*b.y-dy*b.x)/det,y:(dy*a.x-dx*a.y)/det};}return maskWeight(layer,p,frame.fullWidth,frame.fullHeight);};
      }
      if(expr.kind==='invert'){const f=expression(expr.input);return (x,y,i)=>1-f(x,y,i);}
      const a=expression(expr.a),b=expression(expr.b);return (x,y,i)=>{const A=a(x,y,i),B=b(x,y,i);return expr.kind==='union'?Math.max(A,B):expr.kind==='intersect'?A*B:A*(1-B);};
    }
    return expression(record.expression);
  }
  return build(root);
}
