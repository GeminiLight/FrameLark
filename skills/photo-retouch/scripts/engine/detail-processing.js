const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const luminance=(data,i)=>.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];

function denoisePixels(source,width,height,amount,frame) {
  const output=new Uint8ClampedArray(source);
  const sigmaL=5+amount*.45,sigmaC=10+amount*.65;
  const blend=Math.min(.92,amount/50*.9);
  const range=Float32Array.from({length:2049},(_,i)=>Math.exp(-i/128));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    if(!source[i+3]) continue;
    const center=luminance(source,i),cb=source[i+2]-center,cr=source[i]-center;
    let sum=0,r=0,g=0,b=0;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      const j=(clamp(y+Math.round(dy*frame.scaleY),0,height-1)*width+clamp(x+Math.round(dx*frame.scaleX),0,width-1))*4;
      if(!source[j+3]) continue;
      const light=luminance(source,j),dl=(light-center)/sigmaL;
      const db=(source[j+2]-light-cb)/sigmaC,dr=(source[j]-light-cr)/sigmaC;
      const distance=Math.round((dl*dl+(db*db+dr*dr)*.35)*64);
      const weight=(dx ? 1:2)*(dy ? 1:2)*(source[j+3]/255)*(distance<range.length ? range[distance]:0);
      sum+=weight;r+=source[j]*weight;g+=source[j+1]*weight;b+=source[j+2]*weight;
    }
    output[i]=source[i]+(r/sum-source[i])*blend;
    output[i+1]=source[i+1]+(g/sum-source[i+1])*blend;
    output[i+2]=source[i+2]+(b/sum-source[i+2])*blend;
  }
  return output;
}

export function processDetails(source,width,height,s,frame) {
  const input=s.denoise>0 ? denoisePixels(source,width,height,s.denoise,frame):source;
  if(!s.sharpen && !s.texture && !s.clarity) return input;
  const luma=Float32Array.from({length:width*height},(_,p)=>luminance(input,p*4));
  const output=new Uint8ClampedArray(input);
  const gain=s.sharpen/50*.8+s.texture/75*.45;
  const threshold=s.sharpen>0 ? 1.2+s.denoise*.025:0;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const pixel=y*width+x,i=pixel*4;
    if(!input[i+3]) continue;
    const light=luma[pixel];
    let sum=0,weight=0,min=light,max=light;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      const p=clamp(y+Math.round(dy*frame.scaleY),0,height-1)*width+clamp(x+Math.round(dx*frame.scaleX),0,width-1);
      if(!input[p*4+3]) continue;
      const w=(dx ? 1:2)*(dy ? 1:2)*input[p*4+3]/255;
      sum+=luma[p]*w;weight+=w;min=Math.min(min,luma[p]);max=Math.max(max,luma[p]);
    }
    const residual=light-sum/weight;
    const fine=gain>0 ? Math.sign(residual)*Math.max(0,Math.abs(residual)-threshold)*gain:residual*gain;
    let broad=0;
    if(s.clarity) {
      let farSum=0,farWeight=0;
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
        const p=clamp(y+Math.round(dy*frame.scaleY),0,height-1)*width+clamp(x+Math.round(dx*frame.scaleX),0,width-1);
        if(!input[p*4+3]) continue;
        const w=(3-Math.abs(dx))*(3-Math.abs(dy))*input[p*4+3]/255;
        farSum+=luma[p]*w;farWeight+=w;
      }
      broad=(light-farSum/farWeight)*s.clarity/100;
    }
    // Bound detail changes by the actual neighborhood. Strong edges cannot acquire halos.
    const delta=clamp(clamp(clamp(fine+broad,-7,7),min-light,max-light),-Math.min(input[i],input[i+1],input[i+2]),255-Math.max(input[i],input[i+1],input[i+2]));
    output[i]=input[i]+delta;output[i+1]=input[i+1]+delta;output[i+2]=input[i+2]+delta;
  }
  return output;
}
