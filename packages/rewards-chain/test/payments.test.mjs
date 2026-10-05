import assert from "node:assert/strict";
import test from "node:test";
import {getContractAddress,keccak256,parseTransaction,serializeTransaction,toHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {encodeRewardAthletePayment,normalizeRewardAthletePaymentPlan,verifyRewardAthletePaymentPlan,verifySignedRewardAthletePayment,rewardClaimMessages} from "../dist/index.js";
import {proposalFor,h} from "./fixtures.mjs";
// Synthetic deterministic signers only; never public-network keys.
const [operator,athlete,relayer,treasury]=[0xA11CE,993,0xFEED,777].map(n=>privateKeyToAccount(toHex(BigInt(n),{size:32})));
async function fixture(){
  const upload=proposalFor();const award=upload.awards.find(a=>a.beneficiaryKind===0);
  const deployment={context:{environment:"local-simulation",chainId:31337,verifyingContract:getContractAddress({from:operator.address,nonce:3n})},
    operatorAddress:operator.address,treasuryAddress:treasury.address,programmeId:upload.programmeId,campaignId:upload.campaignId,
    programmeManifestHash:upload.programmeManifestHash,enabledPot:0,deploymentNonce:3n,deploymentTransactionHash:h("payment-deployment")};
  const claim={entitlementId:award.entitlementId,recipient:athlete.address,amount:award.amount,pot:"race",nonce:7n,
    issuedAt:1801000000n,expiresAt:1801086400n,allocationDigest:upload.allocationDigest};
  const m=rewardClaimMessages(deployment.context,claim);
  return{deployment,upload,claim,relayerAddress:relayer.address,nonce:0n,
    proofs:{operator:await operator.signTypedData(m.authorization),recipient:await athlete.signTypedData(m.consent)}};
}
const signing=p=>({...encodeRewardAthletePayment(p),type:"eip1559",gas:500000n,maxFeePerGas:20000000000n,maxPriorityFeePerGas:100000000n});
test("payment plan separates transaction and authorization nonces and preserves exact award semantics",async()=>{
  const p=await fixture();const normalized=await verifyRewardAthletePaymentPlan(p);assert.equal(normalized.nonce,0n);assert.equal(normalized.claim.nonce,7n);
  const encoded=encodeRewardAthletePayment(p);assert.equal(encoded.value,0n);assert.equal(encoded.nonce,0);
  const signed=await relayer.signTransaction(signing(p));const attempt=await verifySignedRewardAthletePayment(p,signed);
  assert.equal(attempt.relayerAddress,relayer.address.toLowerCase());assert.equal(attempt.transactionHash,keccak256(signed));
  assert.equal(attempt.authorizationNonce,7n);assert.equal(attempt.amount,p.claim.amount);assert.equal(attempt.value,0n);
  const replacement=await verifySignedRewardAthletePayment(p,await relayer.signTransaction({...signing(p),maxFeePerGas:30000000000n}));
  assert.notEqual(replacement.transactionHash,attempt.transactionHash);assert.equal(replacement.calldataHash,attempt.calldataHash);
  assert.equal(replacement.nonce,attempt.nonce);assert.equal(replacement.recipientDigest,attempt.recipientDigest);
});
test("payment normalization rejects inconsistent full packages and relayer key reuse",async()=>{
  const original=await fixture();
  for(const mutate of [p=>{p.claim.amount++;},p=>{p.claim.pot="league";},p=>{p.claim.allocationDigest=h("wrong");},p=>{p.upload.awards[0].amount++;},
    p=>{p.claim.nonce=(1n<<256n)-1n;},p=>{p.nonce=BigInt(Number.MAX_SAFE_INTEGER)+1n;},p=>{p.nonce=-1n;},p=>{p.deployment.context.chainId=143;},
    p=>{p.relayerAddress=operator.address;},p=>{p.relayerAddress=athlete.address;},p=>{p.relayerAddress=treasury.address;},p=>{p.proofs.recipient="0x";}]){
    const p=structuredClone(original);mutate(p);assert.throws(()=>normalizeRewardAthletePaymentPlan(p));
  }
});
test("payment verification rejects swapped, foreign and changed-message consent before accepting signed bytes",async()=>{
  const p=await fixture();const signed=await relayer.signTransaction(signing(p));
  for(const mutate of [p=>{p.proofs.recipient=p.proofs.operator;},p=>{p.proofs.operator=p.proofs.recipient;},p=>{p.claim.nonce++;},
    p=>{p.claim.expiresAt--;},p=>{p.claim.recipient=treasury.address;},p=>{p.proofs.recipient=`0x${"ff".repeat(65)}`;}]){
    const altered=structuredClone(p);mutate(altered);await assert.rejects(verifySignedRewardAthletePayment(altered,signed));
  }
});
test("canonical relayer attempts reject foreign sender, chain, call, nonce, value, access list and invalid fees",async()=>{
  const p=await fixture();const tx=signing(p);
  await assert.rejects(verifySignedRewardAthletePayment(p,await operator.signTransaction(tx)),{code:"reward_payment_sender_mismatch"});
  for(const [patch,code] of [[{chainId:143},"reward_payment_transaction_chain_mismatch"],[{to:treasury.address},"reward_payment_destination_mismatch"],
    [{nonce:1},"reward_payment_nonce_mismatch"],[{value:1n},"reward_payment_input_mismatch"],[{data:`${tx.data}00`},"reward_payment_input_mismatch"],
    [{accessList:[{address:treasury.address,storageKeys:[]}]},"reward_payment_destination_mismatch"],[{gas:0n},"invalid_reward_payment_fees"],
    [{maxFeePerGas:0n,maxPriorityFeePerGas:0n},"invalid_reward_payment_fees"]]){
    await assert.rejects(verifySignedRewardAthletePayment(p,await relayer.signTransaction({...tx,...patch})),{code});
  }
});
test("unsigned, malformed, overlong and high-S relayer transactions are rejected",async()=>{
  const p=await fixture();const tx=signing(p);const signed=await relayer.signTransaction(tx);const parsed=parseTransaction(signed);
  const order=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const high=serializeTransaction({...parsed,s:toHex(order-BigInt(parsed.s),{size:32}),yParity:1-parsed.yParity});
  for(const value of [null,"0x","0x02",`${signed}00`,`0x02${"aa".repeat(2049)}`,serializeTransaction(tx),high])
    await assert.rejects(verifySignedRewardAthletePayment(p,value));
});
test("all payment plan values are copied before asynchronous signature recovery",async()=>{
  const p=await fixture();const signed=await relayer.signTransaction(signing(p));const pending=verifySignedRewardAthletePayment(p,signed);
  p.claim.amount++;p.nonce=9n;p.relayerAddress=treasury.address;p.proofs.recipient="0x";p.upload.awards[0].amount++;p.deployment.context.chainId=143;
  const result=await pending;assert.equal(result.chainId,31337);assert.equal(result.nonce,0n);assert.equal(result.relayerAddress,relayer.address.toLowerCase());
});
