import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePublicRewardPage} from '@raceson/domain/rewards/public-campaign';
import {publicAwardResponse} from '../dist/features/rewards/public-award-response.js';

const address='0x'+'11'.repeat(20), id=n=>'0x'+n.toString(16).padStart(64,'0');
const page={campaignId:'73000000-0000-4000-8000-000000000001',slot:1,chainId:10143,
 blockNumber:'10',blockTimestamp:'100',total:2,offset:0,sort:'reward',direction:'asc',availability:'open',rows:[
  {id:id(1),number:1,kind:'athlete',amountWei:'10',status:'claimed',recipientAddress:address,
   display:{name:'Synthetic athlete',club:null,timeMs:'1000'},breakdown:[{category:'Open',amountWei:'10',place:1}]},
  {id:id(2),number:2,kind:'club',amountWei:'20',status:'unclaimed',registeredAddress:address},
 ]};
// Freeze the exact row-key contract shipped before wallet links. A current
// decoder alone cannot catch a deployment that breaks already-open tabs.
function legacyDecode(value){
 for(const row of value.rows)assert.equal(Object.keys(row).sort().join(),
  ('id,number,kind,amountWei,status'+(row.breakdown===undefined?'':',breakdown')+(row.display===undefined?'':',display')).split(',').sort().join());
 return decodePublicRewardPage(value);
}
test('already-open clients retain complete verified rewards when wallet fields are introduced',()=>{
 assert.throws(()=>legacyDecode(page));
 for(const accept of [undefined,'application/json','*/*','application/vnd.raceson.reward-wallets.v2+json','application/vnd.raceson.reward-wallets.v1+json;q=0']){
  const response=publicAwardResponse(page,accept);
  assert.doesNotThrow(()=>legacyDecode(response));
  assert.deepEqual(response,{...page,rows:page.rows.map(({recipientAddress,registeredAddress,...row})=>row)});
  assert.equal(page.rows[0].recipientAddress,address);assert.equal(page.rows[1].registeredAddress,address);
 }
});
test('explicit wallet-capable clients retain paid and registered links at the same block',()=>{
 const response=publicAwardResponse(page,'application/vnd.raceson.reward-wallets.v1+json, application/json');
 assert.deepEqual(decodePublicRewardPage(response),page);
 assert.equal(response.blockNumber,'10');assert.deepEqual(response.rows.map(row=>row.status),['claimed','unclaimed']);
});
test('new clients accept a legacy server response and empty reward collections',()=>{
 assert.doesNotThrow(()=>decodePublicRewardPage(publicAwardResponse(page,'application/json')));
 const empty={...page,total:0,availability:'awaiting_approval',rows:[]};
 assert.deepEqual(legacyDecode(publicAwardResponse(empty)),empty);
});
