import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberExportVersion,editionsFromProject} from '../../apps/studio/public/project-snapshot.js';
test('a file export reuses its captured native version rather than importing the old document as a new version',()=>{
 const old={id:'native-old',kind:'native',snapshot:{editDocument:{revision:3}}},photo={versions:[old]},snapshot={editDocument:{revision:3}};
 const saved=rememberExportVersion(photo,snapshot,'old-effect',{projectVersionId:'native-old'});assert.equal(saved,old);assert.equal(photo.versions.length,1);assert.equal(saved.kind,'export');assert.equal(saved.signature,'old-effect');
});
test('an export receipt retains the native ID when its version list has not refreshed yet',()=>{
 const photo={versions:[]},snapshot={manual:{exposure:.2}};const saved=rememberExportVersion(photo,snapshot,'effect',{projectVersionId:'native-captured'});snapshot.manual.exposure=.8;assert.equal(saved.id,'native-captured');assert.equal(saved.snapshot.manual.exposure,.2);
 rememberExportVersion(photo,snapshot,'effect',{projectVersionId:'native-captured'});assert.equal(photo.versions.length,1);
});
test('reopening a file project identifies exported versions from its durable export records',()=>{
 const data={exports:[{versionId:'v1'}],versions:[{id:'v1',name:'已有步骤',at:'2026-10-06',kind:'native',state:{settings:{},style:null,crop:null,locals:[]},notes:[]}]};assert.equal(editionsFromProject(data)[0].kind,'export');
});
