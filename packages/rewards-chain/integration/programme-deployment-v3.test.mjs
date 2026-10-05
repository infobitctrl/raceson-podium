import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {keccak256} from "viem";
import {programmeDeploymentFixtureV3} from "../../../apps/api/test/fixtures/programme-deployment-v3.mjs";
import {programmeDeploymentPlanV3} from "../../../apps/api/dist/features/rewards/programme-deployment-v3-service.js";
import {decodeProgrammeDeploymentV3} from "../../db/dist/rewards/index.js";
import {startOwnedRewardChain,fixtureSigner} from "./owned-chain.mjs";
import {encodeRewardProgrammeDeploymentV3,readVerifiedRewardProgrammeV3} from "../dist/programme-v3.js";
import {verifySignedProgrammeDeploymentV3} from "../dist/programme-deployment-v3.js";

test("approved programme plan -> exact signed factory deployment -> finalized six-pot verification on owned loopback",{timeout:60000},async t=>{
  const chain=await startOwnedRewardChain();
  try{
    const c=chain.publicClient,f=programmeDeploymentFixtureV3(chain.operator.address,fixtureSigner(0xCAFEEE).address);
    f.intent.nonce=String(await c.getTransactionCount({address:chain.operator.address,blockTag:"pending"}));
    const plan=programmeDeploymentPlanV3(decodeProgrammeDeploymentV3(f));
    const artifact=JSON.parse(readFileSync(new URL("../../../contracts/out/RacesOnRewardProgrammeV3.sol/RacesOnRewardProgrammeV3.json",import.meta.url)));
    const data=encodeRewardProgrammeDeploymentV3(plan,artifact.bytecode.object),gas=(await c.estimateGas({account:chain.operator.address,data}))*12n/10n;
    const tx={chainId:31337,type:"eip1559",nonce:Number(plan.deploymentNonce),data,gas,maxFeePerGas:100_000_000_000n,maxPriorityFeePerGas:0n,value:0n};
    const ceiling=BigInt(f.intent.maximumGasCostWei),signed=await chain.operator.signTransaction(tx);
    let verified;
    await t.test("canonical exact constructor, correct signer, chain and bounded fees",async()=>{
      verified=await verifySignedProgrammeDeploymentV3(plan,signed,ceiling);
      assert.equal(verified.transactionHash,keccak256(signed));assert.equal(verified.contractAddress,plan.context.verifyingContract);
      for(const patch of[{chainId:10143},{nonce:tx.nonce+1},{value:1n},{to:chain.operator.address},{gas:30_000_001n},{maxFeePerGas:ceiling}]){
        await assert.rejects(verifySignedProgrammeDeploymentV3(plan,await chain.operator.signTransaction({...tx,...patch}),ceiling));
      }
      await assert.rejects(verifySignedProgrammeDeploymentV3(plan,signed,1n),{code:"invalid_reward_deployment_fees"});
      await assert.rejects(verifySignedProgrammeDeploymentV3(plan,await fixtureSigner(0xCAFEFF).signTransaction(tx),ceiling),{code:"reward_deployment_sender_mismatch"});
      const changed=encodeRewardProgrammeDeploymentV3({...plan,reviewPeriods:Array(6).fill(0n)},artifact.bytecode.object);
      await assert.rejects(verifySignedProgrammeDeploymentV3(plan,await chain.operator.signTransaction({...tx,data:changed}),ceiling),{code:"reward_deployment_input_mismatch"});
    });
    await t.test("actual signed CREATE and independent finalized child checks",async()=>{
      const hash=await c.sendRawTransaction({serializedTransaction:verified.signedTransaction});
      const receipt=await c.waitForTransactionReceipt({hash,timeout:10000});assert.equal(receipt.status,"success");
      await chain.testClient.mine({blocks:96,interval:1});
      const observed=await readVerifiedRewardProgrammeV3(c,{...plan,deploymentTransactionHash:hash});
      assert.equal(observed.depositedWei,0n);assert.equal(observed.pots.length,6);
      assert.deepEqual(observed.pots.map(p=>p.capWei),[...Array(5).fill(10000n*10n**18n),50000n*10n**18n]);
      assert.ok(observed.pots.every(p=>p.state===0&&p.paidWei===0n&&p.accountedFundingWei===0n));
      // No deposit, sporting result, activation or payout is manufactured here.
      assert.equal(observed.context.verifyingContract,plan.context.verifyingContract);
    });
  }finally{await chain.stop()}
});
