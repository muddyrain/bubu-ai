import { describe, expect, it, vi } from 'vitest';
import { OpenAIChatCompletionsAdapter } from './openai-chat-completions';
import type { TransportResponse } from './provider-transport';

const profile={baseUrl:'https://provider.example/v1',modelId:'fixture-model'};
const response=(content: unknown):TransportResponse=>({status:200,body:{choices:[{message:{role:'assistant',content}}]}});
describe('fixed Chat Completions probes with no executable tools',()=>{
  it('uses only a fixed short message and requires a valid model reply',async()=>{
    const post=vi.fn(async()=>response('OK'));
    expect(await new OpenAIChatCompletionsAdapter({post}).probe(profile,'fixture-only-key','connection',new AbortController().signal)).toBe('passed');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(profile.baseUrl,'fixture-only-key',expect.objectContaining({model:'fixture-model',stream:false,max_completion_tokens:64}),expect.any(AbortSignal));
  });
  it.each([null,''])('does not treat HTTP 200 as proof of model availability (%s)',async(content)=>{
    const adapter=new OpenAIChatCompletionsAdapter({post:vi.fn(async()=>response(content))});
    await expect(adapter.probe(profile,'fixture-only-key','connection',new AbortController().signal)).rejects.toThrow('PROTOCOL_ERROR');
  });
  it.each([[401,'AUTH_FAILED'],[403,'AUTH_FAILED'],[404,'MODEL_NOT_FOUND'],[429,'RATE_LIMITED'],[500,'NETWORK_FAILED'],[400,'PROTOCOL_ERROR']])('normalizes status %s',async(status,code)=>{
    const adapter=new OpenAIChatCompletionsAdapter({post:vi.fn(async()=>({status:Number(status),body:{error:{message:'private fixture-only-key'}}}))});
    await expect(adapter.probe(profile,'fixture-only-key','connection',new AbortController().signal)).rejects.toThrow(String(code));
  });
  it.each(['correct','wrong-nonce','malformed','missing'] as const)('checks actual tool arguments: %s',async(mode)=>{
    const post=vi.fn(async(_url:string,_key:string,body:object)=>{
      const request=body as {tools:{function:{parameters:{properties:{nonce:{enum:string[]}}}}}[]};
      const nonce=request.tools[0]!.function.parameters.properties.nonce.enum[0];
      return {status:200,body:{choices:[{message:{role:'assistant',content:null,...(mode==='missing'?{}:{tool_calls:[{
        id:'fixture-call',type:'function',function:{name:'bubu_capability_probe',arguments:mode==='malformed'?'{':JSON.stringify({nonce:mode==='correct'?nonce:'wrong'})},
      }]})}}]}};
    });
    const adapter=new OpenAIChatCompletionsAdapter({post});
    expect(await adapter.probe(profile,'fixture-only-key','tools',new AbortController().signal)).toBe(mode==='correct'?'supported':'unknown');
    expect(post).toHaveBeenCalledTimes(1); // No follow-up tool result or tool execution.
  });
  it('reports unsupported only for an explicit whitelisted capability error',async()=>{
    const adapter=new OpenAIChatCompletionsAdapter({post:vi.fn(async()=>({status:400,body:{error:{code:'unsupported_parameter',param:'tools'}}}))});
    expect(await adapter.probe(profile,'fixture-only-key','tools',new AbortController().signal)).toBe('unsupported');
  });
});
