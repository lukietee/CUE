import { randomUUID } from 'node:crypto';
import { ActionSchema, PlanSchema, type DirectorEvent, type DirectorMode, type ProposedAction, type StreamPlan } from '../shared/index.ts';
export function createPlan(brief:string, mode:DirectorMode):StreamPlan {
 const gaming=/gam(e|ing)|minecraft|valorant/i.test(brief);
 return PlanSchema.parse({id:randomUUID(),brief,title:brief.trim().replace(/\s+/g,' ').slice(0,100),categoryName:gaming?'Games + Demos':'Just Chatting',tags:['English',gaming?'Gaming':'Interactive','Community'],mode,segments:[{id:randomUUID(),name:'The warm-up',goal:'Welcome chat and introduce today’s plan',durationMin:5},{id:randomUUID(),name:gaming?'The main challenge':'Into the story',goal:brief.slice(0,300),durationMin:30},{id:randomUUID(),name:'Chat takes the wheel',goal:'Invite a vote and try the audience’s favorite idea',durationMin:10},{id:randomUUID(),name:'One more thing',goal:'Recap the best moment and preview next stream',durationMin:5}]});
}
export function parsePlan(value:unknown){return PlanSchema.parse(value)}
export function proposeAction(plan:StreamPlan,events:DirectorEvent[],sessionId:string,now=Date.now()):ProposedAction|null {
 const recent=events.filter(e=>e.kind==='chat.message'&&now-Date.parse(e.ts)<60000&&now>=Date.parse(e.ts));
 const topics=[{word:'challenge',pattern:/\b(challenge|dare)\b/i},{word:'question',pattern:/\b(question|q&a|ask)\b/i},{word:'snack',pattern:/\b(snack|food|eat)\b/i}];
 const topic=topics.map(t=>({...t,evidence:recent.filter(e=>t.pattern.test(String(e.payload.text??'')))})).find(t=>t.evidence.length>=3);
 if(!topic)return null;
 const text=plan.mode==='documentary'?`The audience is curious about a ${topic.word}. Let’s explore it together.`:plan.mode==='chill'?`Chat check-in: up for a ${topic.word}?`:`CHAT DECIDES · Ready for a ${topic.word}?`;
 return ActionSchema.parse({id:randomUUID(),sessionId,type:'overlay.show',args:{text,template:'chat_question',mode:plan.mode},reason:`${topic.evidence.length} chat messages mentioned “${topic.word}” in the last minute. Invite participation with a contextual cue.`,evidenceEventIds:topic.evidence.map(e=>e.id),risk:'low',requiresApproval:false,status:'proposed'});
}
