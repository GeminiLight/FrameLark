import {neutralSettings} from '../editor-engine.js';
import {buildToneCurve,mapTone,srgbToLinear,linearToSrgb,whiteBalanceGains} from '../tone-processing.js';
import {resolveRenderFrame,grainAt} from '../render-frame.js';
import {viewToOriginalPoint} from '../photo-geometry.js';
import {pixelTool} from './tools.js';
import {fail} from './values.js';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const luminance=(r,g,b)=>.2126*r+.7152*g+.0722*b;
export function exposureWeight(r,g,b,gain,weight,policy){if(policy!=='limit-positive-gain'||gain<=1)return weight;for(const c of [r,g,b])if(c>0)weight=Math.min(weight,c>=1?0:(1-c)/(c*(gain-1)));return clamp(weight);}
function hue(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(d<1e-10)return -1;let h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return (h*60+360)%360;}
const hueWeight=(h,c,w)=>h<0?0:Math.max(0,1-Math.abs(((h-c+540)%360)-180)/w);
function hslToRgb(h,s,l){const c=(1-Math.abs(2*l-1))*s,sector=(((h%360)+360)%360)/60,x=c*(1-Math.abs(sector%2-1)),triplets=[[c,x,0],[x,c,0],[0,c,x],[0,x,c],[c,0,x]],offset=l-c/2;return triplets[Math.floor(sector)%6].map(v=>v+offset);}
function detailPixels(input,width,height,parameters){
  const temp=new Float32Array(input.length),output=new Float32Array(input.length),radius=parameters.clarity?8:parameters.denoise?2:1;
  // Separable, alpha-weighted box neighborhood, replicated at image boundaries.
  // A mask controls output mixing; it never cuts off neighborhood input.
  for(let y=0;y<height;y++){
    const sums=[0,0,0,0],add=(x,sign)=>{const i=(y*width+clamp(x,0,width-1))*4,a=input[i+3]/255;sums[0]+=input[i]*a*sign;sums[1]+=input[i+1]*a*sign;sums[2]+=input[i+2]*a*sign;sums[3]+=a*sign;};
    for(let x=-radius;x<=radius;x++)add(x,1);
    for(let x=0;x<width;x++){const i=(y*width+x)*4;for(let c=0;c<4;c++)temp[i+c]=sums[c];add(x-radius,-1);add(x+radius+1,1);}
  }
  const strength=parameters.texture/100*.35+parameters.clarity/100*.45+parameters.sharpen/100*.6,denoise=parameters.denoise/100*.85;
  for(let x=0;x<width;x++){
    const sums=[0,0,0,0],add=(y,sign)=>{const i=(clamp(y,0,height-1)*width+x)*4;for(let c=0;c<4;c++)sums[c]+=temp[i+c]*sign;};for(let y=-radius;y<=radius;y++)add(y,1);
    for(let y=0;y<height;y++){const i=(y*width+x)*4;for(let c=0;c<3;c++){const smooth=sums[3]>1e-8?sums[c]/sums[3]:input[i+c],detail=input[i+c]-smooth;output[i+c]=input[i+c]+detail*strength+(smooth-input[i+c])*denoise;}output[i+3]=input[i+3];add(y-radius,-1);add(y+radius+1,1);}
  }
  return output;
}
export function kernelFor(step,input,{width,height,frame,document}){
  const tool=pixelTool(step.tool,step.toolVersion),p=step.parameters;if(tool.kernel)return tool.kernel(step,input,{width,height,frame,document});
  if(step.tool==='detail'){const filtered=detailPixels(input,width,height,p);return (_x,_y,i)=>[filtered[i],filtered[i+1],filtered[i+2]];}
  if(step.tool==='exposure'){const gain=2**p.ev;return (_x,_y,i)=>[input[i]*gain,input[i+1]*gain,input[i+2]*gain];}
  if(step.tool==='tone'){
    const curve=buildToneCurve({...neutralSettings(),...p}),fade=p.fade/100;
    return (_x,_y,i)=>{let r=input[i],g=input[i+1],b=input[i+2],Y=luminance(r,g,b);if(curve){const encoded=linearToSrgb(Math.max(0,Y)),mapped=srgbToLinear(mapTone(curve,encoded));if(Y>1e-8){const gain=mapped/Y;r*=gain;g*=gain;b*=gain;}else r=g=b=mapped;}if(fade){r=r*(1-fade*.31)+srgbToLinear(.24)*fade;g=g*(1-fade*.31)+srgbToLinear(.24)*fade;b=b*(1-fade*.31)+srgbToLinear(.24)*fade;}return [r,g,b];};
  }
  if(step.tool==='color'){
    const gains=whiteBalanceGains(p.warmth,p.tint),saturation=1+p.saturation/100,mono=p.monochrome/100;
    return (_x,_y,i)=>{let r=linearToSrgb(input[i]*gains[0]),g=linearToSrgb(input[i+1]*gains[1]),b=linearToSrgb(input[i+2]*gains[2]);const h=hue(r,g,b),local=clamp(Math.max(r,g,b)-Math.min(r,g,b)),warm=p.vibrance>0?hueWeight(h,35,55):0,vibrance=1+p.vibrance/100*(1-local)*.8*(p.vibrance>0?1-warm*.65:1),orange=hueWeight(h,30,52),green=hueWeight(h,125,67),blue=hueWeight(h,220,68);
      const mix=1+(orange*p.orangeSaturation+green*p.greenSaturation+blue*p.blueSaturation)/100,shift=(orange*p.orangeHue+green*p.greenHue+blue*p.blueHue)*.5,lumaShift=(orange*p.orangeLuminance+green*p.greenLuminance+blue*p.blueLuminance)*.0015;
      if(h>=0&&(shift||lumaShift)){const max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max-min,luma=(max+min)/2,s=chroma<1e-10?0:chroma/(1-Math.abs(2*luma-1)||1);[r,g,b]=hslToRgb(h+shift,clamp(s),clamp(luma+lumaShift));}
      const gray=luminance(r,g,b),amount=Math.max(0,saturation*vibrance*mix)*(1-mono);return [r,g,b].map(value=>srgbToLinear(gray+(value-gray)*amount));};
  }
  if(step.tool==='finish'){
    const resolved=resolveRenderFrame(width,height,frame),composition=document.geometry.crop||{x:0,y:0,width:1,height:1},vignette=p.vignette/100,grain=p.grain/100;
    return (x,y,i)=>{const point=viewToOriginalPoint({x:(x+.5)/width,y:(y+.5)/height},{x:frame.sourceRect.x/frame.fullWidth,y:frame.sourceRect.y/frame.fullHeight,width:frame.sourceRect.width/frame.fullWidth,height:frame.sourceRect.height/frame.fullHeight,angle:frame.angle||0},frame.fullWidth,frame.fullHeight),dx=(point.x-composition.x)/composition.width-.5,dy=(point.y-composition.y)/composition.height-.5,t=clamp((Math.hypot(dx,dy)/.7071-.24)/(.95-.24)),shade=1-vignette*.57*t*t*(3-2*t),noise=grain?grainAt(x,y,resolved,width,height)*grain*.025:0;return [input[i]*shade+noise,input[i+1]*shade+noise,input[i+2]*shade+noise];};
  }
  fail('TOOL_VERSION_UNSUPPORTED','没有可执行的像素内核。');
}
export function encodeWorking(r,g,b){let Y=clamp(luminance(r,g,b)),fit=1;for(const c of [r,g,b]){if(c>1)fit=Math.min(fit,(1-Y)/(c-Y));if(c<0)fit=Math.min(fit,Y/(Y-c));}return [r,g,b].map(value=>clamp(linearToSrgb(Y+(value-Y)*fit))*255);}
