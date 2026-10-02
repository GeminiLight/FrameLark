import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const sharp=createRequire(new URL('../skills/guangjian-retouch/package.json',import.meta.url))('sharp');
const root=new URL('./fixtures/',import.meta.url);
await mkdir(new URL('quality/',root),{recursive:true});await mkdir(new URL('import/',root),{recursive:true});
const data=Buffer.alloc(512*512*3);
for(let y=0;y<512;y++)for(let x=0;x<512;x++){const p=(y*512+x)*3;data[p]=32+Math.round(x/511*185);data[p+1]=24+Math.round(y/511*193);data[p+2]=48+Math.round((x+y)/1022*170);}
await sharp(data,{raw:{width:512,height:512,channels:3}}).png().toFile(fileURLToPath(new URL('quality/portrait.png',root)));
await sharp({create:{width:80,height:40,channels:3,background:'#bc906c'}}).withMetadata({orientation:6}).jpeg().toFile(fileURLToPath(new URL('import/orientation-6.jpg',root)));
await writeFile(new URL('README.md',root),'These are generated charts, not photographs or aesthetic quality evidence.\n');
console.log('Generated technical test charts; no personal photographs required.');
