import {apiRequest} from '@/lib/api';
import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {decodeSponsorLaunchView} from '@raceson/domain/rewards/sponsor-launch';
import {decodeCopySponsorLaunchBinding} from '@raceson/domain/rewards/copy-sponsor-launch';
export async function hostedSponsorLaunch(id:string,change?:{requestId:string;expectedRevision:number}){
 if(!setupId(id))throw Error('invalid_sponsor_launch');
 const value=await apiRequest<{view:unknown;binding:unknown}>({path:`/v1/rewards/demo-copy/sponsor-setups/${id}/launch`,cache:'no-store',
  ...(change?{method:'POST' as const,body:change}:{})});
 const view=decodeSponsorLaunchView(value.view,10143,id);
 const binding=view.launch?decodeCopySponsorLaunchBinding(value.binding,view.launch):null;
 if(!view.launch&&value.binding!==null||change&&view.launch?.setup.revision!==change.expectedRevision)throw Error('invalid_sponsor_launch');
 return {view,binding};
}
