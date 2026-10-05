import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {writeImageMetadata,createPhotoArchive,crc32} from '../../public/export-files.js';
function chunks(bytes){const result=[];for(let offset=8;offset+12<=bytes.length;){const size=new DataView(bytes.buffer,bytes.byteOffset+offset).getUint32(0),type=new TextDecoder().decode(bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,offset+8+size);assert.equal(crc32(bytes.subarray(offset+4,offset+8+size)),new DataView(bytes.buffer,bytes.byteOffset+offset+8+size).getUint32(0));result.push({type,data});offset+=size+12;}return result;}
test('PNG metadata carries real 300 ppi density, sRGB and Unicode author, without changing compressed pixels',async()=>{
  const input=new Uint8Array(await readFile(new URL('./fixtures/quality/portrait.png',import.meta.url))),output=writeImageMetadata(input,'png',{dpi:300,includeArtwork:true,title:'自然版',author:'小林',copyright:'© 2026'});
  const before=chunks(input),after=chunks(output),density=after.find(item=>item.type==='pHYs').data;
  assert.equal(new DataView(density.buffer,density.byteOffset).getUint32(0),11811);assert.equal(density[8],1);assert.deepEqual([...after.find(item=>item.type==='sRGB').data],[0]);
  assert.ok(after.filter(item=>item.type==='iTXt').some(item=>new TextDecoder().decode(item.data).includes('小林')));
  const pixels=list=>inflateSync(Buffer.concat(list.filter(item=>item.type==='IDAT').map(item=>item.data)));assert.deepEqual(pixels(before),pixels(after));
  const stripped=chunks(writeImageMetadata(output,'png',{dpi:96}));assert.equal(stripped.some(item=>item.type==='iTXt'),false);assert.equal(stripped.filter(item=>item.type==='pHYs').length,1);
});
test('JPEG density, Exif ColorSpace and XMP are written while scan pixels remain identical',async()=>{
  const before=new Uint8Array(await readFile(new URL('./fixtures/tiny.jpg',import.meta.url))),after=writeImageMetadata(before,'jpeg',{dpi:300,includeArtwork:true,title:'逆光',author:'A&B',copyright:'摄影'});
  const scan=bytes=>{let offset=2;while(bytes[offset+1]!==0xda)offset+=2+(bytes[offset+2]<<8)+bytes[offset+3];return bytes.subarray(offset);};assert.deepEqual(scan(before),scan(after));
  assert.equal((after[14]<<8)|after[15],300);assert.equal((after[16]<<8)|after[17],300);
  const text=new TextDecoder().decode(after);assert.ok(text.includes('Exif\0\0'));assert.ok(text.includes('A&amp;B'));assert.ok(text.includes('摄影'));
  const tiffStart=Buffer.from(after).indexOf(Buffer.from('Exif\0\0'))+6,tiff=new DataView(after.buffer,after.byteOffset+tiffStart);
  const readIfd=offset=>{const tags=new Map();for(let i=0;i<tiff.getUint16(offset,true);i++){const at=offset+2+i*12;tags.set(tiff.getUint16(at,true),tiff.getUint32(at+8,true));}return tags;};
  const root=readIfd(tiff.getUint32(4,true)),exif=readIfd(root.get(0x8769));assert.equal(exif.get(0xa001),1);assert.equal(tiff.getUint32(root.get(0x11a),true),300);assert.equal(root.has(0x8825),false);
  const stripped=writeImageMetadata(after,'jpeg',{dpi:96});assert.ok(!new TextDecoder().decode(stripped).includes('A&amp;B'));assert.deepEqual(scan(before),scan(stripped));
});
test('invalid encoders fail visibly instead of claiming a completed export',()=>{assert.throws(()=>writeImageMetadata(Uint8Array.of(1,2,3),'png'));assert.throws(()=>writeImageMetadata(Uint8Array.of(255,216,255,224,0,0),'jpeg'));});
test('ZIP uses valid UTF-8 entry flags, CRC32, central directory and uncompressed data',async()=>{
  const data=Uint8Array.of(0,1,2,3,255),blob=await createPhotoArchive([{name:'人物-帧好.jpg',blob:new Blob([data])},{name:'风景.png',blob:new Blob(['hello'])}]),bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint16(6,true),0x800);assert.equal(v.getUint16(8,true),0);assert.equal(v.getUint32(14,true),crc32(data));
  const size=v.getUint16(26,true);assert.equal(new TextDecoder().decode(bytes.subarray(30,30+size)),'人物-帧好.jpg');assert.deepEqual(bytes.subarray(30+size,30+size+5),data);
  const end=new DataView(bytes.buffer,bytes.length-22);assert.equal(end.getUint32(0,true),0x06054b50);assert.equal(end.getUint16(10,true),2);assert.equal(v.getUint32(end.getUint32(16,true),true),0x02014b50);
  await assert.rejects(()=>createPhotoArchive([]));await assert.rejects(()=>createPhotoArchive([{name:'a',blob:new Blob(['large'])}],{limit:1}));
});
