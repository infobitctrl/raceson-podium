import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {PublicDirectory} from '@raceson/domain/rewards/public-directory';
import {readPublicDirectory,usePublicDirectory} from './publicDirectory';
const mocks=vi.hoisted(()=>({origin:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/public-env',()=>({assertPublicEnvironmentOrigin:mocks.origin,publicEnv:{rewardDemo:{chainId:31337,apiBaseUrl:'https://isolated.invalid/api'}}}));
const published:PublicDirectory={chainId:31337,sponsors:1,checkedAt:'2027-01-15T08:00:00.000Z',refreshStatus:'published',items:[{
 selection:null,publishedAt:'2026-10-01T00:00:00Z',verified:true,campaign:{id:'73000000-0000-4000-8000-000000000001',name:'Synthetic campaign',chainId:31337,budgetWei:'100',address:'0x'+'11'.repeat(20),fundingHash:'0x'+'bb'.repeat(32),blockNumber:'100',blockTimestamp:'1800000000',pots:[{slot:0,name:'Race',amountWei:'100',state:1,paused:false,allocatedWei:'0',paidWei:'0',remainingWei:'100',returnedWei:'0',claimDeadline:'0',groups:[{name:'Category',amountWei:'100'}]}]}}]};
const current:PublicDirectory={...published,refreshStatus:'current',items:published.items.map(i=>({...i,campaign:{...i.campaign,blockNumber:'101'}}))};
const response=(data:unknown)=>({ok:true,json:async()=>({data})});
function held<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const clients:QueryClient[]=[];
function wrapper(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return ({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(()=>{mocks.fetch.mockReset();mocks.origin.mockReset();vi.stubGlobal('fetch',mocks.fetch);});
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());vi.unstubAllGlobals();});
it('renders publications before a held live check and replaces them with verified updates',async()=>{
 const live=held<ReturnType<typeof response>>();mocks.fetch.mockResolvedValueOnce(response(published)).mockReturnValueOnce(live.promise);
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
 expect(result.current.data).toEqual(published);expect(result.current.isPending).toBe(false);expect(result.current.isFetching).toBe(true);
 await act(async()=>live.resolve(response(current)));
 await waitFor(()=>expect(result.current.data).toEqual(current));expect(result.current.isFetching).toBe(false);
});
it('retains dated publications on refresh failure and recovers on explicit retry',async()=>{
 mocks.fetch.mockResolvedValueOnce(response(published)).mockResolvedValueOnce({ok:false});
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.isError).toBe(true));
 expect(result.current.data).toEqual(published);expect(result.current.isPending).toBe(false);
 const old=held<ReturnType<typeof response>>();
 mocks.fetch.mockImplementation((url:string)=>url.endsWith('/snapshot')?old.promise:Promise.resolve(response(current)));
 await act(async()=>{await result.current.refetch();});
 await waitFor(()=>expect(result.current.data).toEqual(current));
 await act(async()=>old.resolve(response(published)));
 await waitFor(()=>expect(result.current.isFetching).toBe(false));expect(result.current.data).toEqual(current);expect(result.current.isError).toBe(false);
});
it('falls back to the live request when publication loading fails',async()=>{
 mocks.fetch.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce(response(current));
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.data).toEqual(current));expect(result.current.isError).toBe(false);
});
it('reports total failure without invented facts and supports recovery',async()=>{
 mocks.fetch.mockResolvedValue({ok:false});const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();expect(result.current.isPending).toBe(false);
 mocks.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/snapshot')?published:current)));
 await act(async()=>{await result.current.refetch();});await waitFor(()=>expect(result.current.data).toEqual(current));
});
it('event counts read publications without any live chain request',async()=>{
 mocks.fetch.mockResolvedValue(response(published));const {result}=renderHook(()=>usePublicDirectory('published'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.data).toEqual(published));expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.fetch.mock.calls[0][0]).toMatch(/\/snapshot$/);
});
it('private callers retain their original live-only request and cache',async()=>{
 mocks.fetch.mockResolvedValue(response(current));const {result}=renderHook(()=>usePublicDirectory(),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.data).toEqual(current));expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.fetch.mock.calls[0][0]).toBe('https://isolated.invalid/api/v1/rewards/public-campaigns');
});
it('shares both requests between public consumers',async()=>{
 mocks.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/snapshot')?published:current)));
 const {result}=renderHook(()=>[usePublicDirectory('browse'),usePublicDirectory('browse')],{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.every(q=>q.data?.refreshStatus==='current')).toBe(true));expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
it('omits credentials, bypasses caches and honors cancellation for publication reads',async()=>{
 mocks.fetch.mockResolvedValue(response(published));const abort=new AbortController();await readPublicDirectory(abort.signal,true);
 expect(mocks.fetch).toHaveBeenCalledWith('https://isolated.invalid/api/v1/rewards/public-campaigns/snapshot',expect.objectContaining({credentials:'omit',cache:'no-store',redirect:'error'}));
 abort.abort();expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each([{chainId:10143},{wallet:'private'},{refreshStatus:'current'},{items:[{...published.items[0],record:{secret:'private'}}]}])('rejects a foreign or private publication: %j',async patch=>{
 mocks.fetch.mockResolvedValue(response({...published,...patch}));await expect(readPublicDirectory(undefined,true)).rejects.toThrow();
});
