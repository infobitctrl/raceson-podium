import s from './PodiumHeader.module.css';
import podiumLogo from '../assets/optimized/podium-logo.webp';
import {staticAssetUrl} from '@/lib/static-asset';

export default function PodiumBrand(){
 return <img className={s.logo} src={staticAssetUrl(podiumLogo)} width={560} height={239} alt="RacesOn Podium"/>;
}
