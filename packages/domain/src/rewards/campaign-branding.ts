import {setupId} from './distribution-setup.js';
export type SponsorPromotion={name:string;logo:string|null;website?:string|null;promotion?:string|null};
export type CampaignBranding={id:string;name:string|null;logo:string|null;revision:number;website?:string|null;promotion?:string|null};
export type BrandingChange=SponsorPromotion&{expectedRevision:number};
export function validSponsorWebsite(value:unknown):value is string|null {
 return value===null||typeof value==='string'&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value);
}
/** Website text is stored unchanged; only safe web destinations become links. */
export function sponsorWebsiteHref(value:string|null|undefined):string|null {
 if(!value||!validSponsorWebsite(value))return null;
 const text=value.trim();
 if(!text||/[\s\\]/.test(text))return null;
 const candidate=/^https?:\/\//i.test(text)?text:/^[a-z][a-z0-9+.-]*:/i.test(text)?null:`https://${text}`;
 if(!candidate)return null;
 try{const url=new URL(candidate);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&Boolean(url.hostname)?candidate:null;}catch{return null;}
}

export function validSponsorPromotion(value:unknown):value is string|null {
 return value===null||typeof value==='string'&&value.length<=1200&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
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
 if(!c||!['expectedRevision','logo','name'].every(key=>Object.hasOwn(c,key))||Object.keys(c).some(key=>!['expectedRevision','logo','name','website','promotion'].includes(key))||typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>80||/[\u0000-\u001f\u007f]/.test(c.name)||!validBrandingLogo(c.logo)||!Number.isInteger(c.expectedRevision)||c.expectedRevision<0||c.expectedRevision>99999999||c.website!==undefined&&!validSponsorWebsite(c.website)||c.promotion!==undefined&&!validSponsorPromotion(c.promotion))throw Error('invalid_campaign_branding');
 return {...c,name:c.name.trim()};
}
export function decodeCampaignBranding(value:unknown):CampaignBranding[] {
 if(!Array.isArray(value))throw Error('invalid_campaign_branding');
 const ids=new Set<string>();
 return value.map(c=>{
  if(!c||!['id','logo','name','revision'].every(key=>Object.hasOwn(c,key))||Object.keys(c).some(key=>!['id','logo','name','revision','website','promotion'].includes(key))||!setupId(c.id)||ids.has(c.id)||c.website!==undefined&&!validSponsorWebsite(c.website)||c.promotion!==undefined&&!validSponsorPromotion(c.promotion))throw Error('invalid_campaign_branding');
  ids.add(c.id);
  if(c.revision===0){if(c.name!==null||c.logo!==null||c.website!=null||c.promotion!=null)throw Error('invalid_campaign_branding');}
  else {decodeBrandingChange({name:c.name,logo:c.logo,expectedRevision:c.revision,website:c.website,promotion:c.promotion});if(c.revision<1)throw Error('invalid_campaign_branding');}
  return c;
 });
}
