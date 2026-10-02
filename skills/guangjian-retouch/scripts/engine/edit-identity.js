import {createHash} from 'node:crypto';
import {canonical} from './edit-values.js';
import {renderingVersion} from './editor-engine.js';
import {protectionVersion} from './protected-regions.js';
export const pipelineVersion = `${renderingVersion}+lettering-v1+${protectionVersion}`;
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const legacyHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const selectionIdentity = (base, candidate) => hash({pipeline:pipelineVersion,baseVersion:base.id,baseState:base.state,items:candidate.items,selectedItemIds:candidate.selectedItemIds,state:candidate.state,guardOperation:candidate.guardOperation});
