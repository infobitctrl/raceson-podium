import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {usePublicCampaignRewards} from './usePublicCampaignRewards';
import {cancelPublicRewardLoads, loadCachedRewardCollection} from './publicRewardCollection';

const read = vi.hoisted(() => vi.fn());
vi.mock('../data/publicCampaign', () => ({readPublicRewards: read}));
const id = '72000000-0000-4000-8000-000000000001';
function page(offset: number, total = 2741, campaignId = id, slot = 1): PublicRewardPage {
  return {campaignId, slot, chainId: 31337, blockNumber: '100', blockTimestamp: '1800000000', total, offset,
    sort: 'reward', direction: 'asc', availability: 'open',
    rows: Array.from({length: Math.min(500, total - offset)}, (_, index) => ({
      id: `0x${(offset + index + 1).toString(16).padStart(64, '0')}`, number: offset + index + 1,
      kind: 'athlete', amountWei: '1', status: 'unclaimed',
    }))};
}
beforeEach(() => {read.mockReset(); vi.useFakeTimers();});
afterEach(() => vi.useRealTimers());
it('verifies 2741 rewards in three request waves with at most four pages in flight', async () => {
  let active = 0, peak = 0;
  read.mockImplementation(async (_id, _slot, offset) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1000));
    active--;
    return page(offset);
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {await vi.advanceTimersByTimeAsync(2999);});
  expect(result.current.page).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(result.current.busy).toBe(false);
  expect(result.current.failed).toBe(false);
  expect(result.current.page?.rows.map(row => row.number)).toEqual(Array.from({length: 2741}, (_, i) => i + 1));
  expect(read).toHaveBeenCalledTimes(6);
  expect(peak).toBe(4);
  expect(read.mock.calls.slice(1).every(call => call[6] === '100')).toBe(true);
  expect(read.mock.calls.every(call => call[7] === 500)).toBe(true);
});
it('keeps reward order when later pages complete first', async () => {
  read.mockImplementation(async (_id, _slot, offset) => {
    await new Promise(resolve => setTimeout(resolve, offset === 500 ? 50 : 1));
    return page(offset, 1501);
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {await vi.advanceTimersByTimeAsync(50);});
  expect(result.current.page).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(result.current.page?.rows.map(row => row.number)).toEqual(Array.from({length: 1501}, (_, i) => i + 1));
});
it.each(['total', 'availability', 'blockNumber', 'blockTimestamp', 'duplicate-id', 'duplicate-number', 'missing-row'])('rejects %s changes without publishing partial rewards', async change => {
  read.mockImplementation(async (_id, _slot, offset) => {
    const next = page(offset, 1001);
    if (offset === 500) {
      if (change === 'total') next.total++;
      if (change === 'availability') next.availability = 'paused';
      if (change === 'blockNumber') next.blockNumber = '101';
      if (change === 'blockTimestamp') next.blockTimestamp = '1800000001';
      if (change === 'duplicate-id') next.rows[0].id = page(0).rows[0].id;
      if (change === 'duplicate-number') next.rows[0].number = 1;
      if (change === 'missing-row') next.rows.pop();
    }
    return next;
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {});
  expect(result.current).toMatchObject({page: null, busy: false, failed: true});
  expect(read.mock.calls.every(call => call[5].aborted)).toBe(true);
});
it('aborts outstanding requests on failure, stops scheduling and retries from a fresh block', async () => {
  read.mockImplementation(async (_id, _slot, offset) => {
    if (offset === 0) return page(0);
    if (offset === 500) throw Error('provider unavailable');
    return new Promise(() => {});
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {});
  expect(result.current).toMatchObject({page: null, busy: false, failed: true});
  expect(read).toHaveBeenCalledTimes(5);
  expect(read.mock.calls.every(call => call[5].aborted)).toBe(true);
  read.mockImplementation(async (_id, _slot, offset) => ({...page(offset, 501), blockNumber: '110'}));
  await act(async () => result.current.retry());
  expect(result.current.page?.rows).toHaveLength(501);
  expect(result.current.page?.blockNumber).toBe('110');
  expect(read.mock.calls[5][6]).toBeUndefined();
  expect(read.mock.calls[6][6]).toBe('110');
});
it.each(['campaign', 'slot', 'refresh', 'disabled', 'unmount'])('aborts and ignores old requests after %s changes', async change => {
  let finish!: (value: PublicRewardPage) => void;
  read.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}))
    .mockImplementation(async (campaignId, slot, offset) => page(offset, 1, campaignId, slot));
  const props = {campaignId: id, slot: 1, refresh: 0, enabled: true};
  const {result, rerender, unmount} = renderHook(p => usePublicCampaignRewards(p.campaignId, p.slot, p.refresh, p.enabled), {initialProps: props});
  const signal = read.mock.calls[0][5];
  if (change === 'unmount') unmount();
  else rerender({...props, ...(change === 'campaign' ? {campaignId: '72000000-0000-4000-8000-000000000002'}
    : change === 'slot' ? {slot: 2} : change === 'refresh' ? {refresh: 1} : {enabled: false})});
  expect(signal.aborted).toBe(true);
  await act(async () => {finish(page(0));});
  expect(read.mock.calls.every(call => call[2] === 0)).toBe(true);
  if (change !== 'unmount' && change !== 'disabled') expect(result.current.page?.total).toBe(1);
  else expect(result.current.page).toBeNull();
});
it.each([0, 1, 25, 100, 302, 500])('fetches a %i-row collection once without speculative pages', async total => {
  read.mockResolvedValue(page(0, total));
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {});
  expect(read).toHaveBeenCalledOnce();
  expect(result.current.page?.rows).toHaveLength(total);
});
it('does not load a disabled view', () => {
  renderHook(() => usePublicCampaignRewards(id, 1, 0, false));
  expect(read).not.toHaveBeenCalled();
});

