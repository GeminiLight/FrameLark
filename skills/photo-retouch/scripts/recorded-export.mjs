import {readFile,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {createHash} from 'node:crypto';

const failure=(code,message)=>Object.assign(Error(message),{code});
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const recordName=record=>typeof record?.path==='string'?record.path.split(/[\\/]/).at(-1):'';

export async function projectExportFolder(folder){
  const root=await realpath(folder),expected=join(root,'exports'),actual=await realpath(expected);
  if(actual!==expected)throw failure('EXPORT_PATH','成片目录已被重定向，请恢复项目内的实际成片目录。');
  return actual;
}
export async function portableExportRecord(folder,value){
  const root=await realpath(folder),parent=await realpath(dirname(resolve(value.path))),name=basename(value.path);
  return {...value,relativePath:parent===join(root,'exports')&&validHash(value.fileHash)?'exports/'+name:null};
}
export function exportRecordPath(folder,record){
  const name=recordName(record);
  return name&&record.relativePath==='exports/'+name?join(folder,'exports',name):record.path;
}
export async function readRecordedExport(folder,project,name){
  if(typeof name!=='string'||!name||name==='.'||name==='..'||basename(name)!==name||name.includes('\\'))throw failure('EXPORT_NOT_FOUND','找不到这份已登记成片。');
  const records=project.exports.filter(record=>recordName(record)===name&&project.versions.some(version=>version.id===record.versionId));
  if(!records.length)throw failure('EXPORT_NOT_FOUND','找不到这份已登记成片。');
  const base=await projectExportFolder(folder),expected=join(base,name),file=await realpath(expected);
  if(!file.startsWith(base+sep))throw failure('EXPORT_PATH','成片文件指向项目目录之外，请恢复实际成片后重试。');
  const bytes=await readFile(file);
  for(const record of records){
    if(Object.hasOwn(record,'relativePath')){
      // An explicit external output stays external; never reinterpret it as
      // a managed project file merely because its name happens to match.
      if(record.relativePath!=='exports/'+name||!validHash(record.fileHash))continue;
    }else{
      let inPlace=false;try{inPlace=await realpath(dirname(record.path))===base;}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
      const legacyInternal=record.path.split(/[\\/]/).at(-2)==='exports';
      if(!inPlace&&(!legacyInternal||!validHash(record.fileHash)))continue;
    }
    if(record.fileHash!==undefined&&(!validHash(record.fileHash)||checksum(bytes)!==record.fileHash))continue;
    return {bytes,name,item:{...record,path:file}};
  }
  throw failure('EXPORT_CHANGED','成片记录与当前项目内的文件身份不一致，请保留文件并重新导出。');
}
