import {viewToOriginalPoint} from './photo-geometry.js';
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

const linear = Float64Array.from({length:256},(_,i)=>srgbToLinear(i/255));
export function compositeProtectedRegions(pixels, width, height, regions, references, crop, source) {
  if (!regions.length) return pixels;
  const output = new Uint8ClampedArray(pixels), groups = new Map();
  for (const r of regions) {
    if (!groups.has(r.referenceVersionId)) groups.set(r.referenceVersionId, []);
    groups.get(r.referenceVersionId).push(r.mask);
  }
  for (const [id,masks] of groups) {
    const reference = references.get(id);
    if (!reference || reference.length !== output.length) fail('REFERENCE_FRAME_MISMATCH', '保护参考图与当前输出尺寸不一致。');
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const point=viewToOriginalPoint({x:(x+.5)/width,y:(y+.5)/height},crop,source.width,source.height);
      const weight=Math.max(...masks.map(mask=>protectionWeight(mask,point)));
      if (!weight) continue;
      const at=(y*width+x)*4;
      if (weight === 1) { output.set(reference.subarray(at,at+4),at); continue; }
      // Premultiplied alpha in linear light. Endpoint bytes never pass through
      // conversion/quantization, so the protected core is byte-exact.
      const ra=reference[at+3]/255,na=output[at+3]/255,alpha=ra*weight+na*(1-weight);
      for (let c=0;c<3;c++) output[at+c]=alpha ? linearToSrgb((linear[reference[at+c]]*ra*weight+linear[output[at+c]]*na*(1-weight))/alpha)*255 : 0;
      output[at+3]=alpha*255;
    }
  }
  return output;
}
