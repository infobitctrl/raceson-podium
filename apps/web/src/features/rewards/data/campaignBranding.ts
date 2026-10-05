import {setupId} from '@raceson/domain/rewards/distribution-setup';
import {apiRequest} from '@/lib/api';
import {decodeCampaignBranding,decodeBrandingChange,type BrandingChange} from '@raceson/domain/rewards/campaign-branding';
export async function readCampaignBranding(mine=false){return decodeCampaignBranding(await apiRequest({path:`/v1/rewards/campaign-branding${mine?'/mine':''}`,cache:'no-store'}));}
export async function saveCampaignBranding(id:string,change:BrandingChange){
 if(!setupId(id))throw Error('invalid_campaign_branding');
 const body=decodeBrandingChange(change),rows=decodeCampaignBranding(await apiRequest({path:`/v1/rewards/campaign-branding/${id}`,method:'PATCH',body,cache:'no-store'}));
 if(rows.length!==1||rows[0].id!==id||rows[0].name!==body.name||rows[0].logo!==body.logo||rows[0].revision!==body.expectedRevision+1)throw Error('invalid_campaign_branding');
 return rows[0];
}
/** Decode and re-encode the chosen raster locally; never load arbitrary remote URLs. */
export async function prepareSponsorLogo(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('invalid_logo');
 const bitmap=await createImageBitmap(file);
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width>4096||bitmap.height>4096)throw Error('invalid_logo');
  const canvas=document.createElement('canvas'),ratio=Math.min(1,256/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const context=canvas.getContext('2d');if(!context)throw Error('invalid_logo');
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const result=canvas.toDataURL('image/png');if(result.length>90000)throw Error('invalid_logo');return result;
 }finally{bitmap.close();}
}
