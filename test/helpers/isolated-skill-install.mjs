// Exercise the actual installer and filesystem without changing real HOME,
// CODEX_HOME, or a user's Codex skills. Only process/os bindings are isolated.
import vm from 'node:vm';
import * as os from 'node:os';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const options=JSON.parse(await readFile(process.argv[2],'utf8')),messages=[];
const isolated={argv:['node',options.source,...options.args],env:{...process.env,CODEX_HOME:options.profile},execPath:process.execPath,exitCode:0};
const context=vm.createContext({process:isolated,console:{log:value=>messages.push(String(value)),error:value=>messages.push(String(value))},Buffer});
const entry=new vm.SourceTextModule(await readFile(options.source,'utf8'),{context,identifier:options.source});
await entry.link(async spec=>{
  const namespace=spec==='node:os'?{...os,default:{...os,homedir:()=>options.home}}:await import(spec.startsWith('.')?new URL(spec,pathToFileURL(options.source)).href:spec);
  return new vm.SyntheticModule(Object.keys(namespace),function(){for(const key of Object.keys(namespace))this.setExport(key,namespace[key]);},{context});
});
await entry.evaluate();console.log(JSON.stringify({code:isolated.exitCode,messages}));
