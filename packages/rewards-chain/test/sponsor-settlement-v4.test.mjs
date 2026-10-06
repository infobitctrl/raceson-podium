import assert from 'node:assert/strict';import {test} from 'node:test';
import {encodeAbiParameters,encodeEventTopics,toHex} from 'viem';
import {plan,deploymentHash,fundingHash,fixture,settlementFixture as owned} from './sponsor-settlement-fixture.mjs';
import {observeSponsorSettlementV4,prepareSponsorSettlementV4,verifySponsorSettlementReceiptV4,sponsorSettlementAbiV4 as abi,sponsorSettlementDataV4} from '../dist/sponsor-settlement-v4.js';
const h=n=>toHex(BigInt(n),{size:32}),input={plan,slot:0,deploymentHash,fundingHash},settlementHash=h(12);
test('settlement keeps immutable return lanes and paid awards separate; only expired unpaused claims can close',async()=>{
 const {f,state}=owned(),v=await observeSponsorSettlementV4(f.reader,input);
 assert.equal(v.pot.paidWei,'10');assert.deepEqual(v.lanes,{unallocated:{recipient:plan.unallocatedTreasury,originalWei:'60',returnedWei:'0',remainingWei:'60'},expired:{recipient:plan.expiredTreasury,originalWei:'30',returnedWei:'0',remainingWei:'30'}});
 assert.deepEqual(v.available,[{action:'close',recipient:null,amountWei:'0'}]);const p=await prepareSponsorSettlementV4(f.reader,input,'close');assert.equal(p.transaction.value,'0');assert.equal(p.transaction.from,plan.operator);
 await assert.rejects(prepareSponsorSettlementV4(f.reader,input,'returnExpired'));
 state.paused=true;assert.deepEqual((await observeSponsorSettlementV4(f.reader,input)).available,[]);state.paused=false;state.deadline=1800000001n;assert.deepEqual((await observeSponsorSettlementV4(f.reader,input)).available,[]);
 state.deadline=1800000000n;assert.equal((await observeSponsorSettlementV4(f.reader,input)).available[0].action,'close');state.stage=4;assert.deepEqual((await observeSponsorSettlementV4(f.reader,input)).available.map(o=>o.amountWei),['60','30']);
 state.paid=40n;assert.deepEqual((await observeSponsorSettlementV4(f.reader,input)).available.map(o=>o.action),['returnUnallocated']);
});
test('bad scope/accounting/runtime/chain and reorg fail closed before settlement preparation',async()=>{
 for(const patch of [{slot:1},{slot:6},{fundingHash:null},{plan:{...plan,chainId:143}}])await assert.rejects(observeSponsorSettlementV4({}, {...input,...patch}));
 const {f,state}=owned();state.unallocatedReturned=1n;await assert.rejects(observeSponsorSettlementV4(f.reader,input));state.unallocatedReturned=0n;
 await assert.rejects(observeSponsorSettlementV4({...f.reader,getCode:async()=> '0x1234'},input));
 let calls=0;await assert.rejects(observeSponsorSettlementV4({...f.reader,getChainId:async()=>++calls===1?31337:10143},input));
 const block=f.reader.getBlock;let reads=0;await assert.rejects(observeSponsorSettlementV4({...f.reader,getBlock:async p=>{const b=await block(p);return p.blockNumber===30n&&++reads>1?{...b,hash:h(999)}:b;}},input));
});
test('exact closed/return receipts are required, one return cannot repay paid awards or substitute the other lane',async()=>{
 for(const action of ['close','returnUnallocated','returnExpired']){const {f,state,mined}=owned();if(action!=='close')state.stage=4;const {operation}=await mined(action);
  const receipt=await verifySponsorSettlementReceiptV4(f.reader,input,operation,settlementHash);assert.equal(receipt.amountWei,action==='close'?'0':action==='returnUnallocated'?'60':'30');assert.equal(receipt.recipient,operation.recipient);
  const v=await observeSponsorSettlementV4(f.reader,input);assert(!v.available.some(o=>o.action===action));assert.equal(v.pot.paidWei,'10');
  await assert.rejects(verifySponsorSettlementReceiptV4(f.reader,input,{...operation,amountWei:'100'},settlementHash));
  if(action!=='close')await assert.rejects(verifySponsorSettlementReceiptV4(f.reader,input,{...operation,recipient:plan.operator},settlementHash));
 }
});
test('wrong sender/value/calldata/hash/log/finality and changed canonical receipt cannot confirm a return',async()=>{
 for(const field of ['sender','value','data','hash','recipient','amount','removed','duplicate','pending','reverted','reorg']){const {f,state,mined}=owned();state.stage=4;const {operation,tx,r}=await mined('returnExpired');
  if(field==='sender')tx.from=plan.funder;if(field==='value')tx.value=1n;if(field==='data')tx.input=sponsorSettlementDataV4('returnUnallocated');if(field==='hash')r.transactionHash=h(99);
  if(field==='recipient')r.logs[0].topics=encodeEventTopics({abi,eventName:'TreasuryReturned',args:{treasury:plan.operator}});if(field==='amount')r.logs[0].data=encodeAbiParameters([{type:'uint256'}],[40n]);
  if(field==='removed')r.logs[0].removed=true;if(field==='duplicate')r.logs.push({...r.logs[0]});if(field==='pending')f.anchor=30n;if(field==='reverted')r.status='reverted';
  if(field==='reorg'){const block=f.reader.getBlock;let receipts=0;f.reader.getBlock=async p=>{const b=await block(p);return p.blockNumber===31n&&++receipts>2?{...b,hash:h(999)}:b;};}
  await assert.rejects(verifySponsorSettlementReceiptV4(f.reader,input,operation,settlementHash),undefined,field);
 }
});
