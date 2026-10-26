import {documentHash} from './edit-stack/identity.js';
import {workspacePatch} from './project-snapshot.js';

// Adapts an editing session to durable project proposals. The controller owns
// cancellation, optimistic state and history; this adapter owns the protocol.
export function createProjectEditPersistence(workspace){
  return async(photo,{proposal,document:recipe,snapshot,signal,retrying})=>{
    if(!photo.projectId)return recipe;
    if(retrying){const recovered=await workspace.recoverDocument(photo,proposal.requestId,documentHash(recipe),{signal});if(recovered)return recovered;}
    const made=await workspace.proposeDocument(photo,proposal,{signal});
    if(documentHash(made.document)!==documentHash(recipe))throw new Error('网页与文件项目的配方结果不一致，请重新预览。');
    await workspace.renderDocumentPreview(photo,made.token,{signal});
    const data=await workspace.accept(photo,made.token,workspacePatch(snapshot,{intent:photo.creativeIntent,conversation:photo.conversation}),{signal});
    return data.document;
  };
}
