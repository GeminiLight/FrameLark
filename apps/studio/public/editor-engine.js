import {linearBytes,srgbToLinear,encodeLinear,buildToneCurve,mapTone,whiteBalanceGains} from './tone-processing.js';
import {processDetails} from './detail-processing.js';
import {resolveRenderFrame,grainAt} from './render-frame.js';

export const renderingVersion='photo-render-2026-09-30-masks';
export const adjustmentKeys = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'vibrance', 'saturation', 'warmth', 'tint', 'fade', 'vignette', 'grain',
  'orangeSaturation', 'greenSaturation', 'blueSaturation', 'monochrome',
  'curveShadows', 'curveMidtones', 'curveHighlights',
  'orangeHue', 'greenHue', 'blueHue',
  'orangeLuminance', 'greenLuminance', 'blueLuminance',
  'texture', 'clarity', 'dehaze', 'sharpen', 'denoise'
];

export const limits = {
  exposure: [-1.5, 1.5],
  monochrome: [0, 100],
  vignette: [0, 75],
  fade: [0, 60],
  grain: [0, 50]
};

export const neutralSettings = () => Object.fromEntries(adjustmentKeys.map(key => [key, 0]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function combineSettings(...layers) {
  const result = neutralSettings();
  for (const { settings, amount = 1 } of layers) {
    if (!settings) continue;
    for (const key of adjustmentKeys) {
      const value = Number(settings[key]);
      if (Number.isFinite(value)) result[key] += value * amount;
    }
  }
  for (const key of adjustmentKeys) {
    const [min, max] = limits[key] || [-75, 75];
    result[key] = clamp(result[key], min, max);
  }
  return result;
}

function hueDegrees(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < .0001) return -1;
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

function hueWeight(hue, center, width) {
  const distance = Math.abs(((hue - center + 540) % 360) - 180);
  return Math.max(0, 1 - distance / width);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs(sector % 2 - 1));
  const triplets = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]];
  const [r,g,b] = triplets[Math.floor(sector) % 6];
  const offset = l - c / 2;
  return [r + offset,g + offset,b + offset];
}

