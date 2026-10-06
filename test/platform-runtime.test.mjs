import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,access,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {trimPlatformRuntime} from '../skills/photo-retouch/scripts/platform-runtime.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'framelark-platform-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'package.json'),JSON.stringify({dependencies:{sharp:'0.35.4','@napi-rs/canvas':'0.1.100'}}));
 const put=async(name,value={})=>{const folder=join(root,'node_modules',name);await mkdir(folder,{recursive:true});await writeFile(join(folder,'package.json'),JSON.stringify({name,...value}));};
 await put('sharp',{optionalDependencies:{'@img/sharp-darwin-arm64':'0.35.4','@img/sharp-freebsd-wasm32':'0.35.4'}});await put('@napi-rs/canvas');
 for(const name of ['@img/sharp-darwin-arm64','@img/sharp-libvips-darwin-arm64','@napi-rs/canvas-darwin-arm64','@img/sharp-darwin-x64','@napi-rs/canvas-linux-x64-gnu'])await put(name);
 await put('@img/sharp-wasm32',{dependencies:{'@emnapi/runtime':'1'}});await put('@emnapi/runtime',{dependencies:{tslib:'2'}});await put('tslib');
 const loaded=[join(root,'node_modules/@img/sharp-darwin-arm64/lib/sharp.node'),join(root,'node_modules/@napi-rs/canvas-darwin-arm64/skia.node')];
 return {root,loaded,put};
}
test('native adapters keep their codec libraries and remove foreign/WASM packages',async t=>{
 const f=await fixture(t),result=await trimPlatformRuntime(f.root,{loaded:f.loaded,platform:'darwin',arch:'arm64'});
 assert.deepEqual(new Set(result.removed),new Set(['@img/sharp-darwin-x64','@napi-rs/canvas-linux-x64-gnu','@img/sharp-wasm32','@emnapi/runtime','tslib']));
 for(const name of ['sharp','@img/sharp-darwin-arm64','@img/sharp-libvips-darwin-arm64','@napi-rs/canvas-darwin-arm64'])await access(join(f.root,'node_modules',name));
});
test('active WASM, an unverified native adapter or a different platform is never pruned',async t=>{
 const f=await fixture(t);for(const opts of [{loaded:[]},{loaded:[...f.loaded,join(f.root,'node_modules/@img/sharp-wasm32/index.cjs')]},{loaded:f.loaded,platform:'linux',arch:'arm64'}])assert.deepEqual((await trimPlatformRuntime(f.root,{platform:'darwin',arch:'arm64',...opts})).removed,[]);
 await access(join(f.root,'node_modules/@img/sharp-wasm32'));
});
test('explicit and shared dependencies are preserved',async t=>{
 const f=await fixture(t);await f.put('@example/shared',{dependencies:{tslib:'2'}});
 await writeFile(join(f.root,'package.json'),JSON.stringify({dependencies:{sharp:'0.35.4','@napi-rs/canvas':'0.1.100','@img/sharp-wasm32':'0.35.4'}}));
 assert.ok(!(await trimPlatformRuntime(f.root,{loaded:f.loaded,platform:'darwin',arch:'arm64'})).removed.includes('@img/sharp-wasm32'));
 await access(join(f.root,'node_modules/tslib'));await access(join(f.root,'node_modules/@emnapi/runtime'));
});
test('a linked runtime never prunes a shared installation',async t=>{
 if(process.platform==='win32')return t.skip('Link permissions differ; real Windows setup is covered by the native gate');
 const f=await fixture(t),other=join(f.root,'linked');await mkdir(other);await symlink(join(f.root,'node_modules'),join(other,'node_modules'),'dir');
 assert.deepEqual((await trimPlatformRuntime(other,{loaded:f.loaded,platform:'darwin',arch:'arm64'})).removed,[]);await access(join(f.root,'node_modules/@img/sharp-wasm32'));
});
