import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { encodeFunctionData, keccak256, stringToHex, toHex, parseEther } from 'viem';
import { finalResultsCanaryPlan as plan } from '@raceson/domain/rewards/final-results-canary';
import { readFinalResultsCanaryStatus } from '../dist/final-results-canary-status.js';
import { rewardCampaignV3Abi as abi } from '../dist/campaign-v3.js';
import { prepareContractCanaryDeployment } from '../../../demo/rewards/scripts/final-results-canary-plan.mjs';
import { startOwnedRewardChain } from './owned-chain.mjs';

test('V3 observer follows actual local funding, final approval and immediate activation at a single finalized snapshot', async () => {
  // Non-forked disposable node; locally impersonated public identity, never a key
  // or a public-chain broadcast. Hash override exists only for this local receipt.
  const chain = await startOwnedRewardChain({ chainId: 10143 });
  try {
    const artifact = JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV3.sol/RacesOnRewardCampaignV3.json', import.meta.url), 'utf8'));
    const prepared = prepareContractCanaryDeployment(artifact), address = prepared.spec.context.verifyingContract;
    await chain.testClient.impersonateAccount({ address: plan.operator });
    await chain.testClient.setBalance({ address: plan.operator, value: parseEther('10') });
    await chain.testClient.setNonce({ address: plan.operator, nonce: 4 });
    const send = async (data, value = 0n, deploy = false) => {
      const hash = await chain.testClient.request({ method: 'eth_sendTransaction', params: [{ from: plan.operator,
        ...(deploy ? {} : { to: address }), data, value: toHex(value), gas: '0x3d0900' }] });
      await chain.testClient.mine({ blocks: 96, interval: 1 });
      assert.equal((await chain.publicClient.getTransactionReceipt({ hash })).status, 'success'); return hash;
    };
    const tx = await send(prepared.data, 0n, true);
    const call = (functionName, args = [], value = 0n) => send(encodeFunctionData({ abi, functionName, args }), value);
    let current = await readFinalResultsCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.fundedWei, '0'); assert.equal(current.contract.allocationApprovedAt, null);
    await call('completeFunding', [0n, parseEther('0.1')], parseEther('0.1'));
    current = await readFinalResultsCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.fundedWei, String(parseEther('0.1'))); assert.equal(current.contract.state, 1);
    const h = s => keccak256(stringToHex(s));
    await call('uploadAwards', [[{ entitlementId: h('synthetic-v3-status-award'), beneficiaryId: h('synthetic-v3-status-beneficiary'),
      pot: 0, amount: parseEther('0.05'), explanationHash: h('synthetic-v3-status-explanation'), beneficiaryKind: 0 }]]);
    const digest = await chain.publicClient.readContract({ address, abi, functionName: 'uploadDigest' });
    const publication = (await chain.publicClient.getBlock()).timestamp;
    await call('stageAllocation', [h('synthetic-v3-status-snapshot'), digest, 1n, publication, publication, h('synthetic-v3-status-approval')]);
    current = await readFinalResultsCanaryStatus(chain.publicClient, tx);
    assert.equal(current.contract.state, 2); assert.equal(current.contract.officialPublishedAt, String(publication));
    assert.ok(BigInt(current.contract.allocationApprovedAt) >= publication); assert.equal(current.contract.reviewPeriodSeconds, '0');
    const allocation = await chain.publicClient.readContract({ address, abi, functionName: 'allocationDigest' });
    await call('activate', [allocation, h('synthetic-v3-status-snapshot')]);
    const fixedBlock = await chain.publicClient.getBlock({ blockTag: 'finalized' });
    const tracked = { ...chain.publicClient,
      readContract: async args => { assert.equal(args.blockNumber, fixedBlock.number); return chain.publicClient.readContract(args); },
      getBalance: async args => { assert.equal(args.blockNumber, fixedBlock.number); return chain.publicClient.getBalance(args); } };
    current = await readFinalResultsCanaryStatus(tracked, tx);
    assert.equal(current.contract.state, 3); assert.equal(current.contract.allocatedWei, String(parseEther('0.05')));
    assert.equal(current.contract.paidWei, '0'); assert.ok(!('reviewDeadline' in current.contract));
    await assert.rejects(readFinalResultsCanaryStatus({ ...tracked, readContract: async args => args.functionName === 'PROTOCOL_VERSION' ? 2n : tracked.readContract(args) }, tx));
    await assert.rejects(readFinalResultsCanaryStatus({ ...tracked, getBlock: async args => {
      const block = await chain.publicClient.getBlock(args);
      return args.blockNumber === fixedBlock.number ? { ...block, hash: h('changed-block') } : block;
    } }, tx));
    await assert.rejects(readFinalResultsCanaryStatus(chain.publicClient)); // Public registry is not this local deployment.
  } finally { await chain.stop(); }
}, { timeout: 30000 });
