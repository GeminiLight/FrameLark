import {readFile} from 'node:fs/promises';

// These pixel-processing modules are distributed inside the portable Skill as well.
// Installation never rebuilds or replaces the Skill's project, guard, or UI runtime.
const modules=['adjustment-layers.js','control-reference.js','crop-utils.js','detail-processing.js','editor-engine.js','export-files.js','local-masks.js','photo-geometry.js','photo-metering.js','photo-rendering.js','presets.js','region-edits.js','render-frame.js','tone-processing.js'];
const root=new URL('../',import.meta.url),changed=[];
for(const name of modules){
  const [web,skill]=await Promise.all([readFile(new URL('public/'+name,root)),readFile(new URL('skills/guangjian-retouch/scripts/engine/'+name,root))]);
  if(!web.equals(skill))changed.push(name);
}
if(changed.length)throw Error(`Web and Skill processing modules differ: ${changed.join(', ')}. Update both implementations, check pipeline compatibility, and rerun both test suites.`);
console.log(`Shared processing modules match: ${modules.length}.`);
