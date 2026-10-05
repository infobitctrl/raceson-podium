import PodiumBrand from './PodiumBrand';
import s from './PodiumHeader.module.css';

// Controller authentication is separate; public navigation needs neither a
// sponsor session nor React Router inside the isolated controller composition.
export default function PodiumOperationsHeader(){
 return <header className={s.header}><div className={s.inner}>
  <a className={s.brand} href="/rewards" aria-label="RacesOn Podium" translate="no"><PodiumBrand/></a>
  <nav className={s.nav} aria-label="Main navigation"><a href="/rewards">Home</a><a href="/rewards/events">Events</a><a href="/rewards/campaigns">Campaigns</a><a href="/rewards/control" aria-current="page">Review</a></nav>
  <span className={s.utilities}>Operations</span>
 </div></header>;
}