export function renderPixels(source, width, height, settings = neutralSettings(),options={}) {
  if (source.length !== width * height * 4) throw new Error('Pixel buffer size does not match image dimensions');
  const output = new Uint8ClampedArray(source);
  const s = combineSettings({settings});
  if (!adjustmentKeys.some(key=>s[key])) return output;
  const frame=resolveRenderFrame(width,height,options);
  const exposure = 2 ** s.exposure;
  const saturation = 1 + s.saturation / 100;
  const [gainR,gainG,gainB]=whiteBalanceGains(s.warmth,s.tint);
  const toneCurve=buildToneCurve(s);
  const tonal=Boolean(toneCurve || s.exposure || s.warmth || s.tint);
  const fade = s.fade / 100;
  const vignette = s.vignette / 100;
  const monochrome = s.monochrome / 100;
  const grain = s.grain / 100;
  const spatial = Boolean(s.texture || s.clarity || s.sharpen || s.denoise);
  const input = spatial ? processDetails(source,width,height,s,frame):source;
  const mixer = Boolean(s.orangeHue || s.greenHue || s.blueHue ||
    s.orangeSaturation || s.greenSaturation || s.blueSaturation ||
    s.orangeLuminance || s.greenLuminance || s.blueLuminance);
  for (let y = 0, index = 0; y < height; y++) {
    for (let x = 0; x < width; x++, index += 4) {
      if(!source[index+3]) continue;
      let r=input[index]/255,g=input[index+1]/255,b=input[index+2]/255;
      if(tonal) {
        r=linearBytes[input[index]]*gainR;g=linearBytes[input[index+1]]*gainG;b=linearBytes[input[index+2]]*gainB;
        if(s.exposure) {
          const peak=Math.max(r,g,b);
          // Positive exposure gains a smooth shoulder; it cannot hard-clip every bright tone.
          const gain=s.exposure>0 && peak>0 ? (1-(1-clamp(peak,0,1))**exposure)/peak:exposure;
          r*=gain;g*=gain;b*=gain;
        }
        let light=.2126*r+.7152*g+.0722*b;
        if(toneCurve) {
          const target=srgbToLinear(mapTone(toneCurve,encodeLinear(light)));
          if(light>1e-8) { const gain=target/light;r*=gain;g*=gain;b*=gain; }
          else r=g=b=target;
          light=target;
        }
        // Fit the gamut by reducing chroma around luminance, instead of clipping one channel.
        light=clamp(light,0,1);
        let fit=1;
        if(r>1) fit=Math.min(fit,(1-light)/(r-light));if(r<0) fit=Math.min(fit,light/(light-r));
        if(g>1) fit=Math.min(fit,(1-light)/(g-light));if(g<0) fit=Math.min(fit,light/(light-g));
        if(b>1) fit=Math.min(fit,(1-light)/(b-light));if(b<0) fit=Math.min(fit,light/(light-b));
        r=encodeLinear(light+(r-light)*fit);g=encodeLinear(light+(g-light)*fit);b=encodeLinear(light+(b-light)*fit);
      }
      if (fade) {
        r = r * (1 - fade * .31) + fade * .24;
        g = g * (1 - fade * .31) + fade * .24;
        b = b * (1 - fade * .31) + fade * .24;
      }
      const localSaturation = Math.max(r, g, b) - Math.min(r, g, b);
      const warmHue=s.vibrance>0 ? hueWeight(hueDegrees(r,g,b),35,55):0;
      const vibrance = 1 + (s.vibrance / 100) * (1 - clamp(localSaturation, 0, 1)) * .8 * (s.vibrance>0 ? 1-warmHue*.65:1);
      let mix = 1;
      if (mixer) {
        const hue = hueDegrees(r, g, b);
        if (hue >= 0) {
          const orange = hueWeight(hue, 30, 52), green = hueWeight(hue, 125, 67), blue = hueWeight(hue, 220, 68);
          mix += (orange * s.orangeSaturation + green * s.greenSaturation + blue * s.blueSaturation) / 100;
          const hueShift = (orange * s.orangeHue + green * s.greenHue + blue * s.blueHue) * .5;
          const lumaShift = (orange * s.orangeLuminance + green * s.greenLuminance + blue * s.blueLuminance) * .0015;
          if (hueShift || lumaShift) {
            const max = Math.max(r,g,b), min = Math.min(r,g,b), chroma = max - min;
            const luminance = (max + min) / 2;
            const hslSaturation = chroma < .0001 ? 0 : chroma / (1 - Math.abs(2 * luminance - 1) || 1);
            [r,g,b] = hslToRgb(hue + hueShift, clamp(hslSaturation,0,1), clamp(luminance + lumaShift,0,1));
          }
        }
      }
      const gray = .2126 * r + .7152 * g + .0722 * b;
      const colorAmount = Math.max(0, saturation * vibrance * mix) * (1 - monochrome);
      r = gray + (r - gray) * colorAmount;
      g = gray + (g - gray) * colorAmount;
      b = gray + (b - gray) * colorAmount;
      let colorFit=1;
      if(r>1) colorFit=Math.min(colorFit,(1-gray)/(r-gray));if(r<0) colorFit=Math.min(colorFit,gray/(gray-r));
      if(g>1) colorFit=Math.min(colorFit,(1-gray)/(g-gray));if(g<0) colorFit=Math.min(colorFit,gray/(gray-g));
      if(b>1) colorFit=Math.min(colorFit,(1-gray)/(b-gray));if(b<0) colorFit=Math.min(colorFit,gray/(gray-b));
      r=gray+(r-gray)*colorFit;g=gray+(g-gray)*colorFit;b=gray+(b-gray)*colorFit;
      if (vignette) {
        const dx = (x + .5) / width - .5, dy = (y + .5) / height - .5;
        const radius = Math.sqrt(dx * dx + dy * dy) / .7071;
        const shade = 1 - vignette * .57 * smoothstep(.24, .95, radius);
        r *= shade; g *= shade; b *= shade;
      }
      if (grain) {
        const noise = grainAt(x,y,frame,width,height) * grain * .14;
        r += noise; g += noise; b += noise;
      }
      output[index] = clamp(r, 0, 1) * 255;
      output[index + 1] = clamp(g, 0, 1) * 255;
      output[index + 2] = clamp(b, 0, 1) * 255;
    }
  }
  return output;
}
