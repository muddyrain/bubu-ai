import { useCallback, useEffect, useRef, useState } from 'react';
import { applyChatEvent } from '../../../shared/chat';
import type { ChatApi, ChatErrorCode, ChatResult, ChatSnapshot, ChatUpdate, ConversationSummary, SendPlan } from '../../../shared/chat';

function value<T>(result: ChatResult<T>): T { if (!result.ok) throw result.error.code; return result.value; }
const code = (error: unknown): ChatErrorCode => typeof error === 'string' ? error as ChatErrorCode : 'NETWORK_FAILED';
export function useChat(enabled: boolean) {
  const [api] = useState<ChatApi>(()=>window.bubu.chat);
  const [sessions, setSessions] = useState<ConversationSummary[]>([]);
  const [snapshot, setSnapshot] = useState<ChatSnapshot>();
  const [loading, setLoading] = useState(true), [error, setError] = useState<ChatErrorCode>();
  const [draft, setDraftState] = useState(''), [plan, setPlan] = useState<SendPlan>();
  const [waiting,setWaiting]=useState(false),[focusKey,setFocusKey]=useState(0);
  const [phase, setPhaseState] = useState<'preparing'|'generating'|'stopping'|'committing'>();
  const epoch = useRef(0), live = useRef(false), current = useRef<ChatSnapshot | undefined>(undefined);
  const subscription = useRef<string | undefined>(undefined), selected = useRef<string | undefined>(undefined);
  const request = useRef<string | undefined>(undefined), cancelled = useRef(false), lock = useRef(false);
  const drafts = useRef(new Map<string,string>()), draftRef = useRef(''), planRef = useRef<SendPlan | undefined>(undefined);
  const phaseRef = useRef<typeof phase>(undefined), listEpoch = useRef(0), recovering = useRef(false);
  const setPhase = useCallback((p: typeof phase) => { phaseRef.current=p;setPhaseState(p); },[]);
  const setDraft = useCallback((text:string) => { draftRef.current=text;setDraftState(text);drafts.current.set(selected.current??'new',text); },[]);
  const refresh = useCallback(async () => {
    const generation=++listEpoch.current;
    try { const list=value(await api.list());if(live.current&&generation===listEpoch.current)setSessions(list); }
    catch(e){if(live.current&&generation===listEpoch.current)setError(code(e));}
  },[api]);
  const publish = useCallback((next:ChatSnapshot) => {
    const previous=current.current;
    if(previous?.sessionId===next.sessionId&&previous.conversation.id===next.conversation.id&&
      (next.conversation.revision<previous.conversation.revision||next.watermark.runId===previous.watermark.runId&&next.watermark.seq<previous.watermark.seq))return;
    current.current=next;setSnapshot(next);
    if(next.conversation.messages.at(-1)?.text||!next.active)setWaiting(false);
    const active=next.active;
    if(active){request.current=active.requestId;if(phaseRef.current!=='stopping'||active.phase==='committing')setPhase(active.phase==='committing'?'committing':'generating');}
    else if(!lock.current&&!planRef.current){request.current=undefined;setPhase(undefined);void refresh();}
  },[refresh,setPhase]);
  const recover = useCallback(async () => {
    const id=selected.current,generation=epoch.current;if(!id||recovering.current)return;
    recovering.current=true;
    try{const next=value(await api.snapshot({conversationId:id}));if(live.current&&epoch.current===generation)publish(next);}
    catch(e){if(live.current&&epoch.current===generation)setError(code(e));}
    finally{recovering.current=false;}
  },[api,publish]);
  const update = useCallback((event:ChatUpdate) => {
    const previous=current.current;if(!previous)return;
    if(event.type==='resync'){
      if(event.subscriptionId===subscription.current&&event.snapshot.sessionId===previous.sessionId&&event.snapshot.conversation.id===previous.conversation.id)publish(event.snapshot);
      return;
    }
    if(event.subscriptionId!==subscription.current)return;
    const result=applyChatEvent(previous,event);
    if(result.state==='gap'){void recover();return;}
    if(result.state!=='applied')return;
    if(event.type==='waiting')setWaiting(true);else setWaiting(false);
    if(event.type==='started')setDraft('');
    publish(result.snapshot);
    if(event.type==='failed'||event.type==='completed'||event.type==='stopped'){
      request.current=undefined;lock.current=false;setPhase(undefined);void refresh();
    }
  },[publish,recover,refresh,setDraft,setPhase]);
  const release = useCallback(() => {
    epoch.current++;const id=subscription.current;subscription.current=undefined;
    if(id)void api.unsubscribe({subscriptionId:id}).catch(()=>{});
  },[api]);
  const attach = useCallback(async (id:string) => {
    release();const generation=epoch.current;selected.current=id;setLoading(true);
    const early:ChatUpdate[]=[];let ready=false,overflow=false;
    const result=await api.subscribe({conversationId:id},(event)=>{
      if(!live.current||epoch.current!==generation)return;
      if(!ready){if(early.length<128)early.push(event);else overflow=true;}else update(event);
    }).catch(()=>({ok:false,error:{code:'NETWORK_FAILED'}} as const));
    if(!live.current||epoch.current!==generation){if(result.ok)void api.unsubscribe({subscriptionId:result.value.subscriptionId}).catch(()=>{});return false;}
    if(!result.ok){current.current=undefined;selected.current=undefined;setSnapshot(undefined);setError(result.error.code);setLoading(false);return false;}
    subscription.current=result.value.subscriptionId;publish(result.value.snapshot);ready=true;
    if(overflow)await recover();else for(const event of early)update(event);
    setDraft(drafts.current.get(id)??'');setLoading(false);return true;
  },[api,publish,recover,release,setDraft,update]);
  useEffect(()=>{
    live.current=enabled;if(!enabled)return;
    let disposed=false;
    void(async()=>{
      await Promise.resolve();if(disposed)return;setLoading(true);
      try{
        const list=value(await api.list());if(disposed)return;setSessions(list);
        const id=selected.current&&list.some(s=>s.id===selected.current)?selected.current:list[0]?.id;
        if(id)await attach(id);else{current.current=undefined;setSnapshot(undefined);selected.current=undefined;setLoading(false);}
      }catch(e){if(!disposed){setError(code(e));setLoading(false);}}
    })();
    return()=>{disposed=true;live.current=false;release();};
    // Subscription lifetime depends on the view, never on changing snapshots/drafts.
  },[api,attach,enabled,release]);
  const running=Boolean(phase);
  useEffect(()=>{if(!enabled||!running)return;const timer=setInterval(()=>{void recover();},1000);return()=>clearInterval(timer);},[enabled,running,recover]);
  const create = useCallback(async () => {
    if(lock.current||request.current)return false;lock.current=true;setError(undefined);
    try{const next=value(await api.create());if(!live.current)return false;await refresh();const ok=await attach(next.conversation.id);if(ok)setFocusKey(v=>v+1);return ok;}
    catch(e){if(live.current)setError(code(e));return false;}finally{lock.current=false;}
  },[api,attach,refresh]);
  const open = useCallback(async(id:string)=>{
    if(id===selected.current&&subscription.current)return true;if(lock.current||request.current)return false;
    setError(undefined);const ok=await attach(id);if(ok)setFocusKey(v=>v+1);return ok;
  },[attach]);
  const dispatch = useCallback(async (prepared:SendPlan, accepted:boolean) => {
    if(!subscription.current||cancelled.current)return;
    const generation=epoch.current;
    planRef.current=undefined;setPlan(undefined);request.current=prepared.requestId;lock.current=true;setPhase('generating');
    try{
      value(await api.send({planId:prepared.id,subscriptionId:subscription.current,...(accepted?{accepted:true}: {})}));
      // An admission receipt is not a terminal event. Keep waiting for events/snapshot.
    }catch(e){if(live.current&&epoch.current===generation&&request.current===prepared.requestId){
      setError(code(e));lock.current=false;
      // A failed receipt cannot revoke an admitted run. Only authoritative
      // recovery/terminal events may release it; failed recovery stays stoppable.
      await recover();
    }}
    finally{if(!request.current||request.current===prepared.requestId)lock.current=false;}
  },[api,recover,setPhase]);
  const send = useCallback(async () => {
    if(lock.current||request.current||!draftRef.current.trim())return;
    const text=draftRef.current;
    let sendingId:string|undefined;
    lock.current=true;cancelled.current=false;setError(undefined);setPhase('preparing');
    try{
      if(!selected.current){const created=value(await api.create());await refresh();if(!await attach(created.conversation.id))return;setDraft(text);}
      if(!live.current||cancelled.current||!current.current||!subscription.current)return;
      const id=crypto.randomUUID();sendingId=id;request.current=id;setPhase('preparing');
      const generation=epoch.current;
      const prepared=value(await api.prepareSend({conversationId:current.current.conversation.id,expectedRevision:current.current.conversation.revision,requestId:id,text}));
      if(!live.current||epoch.current!==generation||cancelled.current||request.current!==id){
        void api.cancel({requestId:id}).catch(()=>{});
        if(live.current&&epoch.current===generation&&request.current===id){
          request.current=undefined;planRef.current=undefined;setPlan(undefined);setPhase(undefined);
        }
        return;
      }
      if(prepared.requiresConsent){planRef.current=prepared;setPlan(prepared);return;}
      await dispatch(prepared,false);
    }catch(e){if(live.current&&(!sendingId||request.current===sendingId)){setError(code(e));request.current=undefined;setPhase(undefined);}}
    finally{if(!request.current||request.current===sendingId)lock.current=false;if(live.current&&!request.current&&!planRef.current)setPhase(undefined);}
  },[api,attach,dispatch,refresh,setDraft,setPhase]);
  const cancel = useCallback(async () => {
    cancelled.current=true;const id=request.current;if(!id)return true;
    try{
      const result=value(await api.cancel({requestId:id}));if(!live.current)return false;
      if(request.current!==id)return true;
      if(planRef.current){planRef.current=undefined;setPlan(undefined);request.current=undefined;setPhase(undefined);return true;}
      setPhase(result.status==='committing'?'committing':'stopping');await recover();return true;
    }catch(e){if(live.current)setError(code(e));return false;}
  },[api,recover,setPhase]);
  const settle = useCallback(async () => {
    if(!request.current&&!lock.current)return true;
    if(!await cancel())return false;
    const deadline=Date.now()+30_000;
    while(live.current&&Date.now()<deadline){
      if(!request.current&&!lock.current)return true;
      await recover();if(!request.current&&!lock.current)return true;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(live.current)setError('BUSY');return false;
  },[cancel,recover]);
  const remove = useCallback(async(id:string)=>{
    if(request.current||lock.current)return false;
    lock.current=true;setError(undefined);
    try{
      const next=value(await api.snapshot({conversationId:id}));value(await api.remove({conversationId:id,expectedRevision:next.conversation.revision}));drafts.current.delete(id);
      if(selected.current===id){release();selected.current=undefined;current.current=undefined;setSnapshot(undefined);setDraft('');}
      await refresh();return true;
    }catch(e){if(live.current)setError(code(e));return false;}finally{lock.current=false;}
  },[api,refresh,release,setDraft]);
  return {sessions,snapshot,loading,error,draft,setDraft,plan,phase,waiting,focusKey,busy:Boolean(phase),send,cancel,settle,create,open,remove,
    confirmPlan:()=>{const p=planRef.current;if(p&&!lock.current)void dispatch(p,true);},
    dismissError:()=>setError(undefined)};
}
export type ChatState = ReturnType<typeof useChat>;
