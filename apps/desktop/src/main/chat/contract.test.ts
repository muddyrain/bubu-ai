import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { applyChatEvent,isChatEvent,isChatSnapshot } from '../../shared/chat';
import type { ChatEvent } from '../../shared/chat';
import { recipient,snapshot } from './test-helpers';
function events(){
  const initial=snapshot(),requestId=randomUUID(),runId=randomUUID(),subscriptionId=randomUUID(),time=new Date().toISOString();
  const message={id:randomUUID(),requestId,runId,role:'assistant' as const,text:'',status:'pending' as const,seq:1,recipient:recipient(),createdAt:time,updatedAt:time};
  const base={sessionId:initial.sessionId,subscriptionId,conversationId:initial.conversation.id,requestId,runId,revision:2};
  const first:ChatEvent={...base,seq:1,type:'started',title:'hello',
    user:{...message,id:randomUUID(),role:'user',text:'hello',status:'completed',seq:0},message};
  return {initial,first,base};
}
describe('shared chat event contract',()=>{
  it('applies waiting, deltas and exactly one terminal; rejects gaps, duplicate and unrelated runs',()=>{
    const {initial,first,base}=events();expect(isChatSnapshot(initial)).toBe(true);expect(isChatEvent(first)).toBe(true);
    let current=applyChatEvent(initial,first).snapshot;
    const waiting:ChatEvent={...base,type:'waiting',seq:2};current=applyChatEvent(current,waiting).snapshot;expect(current.conversation.messages.at(-1)?.seq).toBe(2);
    const delta:ChatEvent={...base,type:'delta',seq:3,text:'response'};current=applyChatEvent(current,delta).snapshot;expect(current.active?.phase).toBe('streaming');
    const terminal:ChatEvent={...base,type:'completed',seq:4,revision:3,message:{...first.message,text:'response',status:'completed',finishReason:'stop',seq:4},persisted:true};
    expect(isChatEvent(terminal)).toBe(true);current=applyChatEvent(current,terminal).snapshot;expect(current.active).toBeNull();expect(current.persistence).toBe('saved');
    expect(applyChatEvent(current,terminal).state).toBe('duplicate');expect(applyChatEvent(current,{...delta,sessionId:randomUUID()}).state).toBe('irrelevant');
    expect(applyChatEvent(current,{...delta,runId:randomUUID()}).state).toBe('gap');
  });
  it('refuses unknown secret fields, mismatched IDs and inconsistent sequences',()=>{
    const {initial,first}=events();expect(isChatSnapshot({...initial,apiKey:'mock'})).toBe(false);
    expect(isChatSnapshot({...initial,conversation:{...initial.conversation,credentialRef:'mock'}})).toBe(false);
    expect(isChatEvent({...first,message:{...first.message,key:'mock'}})).toBe(false);
    expect(isChatEvent({...first,message:{...first.message,requestId:randomUUID()}})).toBe(false);
    expect(isChatEvent({...first,seq:2})).toBe(false);
    expect(isChatEvent({type:'delta',text:'missing identity'})).toBe(false);
  });
});
