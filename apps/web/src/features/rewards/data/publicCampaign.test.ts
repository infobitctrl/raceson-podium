import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {readPublicRewards,readPublicCampaignSource} from './publicCampaign';
const mocks = vi.hoisted(() => ({origin: vi.fn(), fetch: vi.fn()}));
vi.mock('@/lib/public-env', () => ({assertPublicEnvironmentOrigin: mocks.origin,
  publicEnv: {rewardDemo: {chainId: 31337, apiBaseUrl: 'https://isolated.invalid/api'}}}));
const id = '72000000-0000-4000-8000-000000000001';
const page = {campaignId: id, slot: 1, chainId: 31337, blockNumber: '100', blockTimestamp: '1800000000',
  total: 26, offset: 25, sort: 'reward', direction: 'asc', availability: 'open',
  rows: [{id: `0x${'1'.repeat(64)}`, number: 26, kind: 'athlete', amountWei: '1', status: 'unclaimed'}]};
beforeEach(() => {mocks.fetch.mockReset(); mocks.origin.mockReset(); vi.stubGlobal('fetch', mocks.fetch);});
afterEach(() => vi.unstubAllGlobals());
function response(value: unknown = page) {mocks.fetch.mockResolvedValue({ok: true, json: async () => ({data: value})});}
it('reads only the selected public source without cookies, cache or a directory refresh',async()=>{
 const value={id,chainId:31337,selection:null};response(value);
 const abort=new AbortController();expect(await readPublicCampaignSource(id,abort.signal)).toEqual(value);
 expect(mocks.fetch).toHaveBeenCalledWith(`https://isolated.invalid/api/v1/rewards/public-campaigns/${id}/source`,expect.objectContaining({credentials:'omit',cache:'no-store',redirect:'error'}));
 abort.abort();expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each([{id:'72000000-0000-4000-8000-000000000002'},{chainId:10143},{wallet:'private'},{selection:{userId:'private'}}])('rejects foreign or private source data: %j',async patch=>{
 response({id,chainId:31337,selection:null,...patch});
 await expect(readPublicCampaignSource(id,new AbortController().signal)).rejects.toThrow();
});
it('requests a bounded public page at the selected block without credentials or cache', async () => {
  response(); const abort = new AbortController();
  expect(await readPublicRewards(id, 1, 25, 'reward', 'asc', abort.signal, '100')).toEqual(page);
  expect(mocks.fetch).toHaveBeenCalledWith(`https://isolated.invalid/api/v1/rewards/public-campaigns/${id}/pots/1/awards?offset=25&sort=reward&direction=asc&blockNumber=100`,
    expect.objectContaining({method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: {Accept: 'application/json'}}));
  const signal = mocks.fetch.mock.calls[0][1].signal;
  abort.abort(); expect(signal.aborted).toBe(true);
});
it('leaves the first request unpinned so refresh gets a new finalized block', async () => {
  response(); await readPublicRewards(id, 1, 25, 'reward', 'asc', new AbortController().signal);
  expect(mocks.fetch.mock.calls[0][0]).not.toContain('blockNumber=');
});
it.each(['', '-1', '01', '0x10', '1&owner=other', '1'.repeat(79)])('rejects malformed block %s before network access', async block => {
  await expect(readPublicRewards(id, 1, 25, 'reward', 'asc', new AbortController().signal, block)).rejects.toThrow('invalid_public_awards');
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it.each([{blockNumber: '101'}, {campaignId: '72000000-0000-4000-8000-000000000002'}, {slot: 2}, {chainId: 10143}, {offset: 0}, {sort: 'amount'}, {direction: 'desc'}, {wallet: 'private-field'}])('rejects mismatched or private response fields: %j', async patch => {
  response({...page, ...patch});
  await expect(readPublicRewards(id, 1, 25, 'reward', 'asc', new AbortController().signal, '100')).rejects.toThrow();
});
it('preserves origin validation and sanitizes provider errors', async () => {
  mocks.origin.mockImplementationOnce(() => {throw Error('wrong_origin');});
  await expect(readPublicRewards(id, 1, 25, 'reward', 'asc', new AbortController().signal)).rejects.toThrow('wrong_origin');
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValue({ok: false, status: 503});
  await expect(readPublicRewards(id, 1, 25, 'reward', 'asc', new AbortController().signal)).rejects.toMatchObject({status: 503, code: 'public_awards_unavailable'});
});
