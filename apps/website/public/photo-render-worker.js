import {renderPhotoPixels} from './photo-rendering.js';
self.onmessage=({data})=>{
  try {
    const pixels=renderPhotoPixels(data);
    self.postMessage({id:data.id,pixels:pixels.buffer},[pixels.buffer]);
  } catch {
    self.postMessage({id:data.id,error:true});
  }
};
