import {renderPhotoPixels} from './photo-rendering.js';
import {createStackRenderCache} from './edit-stack/render.js';
const stackCache=createStackRenderCache();
self.onmessage=({data})=>{
  try {
    const pixels=renderPhotoPixels({...data,stackCache});
    self.postMessage({id:data.id,pixels:pixels.buffer},[pixels.buffer]);
  } catch {
    self.postMessage({id:data.id,error:true});
  }
};
