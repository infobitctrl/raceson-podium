import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'viem';
import {createBytecodeHashMatcher} from '../dist/bytecode-hash.js';
import {sponsorProgrammeBuild} from '../dist/sponsor-v4-build.js';
import {sponsorProgrammeBuildV5,sponsorFactoryBuildV5,walletRegistryBuildV1} from '../dist/sponsor-v5-build.js';
import {sponsorProgrammeBuildV6,sponsorFactoryBuildV6,walletRegistryBuildV2} from '../dist/sponsor-v6-build.js';
import {observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {fixture,plan,deploymentHash,fundingHash} from './sponsor-settlement-fixture.mjs';

test('bytecode comparisons match uncached Keccak across versions, eviction and oversized input',()=>{
 for(const match of [createBytecodeHashMatcher(),createBytecodeHashMatcher(1),createBytecodeHashMatcher(32,4)]){
  const codes=[sponsorProgrammeBuild,sponsorProgrammeBuildV5,sponsorProgrammeBuildV6,sponsorFactoryBuildV5,sponsorFactoryBuildV6,walletRegistryBuildV1,walletRegistryBuildV2].map(b=>b.bytecode);
  for(const code of [...codes,...codes.reverse()]){
   const digest=keccak256(code);
   assert.equal(match(code,digest),true);assert.equal(match(code,digest),true);
   const changed=code.slice(0,-2)+(code.endsWith('ff')?'00':'ff');
   assert.equal(match(changed,digest),false);
   assert.equal(match(code,keccak256('0xdeadbeef')),false);
   assert.equal(match(code,digest),true);
  }
 }
});

test('warm bytecode reuse still reads fresh state and rejects altered code, immutables and finality',async()=>{
 for(const change of ['code','immutable','chain','anchor','funding']){
  const f=fixture({funded:true,viaFactory:true}),calls={};
  const reader=Object.fromEntries(Object.entries(f.reader).map(([name,fn])=>[name,async(...args)=>{calls[name]=(calls[name]??0)+1;return fn(...args);} ]));
  const first=await observeSponsorProgramme(reader,plan,deploymentHash,fundingHash),before={...calls};
  assert.deepEqual(await observeSponsorProgramme(reader,plan,deploymentHash,fundingHash),first);
  for(const name of Object.keys(before))assert.equal(calls[name],before[name]*2,`${name} must still run`);
  if(change==='code'){const read=reader.getCode;reader.getCode=async args=>{const code=await read(args);return code.slice(0,-2)+(code.endsWith('ff')?'00':'ff');};}
  if(change==='immutable'){
   const read=reader.getCode;reader.getCode=async args=>{const code=await read(args);
    if(code.length!==sponsorProgrammeBuild.runtimeBytes*2+2)return code;
    const offset=Object.values(sponsorProgrammeBuild.offsets)[0][0]*2+2;
    return code.slice(0,offset)+'f'.repeat(64)+code.slice(offset+64);
   };
  }
  if(change==='chain')reader.getChainId=async()=>10143;
  if(change==='anchor'){const read=reader.getBlock;reader.getBlock=async args=>{const block=await read(args);return args.blockNumber===30n?{...block,hash:'0x'+'ff'.repeat(32)}:block;};}
  if(change==='funding')f.deposited.logs=[];
  await assert.rejects(()=>observeSponsorProgramme(reader,plan,deploymentHash,fundingHash));
 }
});
