import {afterEach,expect,it,vi} from 'vitest';
import {createControllerRequest} from './controller';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('bounds a stalled token lookup and does not send after a late token arrives',async()=>{
 vi.useFakeTimers();let token!:(value:string)=>void;
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const request=createControllerRequest(()=>new Promise(resolve=>{token=resolve;}),()=>true);
 const result=request('/session');const rejected=expect(result).rejects.toThrow('controller_request_timeout');
 await vi.advanceTimersByTimeAsync(45_000);await rejected;
 token('synthetic-token');await vi.advanceTimersByTimeAsync(1);
 expect(fetch).not.toHaveBeenCalled();
});
it('ends a stalled response body read and allows a fresh explicit retry',async()=>{
 vi.useFakeTimers();const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:()=>new Promise(()=>{})})
 .mockResolvedValueOnce({ok:true,json:async()=>({data:{ready:true}})});vi.stubGlobal('fetch',fetch);
 const request=createControllerRequest(async()=>'synthetic-token',()=>true);
 const result=request('/campaigns');const rejected=expect(result).rejects.toThrow('controller_request_timeout');
 await vi.advanceTimersByTimeAsync(45_000);await rejected;
 expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(await request('/campaigns')).toEqual({ready:true});
});
it('reports an ambiguous signed submission without retrying or declaring failure on chain',async()=>{
 vi.useFakeTimers();const fetch=vi.fn(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetch);
 const request=createControllerRequest(async()=>'synthetic-token',()=>true);
 const result=request('/transactions',{action:'submit',id:'synthetic-job',signedTransaction:'synthetic-signed-data'});
 const rejected=expect(result).rejects.toThrow('controller_submission_unknown');
 await vi.advanceTimersByTimeAsync(89_999);expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(1);await rejected;expect(fetch).toHaveBeenCalledTimes(1);
});
it('retains server errors and rejects a changed session after the response',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:false,json:async()=>({error:{code:'controller_source_not_ready'}})});vi.stubGlobal('fetch',fetch);
 const request=createControllerRequest(async()=>'synthetic-token',()=>true);
 await expect(request('/campaigns')).rejects.toThrow('controller_source_not_ready');
 let current=true;fetch.mockResolvedValue({ok:true,json:async()=>{current=false;return {data:{private:true}};}});
 await expect(createControllerRequest(async()=>'synthetic-token',()=>current)('/campaigns')).rejects.toThrow('controller_session_changed');
});
it('native claim transport permits exact bounded paths and refuses query or identity overrides before token lookup',async()=>{
 const id='7d000000-0000-4000-8000-000000000009',token=vi.fn(async()=>'synthetic-token'),fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{scoped:true}})});vi.stubGlobal('fetch',fetch);
 const request=createControllerRequest(token,()=>true);
 await request(`/claims?approvalId=${id}`);await request(`/claims?approvalId=${id}&after=${id}`);await request(`/claims/${id}`,{action:'operator',signature:'synthetic'});
 expect(token).toHaveBeenCalledTimes(3);
 for(const path of ['/claims',`/claims?approvalId=${id}&actor=wrong`,`/claims?approvalId=${id}&approvalId=${id}`,`/claims/${id}?wallet=wrong`])await expect(request(path)).rejects.toThrow('controller_session_changed');
 await expect(request(`/claims?approvalId=${id}`,{})).rejects.toThrow('controller_session_changed');expect(token).toHaveBeenCalledTimes(3);
});
