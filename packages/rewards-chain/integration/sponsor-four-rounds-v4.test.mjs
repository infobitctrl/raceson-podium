import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {deployOriginalClubSafeFixture} from './safe-deployment-fixture.mjs';
import {sponsorDeploymentData,sponsorFundingData,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {sponsorClaimMessagesV4,sponsorSafeConsentMessageV4} from '../dist/sponsor-claims-v4.js';

// All sporting evidence, identities and money are synthetic. This starts its own
// loopback chain, accepts no provider/key input and does not touch the demo DB.
test('four V4 rounds release independently; athletes and 2-of-3 clubs claim explicitly', {timeout:120000}, async t => {
  const chain = await startOwnedRewardChain();
  try {
    const sponsor=fixtureSigner(0x990);
    await chain.testClient.setBalance({address:sponsor.address,value:101n*10n**18n});
    const mon=10n**18n, h=n=>'0x'+n.toString(16).padStart(64,'0');
    const abi=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnRewardCampaignV4.sol/RacesOnRewardCampaignV4.json',import.meta.url))).abi;
    const plan={version:4,launchId:'73000000-0000-4000-8000-000000000090',setupRevision:1,configurationHash:'c'.repeat(64),chainId:31337,
      funder:sponsor.address.toLowerCase(),operator:chain.operator.address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),
      expiredTreasury:sponsor.address.toLowerCase(),claimLifetime:7*86400,reviewPeriods:[0,0,0,0,0,0],
      caps:[50n,10n,10n,10n,10n,10n].map(x=>(x*mon).toString()),budgetWei:(100n*mon).toString()};
    const receipt=async(hash,success=true)=>{
      const r=await chain.publicClient.waitForTransactionReceipt({hash});
      assert.equal(r.status,success?'success':'reverted');return r;
    };
    const deployment=await chain.operatorClient.sendTransaction({data:sponsorDeploymentData(plan),gas:25_000_000n});
    const deployed=await receipt(deployment);
    const funding=await chain.operatorClient.sendTransaction({account:sponsor,to:deployed.contractAddress,data:sponsorFundingData(),value:100n*mon,gas:2_000_000n});
    await receipt(funding);
    const observe=async()=>{await chain.testClient.mine({blocks:96,interval:1});return observeSponsorProgramme(chain.publicClient,plan,deployment,funding);};
    const funded=await observe(), safe=await deployOriginalClubSafeFixture(chain), safeAddress=safe.expected.context.verifyingContract;
    const athlete=chain.relayer, claims=[];
    const write=(address,functionName,args=[],account=chain.operator,success=true)=>
      chain.operatorClient.writeContract({account,address,abi,functionName,args,gas:2_000_000n}).then(hash=>receipt(hash,success));
    const read=(address,functionName)=>chain.publicClient.readContract({address,abi,functionName});

    for (let slot=1;slot<=4;slot++) await t.test(`round ${slot}: publish exact awards without paying recipients or changing another pot`,async()=>{
      const child=funded.pots.find(p=>p.slot===slot).address, before=await observe();
      const awards=[{entitlementId:h(1),beneficiaryId:h(11),pot:0,amount:3n*mon,explanationHash:h(21),beneficiaryKind:0},
        {entitlementId:h(2),beneficiaryId:h(12),pot:0,amount:2n*mon,explanationHash:h(22),beneficiaryKind:1}];
      await write(child,'uploadAwards',[awards]);
      const timestamp=(await chain.publicClient.getBlock()).timestamp;
      await write(child,'stageAllocation',[h(100+slot),await read(child,'uploadDigest'),2n,timestamp,timestamp,h(200+slot)]);
      const digest=await read(child,'allocationDigest');await write(child,'activate',[digest,h(100+slot)]);
      const after=await observe(), pot=after.pots.find(p=>p.slot===slot);
      assert.equal(pot.state,3);assert.equal(pot.allocatedWei,(5n*mon).toString());assert.equal(pot.paidWei,'0');
      assert.equal(pot.remainingWei,(10n*mon).toString());
      assert.deepEqual(after.pots.filter(p=>p.slot!==slot),before.pots.filter(p=>p.slot!==slot));
      claims.push({slot,child,digest});
    });

    for (const {slot,child,digest} of claims) await t.test(`round ${slot}: no payout without consent; manual athlete and Safe claims conserve balances`,async()=>{
      const issuedAt=(await chain.publicClient.getBlock()).timestamp,expiresAt=issuedAt+86400n;
      const context={environment:'local-simulation',chainId:31337,verifyingContract:child};
      const claim={entitlementId:h(1),recipient:athlete.address,amount:3n*mon,pot:'race',nonce:0n,issuedAt,expiresAt,allocationDigest:digest};
      const messages=sponsorClaimMessagesV4(context,claim);
      const approval=await chain.operator.signTypedData(messages.authorization),consent=await athlete.signTypedData(messages.consent);
      const args=[claim.entitlementId,claim.recipient,0n,issuedAt,expiresAt,approval,consent];
      await write(child,'claim',[...args.slice(0,6),'0x'],athlete,false);
      const balance=await chain.publicClient.getBalance({address:athlete.address});
      const r=await write(child,'claim',args,athlete);
      const tx=await chain.publicClient.getTransaction({hash:r.transactionHash});
      assert.equal((await chain.publicClient.getBalance({address:athlete.address}))-balance,3n*mon-tx.gas*r.effectiveGasPrice);
      await write(child,'claim',args,athlete,false);
      const other=claims.find(p=>p.slot!==slot);
      await write(other.child,'claim',args,athlete,false); // contract-bound consent cannot be replayed

      const club={...claim,entitlementId:h(2),recipient:safeAddress,amount:2n*mon};
      const clubApproval=await chain.operator.signTypedData(sponsorClaimMessagesV4(context,club).authorization);
      const owners=[...chain.clubOwners].sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0,2);
      const signatures=await Promise.all(owners.map(owner=>owner.signTypedData(sponsorSafeConsentMessageV4(context,club))));
      const clubArgs=[club.entitlementId,safeAddress,0n,issuedAt,expiresAt,clubApproval];
      await write(child,'claim',[...clubArgs,signatures[0]],chain.operator,false);
      const beforeSafe=await chain.publicClient.getBalance({address:safeAddress});
      await write(child,'claim',[...clubArgs,'0x'+signatures.map(s=>s.slice(2)).join('')]);
      assert.equal((await chain.publicClient.getBalance({address:safeAddress}))-beforeSafe,2n*mon);
      const pot=(await observe()).pots.find(p=>p.slot===slot);
      assert.equal(pot.paidWei,(5n*mon).toString());assert.equal(pot.remainingWei,(5n*mon).toString());assert.equal(pot.returnedWei,'0');
    });
    const final=await observe();
    assert.equal(final.pots.reduce((n,p)=>n+BigInt(p.paidWei),0n),20n*mon);
    assert.equal(final.pots.reduce((n,p)=>n+BigInt(p.remainingWei),0n),80n*mon);
    assert.ok(final.pots.filter(p=>[0,5].includes(p.slot)).every(p=>p.state===1&&p.allocatedWei==='0'&&p.paidWei==='0'&&p.remainingWei===p.amountWei));
  } finally {await chain.stop();}
});
