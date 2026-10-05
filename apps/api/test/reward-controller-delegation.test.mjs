import test from 'node:test';
import assert from 'node:assert/strict';
import {generateP256KeyPair} from '@privy-io/node';
import {controllerDeploymentRules,verifyControllerDelegation} from '../dist/features/rewards/sponsor-creation-privy.js';
test('deployment key cannot own wallet/policy or gain a broad zero-value grant',async()=>{
 const keys=await generateP256KeyPair(),c={version:1,appId:'test',walletId:'controller',address:'0x'+'11'.repeat(20),ownerId:'user-owner',signerId:'service-key',policyId:'policy',factory:'0x'+'22'.repeat(20)};
 const wallet={address:c.address,chain_type:'ethereum',owner_id:c.ownerId,policy_ids:[],additional_signers:[{signer_id:c.signerId,override_policy_ids:[c.policyId]}]};
 const policy={owner_id:c.ownerId,chain_type:'ethereum',version:'1.0',rules:controllerDeploymentRules(c.factory,c.address)};
 const signer={authorization_threshold:1,authorization_keys:[{public_key:keys.publicKey}],user_ids:[],key_quorum_ids:[]},owner={authorization_threshold:1,authorization_keys:[],user_ids:['did:privy:controller'],key_quorum_ids:[]};
 const client=(w=wallet,p=policy,s=signer,o=owner)=>({wallets:()=>({get:async()=>w}),policies:()=>({get:async()=>p}),keyQuorums:()=>({get:async id=>id===c.ownerId?o:s})});
 await verifyControllerDelegation(client(),c,keys.privateKey);
 for(const [w,p,s,o]of [[{...wallet,additional_signers:[]},policy,signer,owner],[{...wallet,additional_signers:[{signer_id:c.signerId,override_policy_ids:[]}]},policy,signer,owner],[wallet,{...policy,owner_id:c.signerId},signer,owner],[wallet,{...policy,rules:[{...policy.rules[0],conditions:policy.rules[0].conditions.slice(0,2)}]},signer,owner],[wallet,policy,{...signer,user_ids:['did:privy:other']},owner],[wallet,policy,signer,{...owner,authorization_keys:[{public_key:keys.publicKey}]}]])await assert.rejects(verifyControllerDelegation(client(w,p,s,o),c,keys.privateKey),/controller_delegation/);
});
