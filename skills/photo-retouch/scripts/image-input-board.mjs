import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export async function createInputBoard({images,outputDirectory,columns=Math.min(3,Math.ceil(Math.sqrt(images?.length||0))),cellSize=768}={}){
  if(!Array.isArray(images)||images.length<1||images.length>36||images.some(i=>!i||typeof i.id!=='string'||!/^[-\w]{1,24}$/.test(i.id)||typeof i.path!=='string'||!i.path.trim())||new Set(images.map(i=>i.id)).size!==images.length)fail('INPUT_BOARD_INVALID','需要1–36张图片、各自唯一的短ID和图片路径。');
  if(typeof outputDirectory!=='string'||!outputDirectory.trim()||!Number.isInteger(columns)||columns<1||columns>6||!Number.isInteger(cellSize)||cellSize<256||cellSize>1024)fail('INPUT_BOARD_INVALID','指定新输出目录，列数1–6，每格256–1024像素。');
  const rows=Math.ceil(images.length/columns),width=columns*cellSize,height=rows*cellSize;
  if(width*height>24_000_000)fail('INPUT_BOARD_INVALID','联系表超过2400万像素；请降低每格尺寸或分组。');
  const directory=resolve(outputDirectory);
  try{await stat(directory);fail('INPUT_BOARD_EXISTS','输出目录已存在，请选择新目录；已有文件不会覆盖。');}catch(e){if(e.code!=='ENOENT')throw e;}
  const records=[],layers=[];
  for(let n=0;n<images.length;n++){
    const item=images[n];let source,bytes,metadata,thumbnail;
    try{
      source=await realpath(item.path);
      if((await stat(source)).size>80*1024*1024)throw Error('单张输入超过80MB。');
      bytes=await readFile(source);metadata=await sharp(bytes,{limitInputPixels:100_000_000,failOn:'error'}).metadata();
      if(!['jpeg','png','webp','avif','heif'].includes(metadata.format)||(metadata.pages||1)>1)throw Error('只接受支持的静态栅格照片。');
      thumbnail=await sharp(bytes,{limitInputPixels:100_000_000,failOn:'error'}).rotate().resize({width:cellSize-16,height:cellSize-16,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    }catch(e){fail('INPUT_BOARD_IMAGE',`${item.id}无法制作原片预览：${e.message}`);}
    const x=(n%columns)*cellSize,y=Math.floor(n/columns)*cellSize;
    const left=x+8+Math.floor((cellSize-16-thumbnail.info.width)/2),top=y+8+Math.floor((cellSize-16-thumbnail.info.height)/2);
    layers.push({input:thumbnail.data,left,top});
    records.push({id:item.id,slot:n+1,source,sha256:createHash('sha256').update(bytes).digest('hex'),original:{width:metadata.width,height:metadata.height,orientation:metadata.orientation||1},cellBounds:{x,y,width:cellSize,height:cellSize},contentBounds:{x:left,y:top,width:thumbnail.info.width,height:thumbnail.info.height},cropApplied:false});
  }
  const imageBytes=await sharp({create:{width,height,channels:3,background:'#ebe7de'}}).composite(layers).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
  const manifest={schemaVersion:1,purpose:'generation-input-contact-sheet',generated:false,retouched:false,labelsInImage:false,count:images.length,columns,rows,width,height,cellSize,images:records,note:'完整原片经EXIF方向归正后缩小放入各格，不裁剪、不放大；ID仅在对应表中，不写入位图。此表用于绑定输入，不能作为精修结果或高清单图。'};
  try{await mkdir(directory,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('INPUT_BOARD_EXISTS','输出目录已存在；没有覆盖文件。');throw e;}
  const image=join(directory,'contact.jpg'),file=join(directory,'sources.json');
  await writeFile(image,imageBytes,{flag:'wx',mode:0o600});await writeFile(file,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {ok:true,image,manifest:file,count:images.length,width,height,generated:false,retouched:false};
}

if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const options={};for(let n=2;n<process.argv.length;n+=2){const key=process.argv[n];if(!['--input','--output','--columns','--cell-size'].includes(key)||process.argv[n+1]===undefined)fail('INPUT_BOARD_INVALID','选项：--input、--output，以及可选 --columns、--cell-size。');options[key]=process.argv[n+1];}
    if(!options['--input'])fail('INPUT_BOARD_INVALID','请提供 --input JSON文件。');
    const value=JSON.parse(await readFile(options['--input'],'utf8'));
    console.log(JSON.stringify(await createInputBoard({images:value.images,outputDirectory:options['--output'],...(options['--columns']?{columns:Number(options['--columns'])}:{}),...(options['--cell-size']?{cellSize:Number(options['--cell-size'])}:{})}),null,2));
  }catch(e){console.log(JSON.stringify({ok:false,error:{code:e.code||'INPUT_BOARD_ERROR',message:e.message}},null,2));process.exitCode=1;}
}
