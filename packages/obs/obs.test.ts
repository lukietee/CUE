import { test } from 'node:test';
import assert from 'node:assert/strict';
import OBSWebSocket from 'obs-websocket-js';
import { MockObsAdapter, RealObsAdapter } from './index.ts';

test('mock OBS models actual connection and stream state independently',async()=>{
 const obs=new MockObsAdapter();
 await assert.rejects(obs.getStreamStatus(),/disconnected/);
 await obs.connect();
 assert.deepEqual(await obs.getStreamStatus(),{active:false});
 await obs.startStream(); assert.deepEqual(await obs.getStreamStatus(),{active:true});
 await obs.ensureOverlaySource('http://127.0.0.1/overlay');
 await obs.ensureOverlaySource('http://127.0.0.1/overlay');
 assert.equal(obs.overlayUrl,'http://127.0.0.1/overlay');
 await assert.rejects(obs.switchScene('nonexistent'),/Unknown/);
 await obs.stopStream(); assert.deepEqual(await obs.getStreamStatus(),{active:false});
});

test('real staging reuses input and scene item across retries and verifies browser URL',async()=>{
 const calls:string[]=[]; let input=false; let item=false; let inputSettings:Record<string,unknown>={};
 const fake={on:()=>{},connect:async()=>{},disconnect:async()=>{},call:async(name:string,args:any)=>{
  calls.push(name);
  switch(name){
   case 'GetCurrentProgramScene': return {currentProgramSceneName:'Main'};
   case 'GetInputList':return {inputs:input?[{inputName:'CUE Overlay',inputKind:'browser_source'}]:[]};
   case 'CreateInput':input=true;item=true;inputSettings=args.inputSettings;return {sceneItemId:1};
   case 'SetInputSettings':inputSettings=args.inputSettings;return {};
   case 'GetSceneItemList':return {sceneItems:item?[{sourceName:'CUE Overlay',sceneItemId:1}]:[]};
   case 'GetInputSettings':return {inputSettings};
   default:return {};
  }
 }};
 const obs=new RealObsAdapter({},fake as unknown as OBSWebSocket);
 await obs.connect(); await obs.ensureOverlaySource('http://127.0.0.1:4318/?token=x'); await obs.ensureOverlaySource('http://127.0.0.1:4318/?token=x');
 assert.equal(calls.filter(n=>n==='CreateInput').length,1);
 assert.equal(calls.filter(n=>n==='CreateSceneItem').length,0);
 await assert.rejects(obs.ensureOverlaySource('https://example.com'),/local overlay/);
});
