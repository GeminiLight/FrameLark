const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const srgbToLinear=value=>value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4;
export const linearToSrgb=value=>value<=.0031308 ? value*12.92 : 1.055*value**(1/2.4)-.055;
export const linearBytes=Float32Array.from({length:256},(_,i)=>srgbToLinear(i/255));
const encoded=Float32Array.from({length:8193},(_,i)=>linearToSrgb(i/8192));
export function encodeLinear(value) {
  const at=clamp(value)*8192,index=Math.min(8191,Math.floor(at));
  return encoded[index]+(encoded[index+1]-encoded[index])*(at-index);
}

// A bounded monotone cubic curve avoids reversals and abrupt clipping at tonal boundaries.
export function buildToneCurve(s) {
  const keys=['shadows','highlights','whites','blacks','curveShadows','curveMidtones','curveHighlights','contrast','dehaze'];
  if (!keys.some(key=>s[key])) return null;
  const b=s.blacks/100,h=s.highlights/100,w=s.whites/100,d=s.shadows/100;
  const cs=s.curveShadows/100,cm=s.curveMidtones/100,ch=s.curveHighlights/100;
  const x=[0,.08,.24,.5,.76,.92,1];
  const y=[b*.06,.08+b*.055+d*.055+cs*.03,.24+b*.012+d*.18+cs*.07,
    .5+d*.05+h*.025+cm*.14,.76+h*.14+w*.025+ch*.065,
    .92+h*.11+w*.075+ch*.06,1+Math.min(0,h)*.065+w*.1+ch*.03].map(value=>clamp(value));
  // Leave space for every knot even when several controls are pushed to their limits.
  for(let i=1;i<y.length;i++) y[i]=Math.max(y[i],y[i-1]+.001);
  if(y[6]>1) { y[6]=1;for(let i=5;i>=0;i--) y[i]=Math.min(y[i],y[i+1]-.001); }
  const slopes=x.slice(1).map((value,i)=>(y[i+1]-y[i])/(value-x[i]));
  const m=[slopes[0]];
  for(let i=1;i<6;i++) {
    const a=x[i]-x[i-1],b=x[i+1]-x[i];
    m[i]=(3*(a+b))/((2*b+a)/slopes[i-1]+(b+2*a)/slopes[i]);
  }
  m[6]=slopes[5];
  const contrast=Math.max(.25,1+s.contrast/100+s.dehaze/250);
  const table=new Float32Array(4097);
  let segment=0;
  for(let i=0;i<table.length;i++) {
    const value=i/4096;
    while(segment<5 && value>x[segment+1]) segment++;
    const span=x[segment+1]-x[segment],t=(value-x[segment])/span;
    let out=(2*t**3-3*t*t+1)*y[segment]+(t**3-2*t*t+t)*span*m[segment]
      +(-2*t**3+3*t*t)*y[segment+1]+(t**3-t*t)*span*m[segment+1];
    if(contrast!==1 && out>0 && out<1) out=1/(1+((1-out)/out)**contrast);
    table[i]=clamp(out);
  }
  return table;
}

export function mapTone(table,value) {
  if(!table) return value;
  const at=clamp(value)*4096,index=Math.min(4095,Math.floor(at));
  return table[index]+(table[index+1]-table[index])*(at-index);
}

export function whiteBalanceGains(warmth,tint) {
  const r=Math.exp(warmth*.006+tint*.003),g=Math.exp(-tint*.003),b=Math.exp(-warmth*.006+tint*.003);
  const luminance=.2126*r+.7152*g+.0722*b;
  return [r/luminance,g/luminance,b/luminance];
}
