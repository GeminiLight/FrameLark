import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {handlePhotoToolRoutes} from '../../apps/studio/server/tools/routes.mjs';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';
const response=()=>{const res=new EventEmitter();res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;res.headersSent=true;};res.end=value=>{res.writableEnded=true;res.value=JSON.parse(value);};return res;};
const operation={id:'light',title:'提亮',tool:'tone',version:1,target:{kind:'image'},parameters:{mode:'delta',changes:[{key:'exposure',value:.1}]},dependsOn:[]};
const payload=()=>({operations:[operation],state:{settings:neutralSettings(),locals:[],crop:null,style:null},source:{width:20,height:20},namespace:'route'});
test('foreign-origin tool requests are rejected before input or process execution',async()=>{
 const res=response();await handlePhotoToolRoutes({method:'POST',headers:{}},res,new URL('http://localhost/api/photo-tools/run'),{readBody(){throw Error('must not read');},allowed:()=>false,cloud:false});assert.equal(res.status,403);
});
test('cloud preparation uses the same tool contract and explicitly reports inline execution',async()=>{
 const res=response();await handlePhotoToolRoutes({method:'POST',headers:{}},res,new URL('https://host/api/photo-tools/run'),{readBody:async()=>Buffer.from(JSON.stringify(payload())),allowed:()=>false,cloud:true});
 assert.equal(res.status,200);assert.equal(res.value.state.settings.exposure,.1);assert.equal(res.value.records[0].execution.adapter,'inline');
});
test('unknown tools, command fields and out-of-bounds targets never become executable steps',async()=>{
 const value=payload();value.operations[0]={...operation,tool:'shell',parameters:{command:'touch /tmp/invalid'}};
 const res=response();await handlePhotoToolRoutes({method:'POST',headers:{}},res,new URL('http://localhost/api/photo-tools/run'),{readBody:async()=>Buffer.from(JSON.stringify(value)),allowed:()=>true,cloud:false});assert.equal(res.status,400);assert.equal(res.value.error.code,'TOOL_INPUT_INVALID');
});
