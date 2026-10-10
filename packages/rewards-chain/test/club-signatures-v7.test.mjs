import test from 'node:test';
import assert from 'node:assert/strict';
import {hashTypedData,decodeFunctionData,toHex,zeroHash} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {clubOwnersHashV1,clubClaimMessageV7,verifyClubClaimSignaturesV7,encodeClubClaimV7,clubClaimAbiV7,walletBindingMessageV3} from '../dist/club-signatures-v7.js';
// Synthetic signers only, never connected to a public endpoint.
const owners=[0x1111,0x2222,0x3333].map(n=>privateKeyToAccount(toHex(BigInt(n),{size:32}))),addresses=owners.map(o=>o.address);
const h=n=>toHex(BigInt(n),{size:32});
const context={chainId:31337,campaign:'0x'+'a'.repeat(40)};
const claim={entitlementId:h(1),recipient:'0x'+'b'.repeat(40),amount:123n,pot:1,nonce:0n,issuedAt:1800000000n,expiresAt:1800003600n,allocationDigest:h(2),clubOwnersHash:clubOwnersHashV1(addresses),registrationNonce:1n};
const proofs=()=>Promise.all(owners.slice(0,2).map(o=>o.signTypedData(clubClaimMessageV7(context,claim))));
test('two owner proofs encode one bounded claim and input order cannot change the owner commitment',async()=>{
 const signatures=await proofs(),verified=await verifyClubClaimSignaturesV7(context,claim,addresses,signatures.reverse());
 assert.equal(verified.digest,hashTypedData(clubClaimMessageV7(context,claim)));
 assert.deepEqual(verified.signers,[...addresses.slice(0,2)].map(a=>a.toLowerCase()).sort());
 assert.equal(clubOwnersHashV1([...addresses].reverse()),claim.clubOwnersHash);
 const call=decodeFunctionData({abi:clubClaimAbiV7,data:await encodeClubClaimV7(context,claim,addresses,signatures)});
 assert.equal(call.functionName,'claimClub');assert.deepEqual(call.args,[claim.entitlementId,0n,claim.issuedAt,claim.expiresAt,verified.signature]);
});
test('one/two-member rosters, duplicates, wrong signers and Safe pre-approved forms cannot produce a claim',async()=>{
 for(const roster of [addresses.slice(0,1),addresses.slice(0,2),[addresses[0],addresses[0],addresses[1]]])assert.throws(()=>clubOwnersHashV1(roster));
 const signatures=await proofs();
 for(const invalid of [[signatures[0]],[signatures[0],signatures[0]],[signatures[0],signatures[1].slice(0,-2)+'01'],[signatures[0],signatures[1].slice(0,-2)+'00']])await assert.rejects(encodeClubClaimV7(context,claim,addresses,invalid));
 await assert.rejects(encodeClubClaimV7(context,{...claim,clubOwnersHash:h(99)},addresses,signatures));
});
test('signatures bind every payment field, registration generation, campaign and chain',async()=>{
 const signatures=await proofs();
 for(const patch of [{entitlementId:h(9)},{recipient:context.campaign},{amount:124n},{pot:0},{nonce:1n},{issuedAt:claim.issuedAt+1n},{expiresAt:claim.expiresAt-1n},{allocationDigest:h(9)},{registrationNonce:2n}])await assert.rejects(encodeClubClaimV7(context,{...claim,...patch},addresses,signatures));
 for(const ctx of [{...context,chainId:10143},{...context,campaign:claim.recipient}])await assert.rejects(encodeClubClaimV7(ctx,claim,addresses,signatures));
});
test('typed-data validation rejects unsupported chains, lifetime, missing generation and wrong binding kind',()=>{
 assert.throws(()=>clubClaimMessageV7({...context,chainId:143},claim));
 for(const patch of [{registrationNonce:0n},{amount:0n},{nonce:-1n},{expiresAt:claim.issuedAt+172801n},{expiresAt:claim.issuedAt},{clubOwnersHash:zeroHash}])assert.throws(()=>clubClaimMessageV7(context,{...claim,...patch}));
 const binding={beneficiaryId:h(100),recipient:claim.recipient,beneficiaryKind:1,nonce:0n,issuedAt:claim.issuedAt,expiresAt:claim.expiresAt,clubOwnersHash:claim.clubOwnersHash},ctx={chainId:31337,registry:context.campaign};
 assert.equal(walletBindingMessageV3(ctx,binding).domain.version,'3');
 assert.throws(()=>walletBindingMessageV3(ctx,{...binding,clubOwnersHash:zeroHash}));
 assert.throws(()=>walletBindingMessageV3(ctx,{...binding,beneficiaryKind:0}));
 assert.equal(walletBindingMessageV3(ctx,{...binding,beneficiaryKind:0,clubOwnersHash:zeroHash}).message.clubOwnersHash,zeroHash);
});

import {clubClaimMessageV6,verifyClubClaimSignaturesV6,walletBindingMessageV2} from '../dist/club-signatures-v6.js';
test('future club messages allow 48h while retained domains reject them and signatures do not cross versions',async()=>{
 const long={...claim,expiresAt:claim.issuedAt+172800n};
 assert.equal(clubClaimMessageV7(context,long).domain.version,'8');
 assert.throws(()=>clubClaimMessageV6(context,long));
 const signatures=await Promise.all(owners.slice(0,2).map(o=>o.signTypedData(clubClaimMessageV7(context,long))));
 await verifyClubClaimSignaturesV7(context,long,addresses,signatures);
 const shortSignatures=await proofs();await assert.rejects(verifyClubClaimSignaturesV6(context,claim,addresses,shortSignatures));
 const binding={beneficiaryId:h(100),recipient:claim.recipient,beneficiaryKind:1,nonce:0n,issuedAt:claim.issuedAt,expiresAt:long.expiresAt,clubOwnersHash:claim.clubOwnersHash},ctx={chainId:31337,registry:context.campaign};
 assert.equal(walletBindingMessageV3(ctx,binding).message.expiresAt,long.expiresAt);
 assert.throws(()=>walletBindingMessageV2(ctx,binding));
 assert.throws(()=>walletBindingMessageV3(ctx,{...binding,beneficiaryKind:0,clubOwnersHash:zeroHash}));
});
