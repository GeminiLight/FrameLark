import {readFile,readdir} from 'node:fs/promises';

// These pixel-processing modules are distributed inside the portable Skill as well.
// Installation never rebuilds or replaces the Skill's project, guard, or UI runtime.
const modules=['project-exchange.js','adjustment-layers.js','control-reference.js','crop-utils.js','detail-processing.js','editor-engine.js','export-files.js','export-settings.js','local-masks.js','photo-geometry.js','photo-metering.js','photo-rendering.js','presets.js','region-edits.js','render-frame.js','tone-processing.js'];
const root=new URL('../',import.meta.url),changed=[];
async function toolFiles(folder='photo-tools'){for(const entry of await readdir(new URL('apps/studio/public/'+folder+'/',root),{withFileTypes:true})){const name=folder+'/'+entry.name;if(entry.isDirectory())await toolFiles(name);else if(entry.name.endsWith('.js'))modules.push(name);}}
await toolFiles();
await toolFiles('edit-stack');
for(const name of modules){
  const [web,skill]=await Promise.all([readFile(new URL('apps/studio/public/'+name,root)),readFile(new URL('skills/photo-retouch/scripts/engine/'+name,root))]);
  if(!web.equals(skill))changed.push(name);
}
if(changed.length)throw Error(`Web and Skill processing modules differ: ${changed.join(', ')}. Update both implementations, check pipeline compatibility, and rerun both test suites.`);
for(const name of ['edit-stack-view.js','edit-stack.css']){const [web,skill]=await Promise.all([readFile(new URL('apps/studio/public/'+name,root)),readFile(new URL('skills/photo-retouch/scripts/ui/'+name,root))]);if(!web.equals(skill))throw Error('Shared inspector differs: '+name);}
const pool=await readFile(new URL('apps/studio/server/projects/render-pool.mjs',root),'utf8'),portablePool=await readFile(new URL('skills/photo-retouch/scripts/render-pool.mjs',root),'utf8');if(pool.replaceAll('../../../../skills/photo-retouch/scripts/','./')!==portablePool)throw Error('Portable render pool differs from studio admission/cancellation/deadline contract.');
const [sharedJobs,portableJobs]=await Promise.all([readFile(new URL('apps/studio/server/projects/coalesced-jobs.mjs',root)),readFile(new URL('skills/photo-retouch/scripts/coalesced-jobs.mjs',root))]);if(!sharedJobs.equals(portableJobs))throw Error('Portable preview coalescing differs from studio cancellation contract.');
const [studioDrafts,websiteDrafts]=await Promise.all([readFile(new URL('apps/studio/public/draft-storage.js',root)),readFile(new URL('apps/website/public/draft-storage.js',root))]);if(!studioDrafts.equals(websiteDrafts))throw Error('Website and studio draft storage differ; preserve the shared transaction/revision contract.');
const [studioAutosave,websiteAutosave]=await Promise.all([readFile(new URL('apps/studio/public/draft-autosave.js',root)),readFile(new URL('apps/website/public/draft-autosave.js',root))]);if(!studioAutosave.equals(websiteAutosave))throw Error('Website and studio autosave differ; preserve the shared flush/transition contract.');
console.log(`Shared processing modules match: ${modules.length}.`);
