import type {PublicDirectory} from '@raceson/domain/rewards/public-directory';
import {useI18n} from '@/shared/i18n/I18nContext';
import s from './Podium.module.css';
import status from './PodiumDirectoryStatus.module.css';

export default function PodiumDirectoryStatus({data,fetching,error,onRefresh}:{data?:PublicDirectory;fetching:boolean;error:boolean;onRefresh:()=>void}){
 const {locale}=useI18n(),hr=locale==='hr';
 const checking=fetching||(!error&&(!data||data.refreshStatus==='refreshing'));
 const failed=error||data?.refreshStatus==='failed';
 return <div className={status.panel} data-state={checking?'checking':failed?'failed':'current'}>
  <div role="status"><strong>{checking?(hr?'Provjera stanja kampanja':'Checking campaign status'):failed?(data?(hr?'Prikazani su raniji podaci':'Showing earlier figures'):(hr?'Stanje kampanja nije dostupno':'Campaign status unavailable')):(hr?'Stanje kampanja provjereno':'Campaign status checked')}</strong><details><summary>{hr?'Detalji provjere':'Verification details'}</summary><span>{data?.items.length?<>
   {hr?'Potvrđeni zapisi · najstarije stanje':'Verified records · oldest observation'}{' '}
   <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString(hr?'hr-HR':'en-GB')}</time>.
   {' '}{checking?(hr?'Provjera novog stanja u pozadini…':'Checking for updates in the background…'):failed?(hr?'Osvježavanje nije uspjelo. Prikazano je posljednje poznato stanje.':'Refresh failed. Showing last known figures.')
    :(hr?'Podaci mogu biti iz različitih potvrđenih blokova.':'Figures may come from different confirmed blocks.')}
  </>:data?(checking?(hr?'Posljednji poznati popis je prazan. Provjeravamo novo stanje…':'The last known published list is empty. Checking for updates…'):failed?(hr?'Osvježavanje nije uspjelo. Posljednji poznati popis je prazan.':'Refresh failed. The last known published list is empty.')
   :(hr?'Trenutačno nema objavljenih kampanja.':'No campaigns are currently published.'))
   :(checking?(hr?'Učitavanje objavljenih kampanja…':'Loading published campaigns…'):(hr?'Podaci o kampanjama nisu učitani. Pokušajte ponovno.':'Campaign data could not be loaded. Please try again.'))}</span></details>{data?.items.length?<time className={status.time} dateTime={data.checkedAt}>{hr?'Najstarija provjera · ':'Oldest check · '}{new Date(data.checkedAt).toLocaleString(hr?'hr-HR':'en-GB')}</time>:null}</div>
  <button className={s.secondary} disabled={checking} onClick={onRefresh}>{checking?(hr?'Provjera…':'Checking…'):(!data&&failed?(hr?'Pokušaj ponovno':'Try again'):(hr?'Osvježi stanje':'Refresh status'))}</button>
 </div>;
}
