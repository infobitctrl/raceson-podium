import s from './PodiumHeader.module.css';
import {brandNavbarLight,brandNavbarSymbolLight} from '@/shared/brand/brandAssets';

export default function PodiumBrand(){
 return <>
  <img className={s.logo} src={brandNavbarSymbolLight} width={192} height={137} alt="" aria-hidden="true"/>
  <span className={s.brandName}>
   <img className={s.wordmark} src={brandNavbarLight} width={384} height={73} alt="RacesOn"/>
   <b>Podium</b>
  </span>
 </>;
}
