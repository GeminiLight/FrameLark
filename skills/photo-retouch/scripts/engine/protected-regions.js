import {viewToOriginalPoint,originalToViewPoint,straightenTransform} from './photo-geometry.js';
import {srgbToLinear, linearToSrgb} from './tone-processing.js';
import {cleanRect, bounded, object, fail} from './edit-values.js';

export const protectionVersion = 'protected-regions-v1';
const smooth = t => t * t * (3 - 2 * t);

// Affine basis preserves a rectangle/ellipse selected on an already rotated view.
// Coordinates belong to the normalized, orientation-corrected ORIGINAL source.
export function protectionMask({rect, coordinateSpace = 'original', maskType = 'rectangle', feather = .08}, crop, source) {
  const r = cleanRect(rect);
  if (!['original', 'view'].includes(coordinateSpace) || !['rectangle', 'radial'].includes(maskType)) fail('INVALID_PROTECTION', '保护支持原片或当前画面坐标中的矩形/径向核心。');
  bounded(feather, 0, .25, 'INVALID_FEATHER');
  const transform = point => coordinateSpace === 'view' ? viewToOriginalPoint(point, crop, source.width, source.height) : point;
  const origin = transform({x:r.x, y:r.y}), right = transform({x:r.x+r.width, y:r.y}), bottom = transform({x:r.x, y:r.y+r.height});
  return validateProtectionMask({origin, axisX:{x:right.x-origin.x,y:right.y-origin.y}, axisY:{x:bottom.x-origin.x,y:bottom.y-origin.y}, type:maskType, feather});
}

export function validateProtectionMask(mask) {
  object(mask, ['origin', 'axisX', 'axisY', 'type', 'feather'], 'INVALID_PROTECTION');
  if (!['rectangle', 'radial'].includes(mask.type)) fail('INVALID_PROTECTION', '未知保护形状。');
  bounded(mask.feather, 0, .25, 'INVALID_PROTECTION');
  for (const key of ['origin','axisX','axisY']) {
    object(mask[key], ['x','y'], 'INVALID_PROTECTION');
    for (const axis of ['x','y']) bounded(mask[key][axis], -2, 2, 'INVALID_PROTECTION');
  }
  const {origin:o,axisX:a,axisY:b} = mask, determinant = a.x*b.y-a.y*b.x;
  if (Math.abs(determinant) < 1e-8) fail('INVALID_PROTECTION', '保护范围太小或退化。');
  for (const [u,v] of [[0,0],[1,0],[0,1],[1,1]]) {
    const x=o.x+a.x*u+b.x*v, y=o.y+a.y*u+b.y*v;
    if (x < -1e-7 || y < -1e-7 || x > 1+1e-7 || y > 1+1e-7) fail('INVALID_PROTECTION', '保护核心必须位于原片内。');
  }
  return structuredClone(mask);
}

export function protectionWeight(mask, point) {
  const {origin:o,axisX:a,axisY:b,feather} = mask, determinant = a.x*b.y-a.y*b.x;
  const x=point.x-o.x,y=point.y-o.y,u=(x*b.y-y*b.x)/determinant,v=(a.x*y-a.y*x)/determinant;
  const distance = mask.type === 'radial' ? Math.hypot(u-.5,v-.5)-.5 : Math.max(-u,u-1,-v,v-1);
  if (distance <= 1e-12) return 1;
  if (!feather || distance >= feather) return 0;
  return 1-smooth(distance/feather);
}

export function protectionBounds(mask) {
  const {origin:o,axisX:a,axisY:b,feather:f}=mask;
  const points=[[-f,-f],[1+f,-f],[-f,1+f],[1+f,1+f]].map(([u,v])=>({x:o.x+a.x*u+b.x*v,y:o.y+a.y*u+b.y*v}));
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}
// Conservative expanded bounds reject ambiguous cross-reference overlap, even if
// their ellipse corners happen to be empty. Same-reference masks use max weight.
export function assertNonOverlappingReferences(regions) {
  for (let i=0;i<regions.length;i++) for (let j=i+1;j<regions.length;j++) {
    if (regions[i].referenceVersionId === regions[j].referenceVersionId) continue;
    const a=protectionBounds(regions[i].mask),b=protectionBounds(regions[j].mask);
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) fail('PROTECTION_OVERLAP', '不同参考版本的保护范围或过渡带重叠。请缩小范围，或先解除原保护。', {regionIds:[regions[i].id,regions[j].id]});
  }
}

