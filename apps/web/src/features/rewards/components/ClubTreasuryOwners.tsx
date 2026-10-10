import RewardExplorerLink from './RewardExplorerLink';
import styles from './ClubTreasuryOwners.module.css';
/** Display metadata only: the exact owner address remains the authority. */
export default function ClubTreasuryOwners({owners,display,signatures,hr}:{owners:string[];display?:{address?:string;name?:string}[];signatures?:{address:string}[];hr:boolean}){
 const t=(en:string,local:string)=>hr?local:en;
 return <div className={styles.owners}><h4>{t('Treasury owners','Vlasnici riznice')}</h4><p>{t('Any two of these three owners must approve.','Bilo koja dva od ova tri vlasnika moraju odobriti.')}</p>
  <ul aria-label={t('Treasury owners','Vlasnici riznice')}>{owners.map(owner=>{
   const matches=display?.filter(d=>d.address?.toLowerCase()===owner.toLowerCase())??[];
   const name=matches.length===1?matches[0]!.name?.trim()||null:null;
   return <li key={owner}><div><strong>{name??t('Owner name unavailable','Ime vlasnika nije dostupno')}</strong><RewardExplorerLink chainId={10143} kind="address" value={owner}/></div>
    {signatures?<span>{signatures.some(p=>p.address.toLowerCase()===owner.toLowerCase())?t('Signed','Potpisano'):t('Awaiting signature','Čeka se potpis')}</span>:null}</li>;
  })}</ul>
 </div>;
}
