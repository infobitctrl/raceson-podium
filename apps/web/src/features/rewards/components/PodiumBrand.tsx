import s from './PodiumHeader.module.css';
import podiumLogo from '@/assets/brand/podium-trisport-logo.png';
import {staticAssetUrl} from '@/lib/static-asset';

export default function PodiumBrand(){
 return <img className={s.logo} src={staticAssetUrl(podiumLogo)} width={1918} height={820} alt="RacesOn Podium"/>;
}
