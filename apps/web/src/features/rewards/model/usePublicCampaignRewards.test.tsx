import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {PublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {usePublicCampaignRewards} from './usePublicCampaignRewards';

const read = vi.hoisted(() => vi.fn());
vi.mock('../data/publicCampaign', () => ({readPublicRewards: read}));
const id = '72000000-0000-4000-8000-000000000001';
function page(offset: number, total = 741, campaignId = id, slot = 1): PublicRewardPage {
  return {campaignId, slot, chainId: 31337, blockNumber: '100', blockTimestamp: '1800000000', total, offset,
    sort: 'reward', direction: 'asc', availability: 'open',
    rows: Array.from({length: Math.min(25, total - offset)}, (_, index) => ({
      id: `0x${(offset + index + 1).toString(16).padStart(64, '0')}`, number: offset + index + 1,
      kind: 'athlete', amountWei: '1', status: 'unclaimed',
    }))};
}
beforeEach(() => {read.mockReset(); vi.useFakeTimers();});
afterEach(() => vi.useRealTimers());
it('verifies 741 rewards in nine request waves with at most four pages in flight', async () => {
  let active = 0, peak = 0;
  read.mockImplementation(async (_id, _slot, offset) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1000));
    active--;
    return page(offset);
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {await vi.advanceTimersByTimeAsync(8999);});
  expect(result.current.page).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(result.current.busy).toBe(false);
  expect(result.current.failed).toBe(false);
  expect(result.current.page?.rows.map(row => row.number)).toEqual(Array.from({length: 741}, (_, i) => i + 1));
  expect(read).toHaveBeenCalledTimes(30);
  expect(peak).toBe(4);
  expect(read.mock.calls.slice(1).every(call => call[6] === '100')).toBe(true);
});
it('keeps reward order when later pages complete first', async () => {
  read.mockImplementation(async (_id, _slot, offset) => {
    await new Promise(resolve => setTimeout(resolve, offset === 25 ? 50 : 1));
    return page(offset, 126);
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {await vi.advanceTimersByTimeAsync(50);});
  expect(result.current.page).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(result.current.page?.rows.map(row => row.number)).toEqual(Array.from({length: 126}, (_, i) => i + 1));
});
it.each(['total', 'availability', 'blockNumber', 'blockTimestamp', 'duplicate-id', 'duplicate-number', 'missing-row'])('rejects %s changes without publishing partial rewards', async change => {
  read.mockImplementation(async (_id, _slot, offset) => {
    const next = page(offset, 51);
    if (offset === 25) {
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
    if (offset === 25) throw Error('provider unavailable');
    return new Promise(() => {});
  });
  const {result} = renderHook(() => usePublicCampaignRewards(id, 1, 0));
  await act(async () => {});
  expect(result.current).toMatchObject({page: null, busy: false, failed: true});
  expect(read).toHaveBeenCalledTimes(5);
  expect(read.mock.calls.every(call => call[5].aborted)).toBe(true);
  read.mockImplementation(async (_id, _slot, offset) => ({...page(offset, 26), blockNumber: '110'}));
  await act(async () => result.current.retry());
  expect(result.current.page?.rows).toHaveLength(26);
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
it.each([0, 1, 25])('fetches a %i-row collection once without speculative pages', async total => {
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