it('uses a fresh campaign anchor for the initial page, but retry requests a new head', async () => {
  const anchor = {blockNumber: '100', receivedAt: Date.now()};
  read.mockRejectedValueOnce(Error('provider offline')).mockResolvedValue(page(0, 1));
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0, true, undefined, anchor));
  await act(async () => {}); expect(read.mock.calls[0][6]).toBe('100');
  await act(async () => result.current.retry()); expect(read.mock.calls[1][6]).toBeUndefined();
  expect(result.current.page?.total).toBe(1);
});
it('does not reuse an old campaign observation for a newly visited pot', async () => {
  const anchor = {blockNumber: '100', receivedAt: Date.now()-90_001};
  read.mockResolvedValue(page(0, 1));
  renderHook(() => usePublicCampaignRewards(id, 1, 0, true, undefined, anchor));
  await act(async () => {}); expect(read.mock.calls[0][6]).toBeUndefined();
});
it('shows a complete cached round immediately on revisit and retains it through a failed refresh', async () => {
  const cache: import('./usePublicCampaignRewards').PublicRewardCache = new Map();
  read.mockResolvedValueOnce(page(0, 501)).mockResolvedValueOnce(page(500, 501));
  const first = renderHook(() => usePublicCampaignRewards(id, 1, 0, true, cache));
  await act(async () => {}); expect(cache.get(`${id}:1`)?.page.rows).toHaveLength(501); first.unmount();
  await act(async () => {await vi.advanceTimersByTimeAsync(30_001);});
  let reject!: () => void;
  read.mockImplementationOnce(() => new Promise((_, fail) => {reject = () => fail(Error('offline'));}));
  const anchor = {blockNumber: '100', receivedAt: Date.now()};
  const revisit = renderHook(() => usePublicCampaignRewards(id, 1, 0, true, cache, anchor));
  expect(revisit.result.current.page?.rows).toHaveLength(501); expect(revisit.result.current.busy).toBe(true);
  expect(read.mock.calls[2][6]).toBeUndefined();
  await act(async () => reject());
  expect(revisit.result.current).toMatchObject({busy: false, failed: true, page: {blockNumber: '100', total: 501}});
  expect(cache.get(`${id}:1`)?.page.rows).toHaveLength(501);
});
it('isolates cached campaigns and pots, keeps only completed collections and bounds retained rounds', async () => {
  const cache: import('./usePublicCampaignRewards').PublicRewardCache = new Map();
  read.mockImplementation(async (campaignId, slot, offset) => page(offset, 1, campaignId, slot));
  const {result, rerender} = renderHook(p => usePublicCampaignRewards(p.id, p.slot, 0, true, cache), {initialProps: {id, slot: 0}});
  await act(async () => {});
  for (let n=1;n<=13;n++) {rerender({id: `${id}-${n}`, slot: n%6}); expect(result.current.page).toBeNull(); await act(async () => {});}
  expect(cache.size).toBe(12); expect(cache.has(`${id}:0`)).toBe(false);
});
it('explicit campaign refresh uses its new anchor and retains old rows while waiting', async () => {
  const cache: import('./usePublicCampaignRewards').PublicRewardCache = new Map([[`${id}:1`, {page: page(0, 1), refresh: 0}]]);
  read.mockReturnValue(new Promise(() => {}));
  const anchor = {blockNumber: '101', receivedAt: Date.now()};
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 1, true, cache, anchor));
  expect(result.current.page?.blockNumber).toBe('100'); expect(read.mock.calls[0][6]).toBe('101');
});

it('verifies a 741-row campaign in two bounded requests', async () => {
  read.mockImplementation(async (_id, _slot, offset) => page(offset, 741));
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {});
  expect(read.mock.calls.map(call => call[2])).toEqual([0, 500]);
  expect(result.current.page?.rows).toHaveLength(741);
});

