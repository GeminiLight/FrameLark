import {presetById} from './presets.js';
import {presetTrial} from './edit-stack/styles.js';

export function auditionSnapshot(snapshot,styleId,amount=75) {
  if(!snapshot || !presetById(styleId))return null;
  if(snapshot.editDocument){const trial=presetTrial(snapshot.editDocument,styleId,amount,{groupId:'audition-'+crypto.randomUUID()});return {...structuredClone(snapshot),presetId:styleId,presetAmount:amount,editDocument:trial.document,styleTrial:trial};}
  const candidate=structuredClone(snapshot);
  candidate.presetId=styleId;
  candidate.presetAmount=Math.max(0,Math.min(100,Number.isFinite(Number(amount)) ? Number(amount):75));
  return candidate;
}

// The candidate and its pixels live outside the saved editor. Late frames must never
// replace a newer audition, another photo, or a changed official version.
export function createStyleAudition({context,render,onState}) {
  let generation=0,active=null;
  let rendering=Promise.resolve();
  const skipped=Symbol('superseded');
  const matches=captured=>{const now=context();return now && captured.photoId===now.photoId && captured.signature===now.signature;};
  function end() {generation++;active=null;onState({phase:'idle'});}
  return {
    get active(){return active;},end,
    async start(styleId,amount,mode='hover') {
      const captured=context(),candidate=auditionSnapshot(captured?.snapshot,styleId,amount);
      if(!captured || !candidate)return false;
      const token=++generation;
      active={styleId,amount:candidate.presetAmount,mode};
      onState({...active,phase:'loading'});
      const task=rendering.then(()=>token===generation && matches(captured) ? render(candidate,captured):skipped);
      rendering=task.catch(()=>{});
      try {
        const output=await task;
        if(token!==generation)return false;
        if(!matches(captured)){end();return false;}
        if(output===skipped)return false;
        onState({...active,phase:'ready',output});return true;
      } catch {
        if(token===generation){if(matches(captured))onState({...active,phase:'failed'});else end();}
        return false;
      }
    }
  };
}
