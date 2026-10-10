import test from 'node:test';
import assert from 'node:assert/strict';
import {clubApprovalExpiry,identityBindingLifetimeSeconds} from '../dist/features/rewards/club-approval-lifetime.js';
import {currentClubOwnerRequest} from '../dist/features/rewards/club-owner-approvals-service.js';
test('existing club approvals outlive wallet-control proof, stay within 24h and respect prize deadline',()=>{
 const now=1800000000n;
 assert.equal(clubApprovalExpiry(now,now+604800n),now+86400n);
 assert.equal(clubApprovalExpiry(now,now+600n),now+600n);
 assert.equal(identityBindingLifetimeSeconds(0),600n);
 assert.equal(identityBindingLifetimeSeconds(1),86400n);
 const current={status:'claimable',deadline:String(now+604800n)},request={body:{...current,transaction:{}},expiresAt:new Date(Number(now+86400n)*1000).toISOString()};
 assert(currentClubOwnerRequest(request,current,Number(now+900n)*1000));
 assert(!currentClubOwnerRequest(request,current,Number(now+86400n)*1000));
 assert(!currentClubOwnerRequest(request,{...current,status:'paid'},Number(now+900n)*1000));
});
