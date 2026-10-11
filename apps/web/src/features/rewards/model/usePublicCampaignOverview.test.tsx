import {act, renderHook} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import type {PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {ApiError} from '@/lib/api';
import {usePublicCampaignOverview} from './usePublicCampaignOverview';
const {live, snapshot} = vi.hoisted(() => ({live: vi.fn(), snapshot: vi.fn()}));
vi.mock('../data/publicCampaign', () => ({readPublicCampaign: live, readPublicCampaignSnapshot: snapshot}));
const campaign = {id: 'campaign', name: 'Published league', blockNumber: '100', blockTimestamp: '1800000000'} as PublicSponsorCampaign;
const published = {campaign, selection: null, publishedAt: '2026-10-11T00:00:00Z'};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
beforeEach(() => {live.mockReset(); snapshot.mockReset().mockResolvedValue(published);});
it('renders the timestamped publication before live verification and upgrades it without another request', async () => {
  const pending = deferred<PublicSponsorCampaign>(); live.mockReturnValue(pending.promise);
  const {result} = renderHook(() => usePublicCampaignOverview('campaign', 0));
  await act(async () => {});
  expect(result.current).toMatchObject({campaign, busy: true, live: false});
  expect(result.current.anchor).toBeUndefined();
  const current = {...campaign, blockNumber: '101'};
  await act(async () => pending.resolve(current));
  expect(result.current).toMatchObject({campaign: current, busy: false, live: true, anchor: {blockNumber: '101'}});
  expect(live).toHaveBeenCalledOnce(); expect(snapshot).toHaveBeenCalledOnce();
});
it('does not let a late publication overwrite a completed live observation', async () => {
  const pending = deferred<typeof published>(); snapshot.mockReturnValue(pending.promise);
  live.mockResolvedValue({...campaign, blockNumber: '101'});
  const {result} = renderHook(() => usePublicCampaignOverview('campaign', 0));
  await act(async () => {});
  await act(async () => pending.resolve(published));
  expect(result.current.campaign?.blockNumber).toBe('101'); expect(result.current.live).toBe(true);
});
it.each([false, true])('a missing live campaign overrides a %s late publication', async late => {
  const pending = deferred<typeof published>(); if (late) snapshot.mockReturnValue(pending.promise);
  live.mockRejectedValue(new ApiError('missing', {status: 404}));
  const {result} = renderHook(() => usePublicCampaignOverview('campaign', 0));
  await act(async () => {});
  if (late) await act(async () => pending.resolve(published));
  expect(result.current).toMatchObject({campaign: null, failure: 'missing', busy: false});
});
it('keeps a historical publication when live verification is unavailable, with no reusable anchor', async () => {
  live.mockRejectedValue(Error('offline'));
  const {result} = renderHook(() => usePublicCampaignOverview('campaign', 0));
  await act(async () => {});
  expect(result.current).toMatchObject({campaign, failure: 'unavailable', live: false, busy: false});
  expect(result.current.anchor).toBeUndefined();
});
it('keeps last verified data through a failed refresh and obtains a new anchor on retry', async () => {
  live.mockResolvedValueOnce(campaign).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({...campaign, blockNumber: '110'});
  const {result, rerender} = renderHook(refresh => usePublicCampaignOverview('campaign', refresh), {initialProps: 0});
  await act(async () => {}); rerender(1);
  expect(result.current.campaign).toEqual(campaign); expect(result.current.anchor).toBeUndefined();
  await act(async () => {});
  expect(result.current).toMatchObject({campaign, failure: 'unavailable', busy: false});
  rerender(2); await act(async () => {});
  expect(result.current).toMatchObject({failure: null, anchor: {blockNumber: '110'}});
});
it.each(['campaign', 'refresh', 'unmount'])('aborts both requests and ignores late results on %s', async change => {
  const pending = deferred<PublicSponsorCampaign>(), summary = deferred<typeof published>();
  live.mockReturnValueOnce(pending.promise).mockReturnValue(new Promise(() => {}));
  snapshot.mockReturnValueOnce(summary.promise).mockReturnValue(new Promise(() => {}));
  const {result, rerender, unmount} = renderHook(p => usePublicCampaignOverview(p.id, p.refresh), {initialProps: {id: 'campaign', refresh: 0}});
  const signal = live.mock.calls[0][1]; expect(snapshot.mock.calls[0][1]).toBe(signal);
  if (change === 'unmount') unmount(); else rerender({id: change === 'campaign' ? 'other' : 'campaign', refresh: 1});
  expect(signal.aborted).toBe(true);
  await act(async () => {pending.resolve(campaign); summary.resolve(published);});
  expect(result.current.campaign).toBeNull();
});
