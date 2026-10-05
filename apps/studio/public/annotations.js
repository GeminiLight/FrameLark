const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const full = {x:0,y:0,width:1,height:1};

export function rectFromPoints(start, end, minimum = .025) {
  if (![start?.x,start?.y,end?.x,end?.y].every(Number.isFinite)) return null;
  let x = clamp(Math.min(start.x,end.x),0,1);
  let y = clamp(Math.min(start.y,end.y),0,1);
  let width = Math.abs(end.x-start.x);
  let height = Math.abs(end.y-start.y);
  if (width < minimum && height < minimum) {
    width = .18; height = .18;
    x = clamp(start.x-width/2,0,1-width);
    y = clamp(start.y-height/2,0,1-height);
  } else {
    width = Math.max(minimum,width);
    height = Math.max(minimum,height);
    x = clamp(x,0,1-width);
    y = clamp(y,0,1-height);
  }
  return {x,y,width,height};
}

export function viewToImageRect(viewRect, crop = null) {
  const area = crop || full;
  return {
    x:area.x + viewRect.x*area.width,
    y:area.y + viewRect.y*area.height,
    width:viewRect.width*area.width,
    height:viewRect.height*area.height
  };
}

export function imageToViewRect(imageRect, crop = null) {
  const area = crop || full;
  const left = Math.max(imageRect.x,area.x);
  const top = Math.max(imageRect.y,area.y);
  const right = Math.min(imageRect.x+imageRect.width,area.x+area.width);
  const bottom = Math.min(imageRect.y+imageRect.height,area.y+area.height);
  if (right <= left || bottom <= top) return null;
  return {x:(left-area.x)/area.width,y:(top-area.y)/area.height,width:(right-left)/area.width,height:(bottom-top)/area.height};
}

export function measureRegion(data, width, height, rect) {
  if (!rect || !data || data.length !== width*height*4) return null;
  const left = Math.max(0,Math.floor(rect.x*width));
  const top = Math.max(0,Math.floor(rect.y*height));
  const right = Math.min(width,Math.ceil((rect.x+rect.width)*width));
  const bottom = Math.min(height,Math.ceil((rect.y+rect.height)*height));
  if (right <= left || bottom <= top) return null;
  let sum = 0, clipped = 0, dark = 0, saturation = 0, count = 0;
  const step = Math.max(1,Math.floor(Math.sqrt((right-left)*(bottom-top)/25000)));
  for (let y = top; y < bottom; y += step) for (let x = left; x < right; x += step) {
    const i = (y*width+x)*4;
    const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
    const luma = .2126*r+.7152*g+.0722*b;
    sum += luma;
    clipped += luma > .965 ? 1 : 0;
    dark += luma < .035 ? 1 : 0;
    saturation += Math.max(r,g,b)-Math.min(r,g,b);
    count++;
  }
  return {mean:sum/count,brightClip:clipped/count,darkClip:dark/count,saturation:saturation/count};
}
