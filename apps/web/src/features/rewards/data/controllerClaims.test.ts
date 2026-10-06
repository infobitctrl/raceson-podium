import {expect,it,vi} from 'vitest';
import {getControllerClaims,requestControllerClaim} from './controllerClaims';
const id='7d000000-0000-4000-8000-000000000009',wallet='0x'+'2'.repeat(40);
const view={schema:'raceson-sponsor-claim-view-v4',claimId:id,approvalId:id,chainId:10143,role:'operator',current:false,status:'held',sourceStamp:'b'.repeat(64),profileFingerprint:'c'.repeat(64),operatorAddress:wallet,address:'0x'+'a'.repeat(40),claim:null,context:null,signing:null,transaction:null,receipt:null};
it('native claim reader binds exact ID, approval, role and immutable operator',async()=>{
 const request=vi.fn().mockResolvedValue(view);expect((await requestControllerClaim(request,wallet,id,id)).status).toBe('held');expect(request).toHaveBeenCalledExactlyOnceWith(`/claims/${id}`,undefined);
 for(const patch of [{approvalId:'7d000000-0000-4000-8000-000000000010'},{role:'recipient'},{chainId:31337},{operatorAddress:'0x'+'3'.repeat(40)}]){request.mockResolvedValue({...view,...patch});await expect(requestControllerClaim(request,wallet,id,id)).rejects.toThrow();}
});
it('native claim queue has bounded exact-approval paging and no browser identity overrides',async()=>{
 const request=vi.fn().mockResolvedValue({items:[],nextCursor:null});expect((await getControllerClaims(request,id)).items).toHaveLength(0);expect(request).toHaveBeenCalledExactlyOnceWith(`/claims?approvalId=${id}`);
 await expect(getControllerClaims(request,'wrong')).rejects.toThrow();await expect(getControllerClaims(request,id,'wrong')).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
});
