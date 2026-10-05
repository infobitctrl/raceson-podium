import {setupId} from './distribution-setup.js';
export type CampaignBranding={id:string;name:string|null;logo:string|null;revision:number};
export type BrandingChange={name:string;logo:string|null;expectedRevision:number};
export function validBrandingLogo(value:unknown):value is string|null {
 if(value===null)return true;
 if(typeof value!=='string'||value.length>90000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))return false;
 try{
  const png=atob(value.slice(22));
  const uint=(offset:number)=>[0,1,2,3].reduce((n,i)=>n*256+png.charCodeAt(offset+i),0);
  return png.length>=45&&uint(8)===13&&png.slice(12,16)==='IHDR'&&uint(16)>0&&uint(16)<=256&&uint(20)>0&&uint(20)<=256&&png.slice(-8,-4)==='IEND';
 }catch{return false;}
}
export function decodeBrandingChange(value:unknown):BrandingChange {
 const c=value as BrandingChange;
 if(!c||Object.keys(c).sort().join()!=='expectedRevision,logo,name'||typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>80||/[\u0000-\u001f\u007f]/.test(c.name)||!validBrandingLogo(c.logo)||!Number.isInteger(c.expectedRevision)||c.expectedRevision<0||c.expectedRevision>99999999)throw Error('invalid_campaign_branding');
 return {...c,name:c.name.trim()};
}
export function decodeCampaignBranding(value:unknown):CampaignBranding[] {
 if(!Array.isArray(value))throw Error('invalid_campaign_branding');
 const ids=new Set<string>();
 return value.map(c=>{
  if(!c||Object.keys(c).sort().join()!=='id,logo,name,revision'||!setupId(c.id)||ids.has(c.id))throw Error('invalid_campaign_branding');
  ids.add(c.id);
  if(c.revision===0){if(c.name!==null||c.logo!==null)throw Error('invalid_campaign_branding');}
  else {decodeBrandingChange({name:c.name,logo:c.logo,expectedRevision:c.revision});if(c.revision<1)throw Error('invalid_campaign_branding');}
  return c;
 });
}
