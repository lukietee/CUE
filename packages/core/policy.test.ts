import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPolicy } from './policy.ts';
import type { CueSettings, ProposedAction } from '../shared/index.ts';
const settings:CueSettings={demo:true,overlays:true,sceneSwitching:false,cooldownSec:60,mode:'reality_tv'};
const action:ProposedAction={id:'a',sessionId:'s',type:'overlay.show',args:{text:'Chat chooses the next challenge'},reason:'Three audience requests',evidenceEventIds:['e1','e2','e3'],risk:'low',requiresApproval:false,status:'proposed'};
test('policy only preauthorizes low-risk permitted actions after cooldown',()=>{
 assert.equal(checkPolicy(action,settings,false,0,100000).allowed,true);
 assert.equal(checkPolicy(action,settings,true,0,100000).allowed,false);
 assert.equal(checkPolicy(action,{...settings,overlays:false},false,0,100000).allowed,false);
 assert.equal(checkPolicy({...action,risk:'high'},settings,false,0,100000).allowed,false);
 assert.equal(checkPolicy({...action,requiresApproval:true},settings,false,0,100000).allowed,false);
 for(const type of ['obs.switch_scene','twitch.update_metadata','twitch.create_poll'] as const)assert.equal(checkPolicy({...action,type}, {...settings,sceneSwitching:true},false,0,100000).allowed,false);
 assert.equal(checkPolicy(action,settings,false,50000,109999).allowed,false);
 assert.equal(checkPolicy(action,settings,false,50000,110000).allowed,true);
});
test('all director modes retain privacy and permission restrictions',()=>{
 for(const mode of ['reality_tv','documentary','chill'] as const){
  for(const text of ['Call 415-555-1234','email me at private@example.com','Visit https://example.com','password: hunter2','123 Main Street','x'.repeat(241)]){
   assert.equal(checkPolicy({...action,args:{text}}, {...settings,mode},false,0,100000).allowed,false,`${mode}: ${text}`);
  }
  assert.equal(checkPolicy({...action,type:'obs.switch_scene'},{...settings,mode},false,0,100000).allowed,false);
 }
});
