import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeFunctionData,encodeAbiParameters,getAddress,zeroAddress} from 'viem';
import {rewardClubSafeCreationPlan,prepareRewardClubSafeCreation,verifyRewardClubSafeCreation,rewardClubSafeDeploymentAbi as abi} from '../dist/index.js';
import {clubSafeDeploymentFixture} from './club-safe-deployment-fixture.mjs';
import {originalSafeArtifacts} from './safe-artifacts.mjs';
const creation=originalSafeArtifacts().proxy.bytecode;
function fixture(){const first=clubSafeDeploymentFixture();const f=clubSafeDeploymentFixture({setupPatch:{owners:[...first.owners].sort()}});
 // The legacy fixture emits its original owner order even when setupPatch
 // replaces it. Make the synthetic receipt describe the patched initializer.
 f.receipt.logs[0].data=encodeAbiParameters([{type:'address[]'},{type:'uint256'},{type:'address'},{type:'address'}],[[...f.owners].sort(),2n,zeroAddress,f.input.safe.fallbackHandlerAddress]);
 const input={environment:'local-simulation',chainId:31337,sender:f.tx.from,owners:[...f.owners],saltNonce:1n,dependencies:{factoryAddress:f.input.factoryAddress,singletonAddress:f.input.safe.singletonAddress,fallbackHandlerAddress:f.input.safe.fallbackHandlerAddress}};
 return{f,input};}
test('Safe creation encodes only three explicit owners and atomic 2-of-3 with zero delegatecall and reimbursement',()=>{
 const {f,input}=fixture(),plan=rewardClubSafeCreationPlan(input,creation);
 assert.equal(plan.safe.context.verifyingContract,f.input.safe.context.verifyingContract);assert.equal(plan.transaction.data,f.tx.input);assert.equal(plan.transaction.value,0n);
 const init=decodeFunctionData({abi,data:plan.initializer});assert.deepEqual(init.args,[[...input.owners].sort(),2n,zeroAddress,'0x',getAddress(input.dependencies.fallbackHandlerAddress),zeroAddress,0n,zeroAddress]);
 for(const owners of [[...input.owners.slice(0,2)], [input.owners[0],input.owners[0],input.owners[2]],[zeroAddress,...input.owners.slice(1)]])assert.throws(()=>rewardClubSafeCreationPlan({...input,owners},creation));
 assert.throws(()=>rewardClubSafeCreationPlan({...input,chainId:143},creation),e=>e.code==='unsupported_reward_chain');
 assert.throws(()=>rewardClubSafeCreationPlan(input,'0x1234'),e=>e.code==='reward_club_creation_dependencies_changed');
});
test('creation quote checks pinned finalized code, unused destination, fees/balance and canonical chain without signing',async()=>{
 const {f,input}=fixture();input.saltNonce=2n;
 let estimates=0;const reader={...f.reader,async estimateGas(p){estimates++;assert.equal(p.value,0n);return 100000n;},async getGasPrice(){return 100n;},async getBalance(){return 12000000n;}};
 const quote=await prepareRewardClubSafeCreation(reader,input);assert.equal(quote.maximumFee,12000000n);assert.equal(estimates,1);assert.equal(quote.observedAt.number,100n);
 await assert.rejects(prepareRewardClubSafeCreation(reader,{...input,saltNonce:1n}),e=>e.code==='reward_club_creation_already_deployed');assert.equal(estimates,1);
 await assert.rejects(prepareRewardClubSafeCreation({...reader,async getBalance(){return 0n;}},input),e=>e.code==='reward_club_creation_gas_required');
 await assert.rejects(prepareRewardClubSafeCreation({...reader,async getGasPrice(){return 10n**20n;}},input),e=>e.code==='reward_club_creation_gas_limit');
 let chain=0;await assert.rejects(prepareRewardClubSafeCreation({...reader,async getChainId(){return ++chain===1?31337:10143;}},input),e=>e.code==='reward_chain_changed_during_observation');
 await assert.rejects(prepareRewardClubSafeCreation({...reader,async getCode(p){return p.address===input.dependencies.singletonAddress?'0x1234':f.reader.getCode(p);}},input),e=>e.code==='reward_club_creation_dependencies_changed');
});
test('finalized receipt must prove this exact sender, salt and initializer; creation remains distinct from treasury review',async()=>{
 const {f,input}=fixture();const v=await verifyRewardClubSafeCreation(f.reader,input,f.input.deploymentTransactionHash);
 assert.equal(v.scope,'initialization_only');assert.equal(v.executionHistoryReviewRequired,true);assert.equal(v.deployer,getAddress(input.sender));
 await assert.rejects(verifyRewardClubSafeCreation(f.reader,{...input,sender:input.owners[0]},f.input.deploymentTransactionHash),e=>e.code==='reward_club_creation_intent_mismatch');
 await assert.rejects(verifyRewardClubSafeCreation(f.reader,{...input,saltNonce:2n},f.input.deploymentTransactionHash));
 f.receipt.status='reverted';await assert.rejects(verifyRewardClubSafeCreation(f.reader,input,f.input.deploymentTransactionHash),e=>e.code==='reward_club_deployment_not_mined');
});
