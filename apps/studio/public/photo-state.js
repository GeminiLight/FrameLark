// Photo objects own their editing state. The editor is a live view of the active
// photo; UI-only fields (loading, panel selection, global preferences) stay local.
const photoFields=Object.freeze([
  'toolRuns','creativeIntent','analysisIntent','image','imageName','isDemo',
  'previewSource','previewData','analysis','advisorLayers','active','manual',
  'crop','compare','annotations','presetId','presetAmount','presetThumbs',
  'analysisSource','analysisStatus','analysisError','analysisProvenance',
  'originalInspection','originalRecommendations','assessment','exported'
]);

export function bindActivePhotoState(editor,getPhoto){
  const idle=Object.fromEntries(photoFields.map(key=>[key,editor[key]]));
  for(const key of photoFields)Object.defineProperty(editor,key,{
    enumerable:true,
    get(){return (getPhoto()||idle)[key];},
    set(value){(getPhoto()||idle)[key]=value;}
  });
  return editor;
}
