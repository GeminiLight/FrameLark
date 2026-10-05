const finite = value => typeof value === 'number' && Number.isFinite(value);

export function validCrop(rect, {suggestion = false} = {}) {
  if (!rect || !['x','y','width','height'].every(key => finite(rect[key]))) return null;
  const {x,y,width,height} = rect;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) return null;
  if (width < .05 || height < .05) return null;
  if (suggestion && (width < .3 || height < .3 || width * height < .4 || width * height > .95)) return null;
  const angle=Number.isFinite(rect.angle) ? Math.max(-15,Math.min(15,rect.angle)):0;
  return {x,y,width,height,...(angle ? {angle}: {})};
}

export function cropPixelRect(crop, imageWidth, imageHeight) {
  const box = validCrop(crop);
  if (!box) return {x:0,y:0,width:imageWidth,height:imageHeight};
  const x = Math.min(imageWidth - 1, Math.round(box.x * imageWidth));
  const y = Math.min(imageHeight - 1, Math.round(box.y * imageHeight));
  const right = Math.max(x + 1, Math.min(imageWidth, Math.round((box.x + box.width) * imageWidth)));
  const bottom = Math.max(y + 1, Math.min(imageHeight, Math.round((box.y + box.height) * imageHeight)));
  return {x,y,width:right - x,height:bottom - y};
}

export function cropPixels(data, width, height, crop) {
  const rect = cropPixelRect(crop,width,height);
  if (!crop) return {data,width,height};
  const result = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * width + rect.x) * 4;
    result.set(data.subarray(start,start + rect.width * 4),row * rect.width * 4);
  }
  return {data:result,width:rect.width,height:rect.height};
}

export function exportGeometry(crop,imageWidth,imageHeight,maxSide=5000) {
  const rect=cropPixelRect(crop,imageWidth,imageHeight);
  const scale=Math.min(1,Math.max(512,Math.min(5000,Number(maxSide)||5000))/Math.max(rect.width,rect.height));
  return {rect,width:Math.max(1,Math.round(rect.width*scale)),height:Math.max(1,Math.round(rect.height*scale))};
}
