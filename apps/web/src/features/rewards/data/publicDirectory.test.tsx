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

it('preloads recently verified summaries without a live request and allows an explicit new check',async()=>{
 const now=Math.floor(Date.now()/1000),fresh={...published,checkedAt:new Date(now*1000).toISOString(),items:published.items.map(i=>({...i,campaign:{...i.campaign,blockTimestamp:String(now)}}))};
 mocks.fetch.mockResolvedValue(response(fresh));
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.data).toEqual(fresh));expect(result.current.isPending).toBe(false);
 expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(result.current.isFetching).toBe(false);
 mocks.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/snapshot')?fresh:{...fresh,refreshStatus:'current'})));
 await act(async()=>{await result.current.refetch();});
 expect(mocks.fetch.mock.calls.some(([url])=>!url.endsWith('/snapshot'))).toBe(true);
});

it('polls completed card updates before the full request finishes and retains them after failure',async()=>{
 const live=held<ReturnType<typeof response>>();let reads=0;
 const progress={...current,refreshStatus:'published',items:current.items.map(i=>({...i,campaign:{...i.campaign,blockTimestamp:'1800000010',pots:i.campaign.pots.map(p=>({...p,allocatedWei:'80',paidWei:'30',remainingWei:'70',state:3,claimDeadline:'1800010000'}))}})),checkedAt:'2027-01-15T08:00:10.000Z'};
 mocks.fetch.mockImplementation((url:string)=>url.endsWith('/snapshot')?Promise.resolve(response(++reads===1?published:progress)):live.promise);
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
 expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('0');
 await waitFor(()=>expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('30'),{timeout:6000});
 expect(result.current.isFetching).toBe(true);
 await act(async()=>live.resolve({ok:false} as ReturnType<typeof response>));
 await waitFor(()=>expect(result.current.isError).toBe(true));
 expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('30');expect(result.current.data?.checkedAt).toBe(progress.checkedAt);
 // A later cache miss must not reset already observed payments to publication zeros.
 mocks.fetch.mockResolvedValue(response(published));
 await act(async()=>{await clients.at(-1)!.refetchQueries({queryKey:['podium-published-directory']});});
 expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('30');
},10000);

it('removes withdrawn publications even when an older complete live response arrives later',async()=>{
 const live=held<ReturnType<typeof response>>();mocks.fetch.mockResolvedValueOnce(response(published)).mockReturnValueOnce(live.promise);
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(mocks.fetch).toHaveBeenCalledTimes(2));
 mocks.fetch.mockResolvedValue(response({...published,items:[],sponsors:0}));
 await act(async()=>{await clients.at(-1)!.refetchQueries({queryKey:['podium-published-directory']});});
 await act(async()=>live.resolve(response(current)));
 await waitFor(()=>expect(result.current.isFetching).toBe(false));expect(result.current.data?.items).toEqual([]);
});

it('retains the last full result if a later server loses its cache and returns older failed observations',async()=>{
 const paid={...current,items:current.items.map(i=>({...i,campaign:{...i.campaign,pots:i.campaign.pots.map(p=>({...p,allocatedWei:'80',paidWei:'30',remainingWei:'70'}))}}))};
 mocks.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/snapshot')?published:paid)));
 const {result}=renderHook(()=>usePublicDirectory('browse'),{wrapper:wrapper()});
 await waitFor(()=>expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('30'));
 mocks.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/snapshot')?published:{...published,refreshStatus:'failed'})));
 await act(async()=>{await result.current.refetch();});
 await waitFor(()=>expect(result.current.data?.refreshStatus).toBe('failed'));expect(result.current.data?.items[0].campaign.pots[0].paidWei).toBe('30');
 expect(result.current.data?.items[0].campaign.blockNumber).toBe('101');
});
