import { vi } from 'vitest';
import type { ChatApi,ChatEvent,ChatEventPayload,ChatMessage,ChatRecipient,ChatSnapshot,ChatUpdate,SendPlan } from '../../../shared/chat';
import type { ProviderProfile } from '../../../shared/providers';
export const mockProfile=(name='示例模型'):ProviderProfile=>{
  const id=crypto.randomUUID(),now=new Date().toISOString();return{id,name,revision:1,protocol:'openai-compatible-chat-completions',baseUrl:'https://provider.example/v1',modelId:'mock-text',enabled:true,hasKey:true,createdAt:now,updatedAt:now,
    connection:{profileId:id,revision:1,requestId:crypto.randomUUID(),probeVersion:1,outcome:'passed',checkedAt:now}};
};
export function chatMock(initial:ChatSnapshot[]=[]){
  const data=new Map(initial.map(s=>[s.conversation.id,structuredClone(s)]));let selected=mockProfile(),subId='',callback:((e:ChatUpdate)=>void)|undefined,currentId='';
  const plans=new Map<string,SendPlan>(),texts=new Map<string,string>();let activePlan:SendPlan|undefined;
  const fresh=():ChatSnapshot=>{const now=new Date().toISOString();return{sessionId:crypto.randomUUID(),conversation:{schemaVersion:1,id:crypto.randomUUID(),revision:1,title:'新对话',createdAt:now,updatedAt:now,lastRecipient:null,messages:[]},watermark:{runId:null,seq:0},active:null,persistence:'saved'};};
  const recipient=():ChatRecipient=>({providerId:selected.id,revision:selected.revision,name:selected.name,baseUrl:selected.baseUrl,origin:new URL(selected.baseUrl).origin,modelId:selected.modelId});
  const emit=(payload:ChatEventPayload)=>{
    const s=data.get(currentId)!,m=s.conversation.messages.at(-1)!;callback?.(structuredClone({...payload,sessionId:s.sessionId,subscriptionId:subId,conversationId:currentId,requestId:m.requestId,runId:m.runId,seq:m.seq,revision:s.conversation.revision} as ChatEvent));
  };
  const end=(status:'completed'|'failed'|'stopped'='completed',persisted=true,errorCode?:ChatMessage['errorCode'])=>{
    const s=data.get(currentId)!,m=s.conversation.messages.at(-1)!;m.seq++;m.status=status;if(status==='completed')m.finishReason='stop';else m.errorCode=errorCode??(status==='stopped'?'CANCELLED':'NETWORK_FAILED');
    s.conversation.revision++;s.active=null;s.persistence=persisted?'saved':'failed';s.watermark={runId:m.runId,seq:m.seq};emit({type:status,message:structuredClone(m),persisted});
  };
  const api={
    list:vi.fn<ChatApi['list']>(async()=>({ok:true,value:[...data.values()].map(s=>({id:s.conversation.id,title:s.conversation.title,revision:s.conversation.revision,updatedAt:s.conversation.updatedAt,messageCount:s.conversation.messages.length}))})),
    create:vi.fn<ChatApi['create']>(async()=>{const s=fresh();data.set(s.conversation.id,s);return{ok:true,value:structuredClone(s)};}),
    remove:vi.fn<ChatApi['remove']>(async({conversationId})=>{data.delete(conversationId);return{ok:true,value:undefined};}),
    subscribe:vi.fn<ChatApi['subscribe']>(async({conversationId},cb)=>{currentId=conversationId;subId=crypto.randomUUID();callback=cb;return{ok:true,value:{subscriptionId:subId,snapshot:structuredClone(data.get(conversationId)!)}};}),
    unsubscribe:vi.fn<ChatApi['unsubscribe']>(async()=>{callback=undefined;return{ok:true,value:undefined};}),
    snapshot:vi.fn<ChatApi['snapshot']>(async({conversationId})=>({ok:true,value:structuredClone(data.get(conversationId)!)})),
    prepareSend:vi.fn<ChatApi['prepareSend']>(async(input)=>{
      const s=data.get(input.conversationId)!,r=recipient(),old=s.conversation.messages.filter(m=>m.role==='assistant'&&m.status==='completed').length;
      const plan:SendPlan={id:crypto.randomUUID(),requestId:input.requestId,conversationId:input.conversationId,conversationRevision:input.expectedRevision,recipient:r,expiresAt:Date.now()+60_000,requiresConsent:old>0&&s.conversation.lastRecipient?.providerId!==r.providerId,
        disclosure:{userMessages:old+1,assistantMessages:old,utf8Bytes:1234,digest:'mock',currentInputIncluded:true}};
      plans.set(plan.id,plan);texts.set(plan.id,input.text);return{ok:true,value:plan};
    }),
    send:vi.fn<ChatApi['send']>(async({planId})=>{
      const p=plans.get(planId)!;activePlan=p;const s=data.get(p.conversationId)!,runId=crypto.randomUUID(),time=new Date().toISOString();
      const common={requestId:p.requestId,runId,recipient:p.recipient,createdAt:time,updatedAt:time};
      const user:ChatMessage={...common,id:crypto.randomUUID(),role:'user',status:'completed',text:texts.get(planId)!,seq:0};
      const assistant:ChatMessage={...common,id:crypto.randomUUID(),role:'assistant',status:'pending',text:'',seq:1};
      s.conversation.messages.push(user,assistant);s.conversation.title=user.text.slice(0,30);s.conversation.revision++;s.conversation.lastRecipient=p.recipient;
      s.active={requestId:p.requestId,runId,phase:'preparing'};s.watermark={runId,seq:1};s.persistence='pending';emit({type:'started',user,message:assistant,title:s.conversation.title});
      return{ok:true,value:{requestId:p.requestId,runId}};
    }),
    cancel:vi.fn<ChatApi['cancel']>(async()=>{
      const s=data.get(currentId);if(s?.active?.phase==='committing')return{ok:true,value:{status:'committing'}};
      if(s?.active)end('stopped');return{ok:true,value:{status:'stopping'}};
    }),
  };
  return {api,data,fresh,profile:()=>selected,select:(p:ProviderProfile)=>{selected=p;},activePlan:()=>activePlan,
    text:(text:string)=>{const s=data.get(currentId)!,m=s.conversation.messages.at(-1)!;m.text+=text;m.status='streaming';m.seq++;s.active!.phase='streaming';s.watermark={runId:m.runId,seq:m.seq};emit({type:'delta',text});},end,
    waiting:()=>{const s=data.get(currentId)!;s.conversation.messages.at(-1)!.seq++;s.watermark.seq++;emit({type:'waiting'});},
    committing:()=>{data.get(currentId)!.active!.phase='committing';},
    update:(e:ChatUpdate)=>callback?.(e), lastEventBase:()=>{const s=data.get(currentId)!,m=s.conversation.messages.at(-1)!;return{sessionId:s.sessionId,subscriptionId:subId,conversationId:currentId,requestId:m.requestId,runId:m.runId,seq:m.seq,revision:s.conversation.revision};}};
}