// Project conservative feather bounds once. Padding includes boundary pixels
// despite floating-point projection rounding; the exact weight remains authoritative.
function compileMask(mask, width, height, crop, source) {
  const b=protectionBounds(mask),points=[{x:b.left,y:b.top},{x:b.right,y:b.top},{x:b.left,y:b.bottom},{x:b.right,y:b.bottom}].map(p=>originalToViewPoint(p,crop,source.width,source.height));
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))*width)-1),right=Math.min(width,Math.ceil(Math.max(...points.map(p=>p.x))*width)+1);
  const top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))*height)-1),bottom=Math.min(height,Math.ceil(Math.max(...points.map(p=>p.y))*height)+1);
  return {...mask,determinant:mask.axisX.x*mask.axisY.y-mask.axisX.y*mask.axisY.x,left,right,top,bottom};
}
function compiledWeight(mask, px, py) {
  const {origin:o,axisX:a,axisY:b,feather,determinant}=mask;
  // Keep the baseline arithmetic order for byte-identical feather quantization.
  const x=px-o.x,y=py-o.y,u=(x*b.y-y*b.x)/determinant,v=(a.x*y-a.y*x)/determinant;
  const distance=mask.type==='radial'?Math.hypot(u-.5,v-.5)-.5:Math.max(-u,u-1,-v,v-1);
  if(distance<=1e-12)return 1;
  if(!feather||distance>=feather)return 0;
  return 1-smooth(distance/feather);
}

const linear = Float64Array.from({length:256},(_,i)=>srgbToLinear(i/255));
export function compositeProtectedRegions(pixels, width, height, regions, references, crop, source) {
  if (!regions.length) return pixels;
  const output = new Uint8ClampedArray(pixels), groups = new Map();
  for (const r of regions) {
    if (!groups.has(r.referenceVersionId)) groups.set(r.referenceVersionId, []);
    groups.get(r.referenceVersionId).push(compileMask(r.mask,width,height,crop,source));
  }
  const area=crop||{x:0,y:0,width:1,height:1},{c,s,scale}=straightenTransform(source.width,source.height,crop?.angle);
  const W=source.width,H=source.height;
  for (const [id,masks] of groups) {
    const reference = references.get(id);
    if (!reference || reference.length !== output.length) fail('REFERENCE_FRAME_MISMATCH', '保护参考图与当前输出尺寸不一致。');
    const left=Math.min(...masks.map(m=>m.left)),right=Math.max(...masks.map(m=>m.right)),top=Math.min(...masks.map(m=>m.top)),bottom=Math.max(...masks.map(m=>m.bottom));
    for (let y=top;y<bottom;y++) for (let x=left;x<right;x++) {
      const tx=(area.x+(x+.5)/width*area.width-.5)*W/scale,ty=(area.y+(y+.5)/height*area.height-.5)*H/scale;
      const px=.5+(c*tx+s*ty)/W,py=.5+(-s*tx+c*ty)/H;
      let weight=0;
      for(const mask of masks){
        if(x<mask.left||x>=mask.right||y<mask.top||y>=mask.bottom)continue;
        weight=Math.max(weight,compiledWeight(mask,px,py));
        if(weight===1)break;
      }
      if (!weight) continue;
      const at=(y*width+x)*4;
      if (weight === 1) { output[at]=reference[at];output[at+1]=reference[at+1];output[at+2]=reference[at+2];output[at+3]=reference[at+3];continue; }
      // Premultiplied alpha in linear light. Endpoint bytes never pass through
      // conversion/quantization, so the protected core is byte-exact.
      const ra=reference[at+3]/255,na=output[at+3]/255,alpha=ra*weight+na*(1-weight);
      for (let c=0;c<3;c++) output[at+c]=alpha ? linearToSrgb((linear[reference[at+c]]*ra*weight+linear[output[at+c]]*na*(1-weight))/alpha)*255 : 0;
      output[at+3]=alpha*255;
    }
  }
  return output;
}