it('preloads only the next round after the selected collection completes and shares the pending request on switch',async()=>{
 const cache: import('./usePublicCampaignRewards').PublicRewardCache=new Map();
 const anchor={blockNumber:'100',receivedAt:Date.now()};
 let finish!: (value:PublicRewardPage)=>void;
 read.mockImplementation(async (_id,slot)=>slot===1?page(0,1,id,slot):new Promise<PublicRewardPage>(resolve=>{finish=resolve;}));
 const selected=renderHook(()=>usePublicCampaignRewards(id,1,0,true,cache,anchor,2));
 await act(async()=>{});
 expect(selected.result.current).toMatchObject({busy:false,page:{slot:1}});
 expect(read.mock.calls.map(call=>call[1])).toEqual([1,2]);
 expect(read.mock.calls[1][6]).toBe('100');
 selected.unmount();
 const next=renderHook(()=>usePublicCampaignRewards(id,2,0,true,cache,anchor));
 expect(next.result.current.page).toBeNull();
 expect(read).toHaveBeenCalledTimes(2);
 expect(read.mock.calls[1][5].aborted).toBe(false);
 await act(async()=>finish(page(0,1,id,2)));
 expect(next.result.current).toMatchObject({busy:false,failed:false,page:{slot:2,total:1}});
});
it('revisits a recently verified round without another request and explicit refresh still loads a newer snapshot',async()=>{
 const cache: import('./usePublicCampaignRewards').PublicRewardCache=new Map();
 read.mockImplementation(async (_id,slot)=>page(0,1,id,slot));
 const first=renderHook(()=>usePublicCampaignRewards(id,1,0,true,cache));
 await act(async()=>{});first.unmount();
 const revisit=renderHook(p=>usePublicCampaignRewards(id,1,p.refresh,true,cache,p.anchor),{initialProps:{refresh:0,anchor:{blockNumber:'100',receivedAt:Date.now()}}});
 expect(revisit.result.current.page?.slot).toBe(1);expect(revisit.result.current.busy).toBe(false);
 await act(async()=>{});expect(read).toHaveBeenCalledOnce();
 read.mockResolvedValueOnce({...page(0,1),blockNumber:'101'});
 revisit.rerender({refresh:1,anchor:{blockNumber:'101',receivedAt:Date.now()}});
 await act(async()=>{});expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls[1][6]).toBe('101');
 expect(revisit.result.current.page?.blockNumber).toBe('101');
});
it('reuses a recent campaign anchor after inspecting another round for a minute',async()=>{
 const anchor={blockNumber:'100',receivedAt:Date.now()-60_000};
 read.mockResolvedValue(page(0,1));renderHook(()=>usePublicCampaignRewards(id,1,0,true,undefined,anchor));
 await act(async()=>{});expect(read.mock.calls[0][6]).toBe('100');
});
it('keeps failed preloads out of the cache and retries them when selected',async()=>{
 const cache: import('./usePublicCampaignRewards').PublicRewardCache=new Map();
 const anchor={blockNumber:'100',receivedAt:Date.now()};
 read.mockResolvedValueOnce(page(0,1)).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page(0,1,id,2));
 const first=renderHook(()=>usePublicCampaignRewards(id,1,0,true,cache,anchor,2));
 await act(async()=>{});expect(cache.has(`${id}:2`)).toBe(false);expect(first.result.current.failed).toBe(false);first.unmount();
 const next=renderHook(()=>usePublicCampaignRewards(id,2,0,true,cache,anchor));
 await act(async()=>{});expect(read).toHaveBeenCalledTimes(3);expect(next.result.current).toMatchObject({failed:false,page:{slot:2}});
});
it('screen cleanup cancels only its old generation and cannot overwrite refreshed data',async()=>{
 const cache: import('./usePublicCampaignRewards').PublicRewardCache=new Map();
 let finishOld!: (value:PublicRewardPage)=>void;
 read.mockReturnValueOnce(new Promise<PublicRewardPage>(resolve=>{finishOld=resolve;})).mockResolvedValueOnce({...page(0,1),blockNumber:'101'});
 const old=loadCachedRewardCollection(cache,id,1,0,'100').catch(()=>null);
 const current=loadCachedRewardCollection(cache,id,1,1,'101');
 cancelPublicRewardLoads(cache,id,0);
 expect(read.mock.calls[0][5].aborted).toBe(true);expect(read.mock.calls[1][5].aborted).toBe(false);
 await current;finishOld(page(0,1));await old;
 expect(cache.get(`${id}:1`)).toMatchObject({refresh:1,page:{blockNumber:'101'}});
});

it('does not preload an already visited round from an older campaign block',async()=>{
 const cache: import('./usePublicCampaignRewards').PublicRewardCache=new Map([[`${id}:2`,{page:{...page(0,1,id,2),blockNumber:'110'},refresh:0,receivedAt:Date.now()-40_000}]]);
 const anchor={blockNumber:'100',receivedAt:Date.now()-60_000};
 read.mockResolvedValue(page(0,1));renderHook(()=>usePublicCampaignRewards(id,1,0,true,cache,anchor,2));
 await act(async()=>{});expect(read).toHaveBeenCalledOnce();expect(cache.get(`${id}:2`)?.page.blockNumber).toBe('110');
});
