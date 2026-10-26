// Saving and listening for other editors are independent. A reconnect must
// never erase a failed write or describe a saved project as unsaved.
export function projectSaveState(photo,link){
  if(!photo?.projectId)return {label:'文件项目',message:'',pending:false};
  if(photo.projectNativePending)return {label:'项目 · 待保存',message:'协作精修中的修改尚未保存',pending:true};
  if(link?.conflict)return {label:'项目 · 有更新',message:'项目有更新，当前修改尚未同步；打开项目处理，已有编辑保留。',pending:true};
  if(photo.editRetry||link?.error)return {label:'项目 · 保存失败',message:photo.editStackError||link?.error||'修改尚未保存，请重试。',pending:true};
  if(photo.editSaving||link?.busy||link?.dirty)return {label:'项目 · 保存中',message:'正在保存到项目…',pending:true};
  if(link?.remote>photo.projectRevision)return {label:'项目 · 同步中',message:'正在读取项目更新…',pending:false};
  return {label:'项目 · 已保存',message:link?.connectionError||'已保存到项目',pending:false};
}
