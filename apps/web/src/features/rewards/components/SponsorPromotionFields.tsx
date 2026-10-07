import {useEffect,useId,useRef,useState} from 'react';
import type {SponsorPromotion} from '@raceson/domain/rewards/campaign-branding';
import {prepareSponsorLogo} from '../data/campaignBranding';
import s from './SponsorPromotionFields.module.css';

export default function SponsorPromotionFields({value,onChange,disabled=false,hr=false,onPreparing}:{value:SponsorPromotion;onChange:(value:SponsorPromotion)=>void;disabled?:boolean;hr?:boolean;onPreparing?:(value:boolean)=>void}){
 const id=useId(),version=useRef(0),[reading,setReading]=useState(false),[error,setError]=useState(''),t=(en:string,local:string)=>hr?local:en;
 useEffect(()=>()=>{version.current++;},[]);
 return <fieldset className={s.fields} disabled={disabled||reading}>
  <label>{t('Sponsor name','Naziv sponzora')}<input autoComplete="organization" maxLength={80} value={value.name} onChange={e=>onChange({...value,name:e.target.value})}/></label>
  <div className={s.imageRow}>{value.logo?<img src={value.logo} alt={t('Sponsor image preview','Pregled slike sponzora')}/>:<span className={s.placeholder} aria-hidden="true">{t('Your image','Vaša slika')}</span>}<div><label htmlFor={`${id}-image`}>{t('Upload logo or image','Učitaj logotip ili sliku')}</label><input id={`${id}-image`} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const current=++version.current;setReading(true);onPreparing?.(true);setError('');void prepareSponsorLogo(file).then(logo=>{if(current===version.current)onChange({...value,logo});}).catch(()=>{if(current===version.current)setError(t('Choose a PNG, JPG or WebP under 2 MB.','Odaberite PNG, JPG ili WebP do 2 MB.'));}).finally(()=>{if(current===version.current){setReading(false);onPreparing?.(false);}});}}/><small>PNG, JPG, WebP · {t('up to 2 MB','do 2 MB')}</small>{value.logo?<button type="button" onClick={()=>onChange({...value,logo:null})}>{t('Remove image','Ukloni sliku')}</button>:null}</div></div>
  <label>{t('Website','Web-stranica')}<input type="text" inputMode="url" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="example.com" maxLength={300} value={value.website??''} onChange={e=>onChange({...value,website:e.target.value||null})}/></label>
  <label>{t('About your promotion','O vašoj promociji')}<textarea aria-label={t('About your promotion','O vašoj promociji')} rows={4} maxLength={1200} placeholder={t('Introduce your brand, offer or support for the event.','Predstavite svoj brend, ponudu ili podršku događaju.')} value={value.promotion??''} onChange={e=>onChange({...value,promotion:e.target.value||null})}/><small>{(value.promotion??'').length}/1200</small></label>
  {reading?<p role="status">{t('Preparing image…','Priprema slike…')}</p>:null}{error?<p role="alert" className={s.error}>{error}</p>:null}
 </fieldset>;
}
export function SponsorPromotionPreview({value,hr=false}:{value:SponsorPromotion;hr?:boolean}){
 if(!value.name&&!value.logo&&!value.website&&!value.promotion)return null;
 return <div className={s.preview}>{value.logo?<img src={value.logo} alt=""/>:null}<div><strong>{value.name}</strong>{value.website?<span>{value.website}</span>:null}{value.promotion?<p>{value.promotion}</p>:null}<small>{hr?'Pregled sponzora':'Sponsor preview'}</small></div></div>;
}
