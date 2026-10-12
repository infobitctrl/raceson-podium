import assert from 'node:assert/strict';
import test from 'node:test';
import {createPublicDirectoryReader} from '../dist/sponsor-v4.js';

test('staggered public observers share one finalized header and only its bytecode within a refresh',async()=>{
 let headers=0,codes=0;const calls=[];
 const underlying={getBlock:async p=>{calls.push(p);return {number:BigInt(++headers),hash:`block${headers}`};},getCode:async()=>{codes++;return '0x1234';}};
 const reader=createPublicDirectoryReader(underlying),address='0x'+'ab'.repeat(20);
 const first=await reader.getBlock({blockTag:'finalized'});
 assert.equal(await reader.getBlock({blockTag:'finalized'}),first);assert.equal(headers,1);
 await Promise.all([reader.getCode({address,blockNumber:1n}),reader.getCode({address:address.toUpperCase(),blockNumber:1n})]);
 await reader.getCode({address,blockNumber:1n});assert.equal(codes,1);
 // Historical bytecode and canonical block rechecks must remain fresh.
 await reader.getCode({address,blockNumber:0n});await reader.getCode({address,blockNumber:0n});assert.equal(codes,3);
 const canonical=await reader.getBlock({blockNumber:1n});assert.notEqual(canonical.hash,first.hash);
 await reader.getBlock({blockNumber:1n});await reader.getBlock({blockTag:'finalized',includeTransactions:true});assert.equal(headers,4);
 const next=createPublicDirectoryReader(underlying);await next.getBlock({blockTag:'finalized'});assert.equal(headers,5);
 await next.getCode({address,blockNumber:5n});assert.equal(codes,4);
});

test('receipt, state and chain reads remain fresh; failed code cannot become a successful observation',async()=>{
 let chains=0,receipts=0,codes=0;
 const underlying={getChainId:async()=>++chains,getBlock:async()=>({number:1n}),getTransactionReceipt:async()=>++receipts,
  getCode:async()=>{codes++;throw Error('provider_offline');}};
 const reader=createPublicDirectoryReader(underlying);
 await reader.getBlock({blockTag:'finalized'});
 assert.equal(await reader.getChainId(),1);assert.equal(await reader.getChainId(),2);
 assert.equal(await reader.getTransactionReceipt({hash:'0x00'}),1);assert.equal(await reader.getTransactionReceipt({hash:'0x00'}),2);
 for(let i=0;i<2;i++)await assert.rejects(reader.getCode({address:'0x00',blockNumber:1n}),/provider_offline/);
 assert.equal(codes,1);
});
