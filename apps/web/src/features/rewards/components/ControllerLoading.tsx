import s from '../screens/RewardsControl.module.css';

/** Keep the selected workspace in place while server facts are unknown. */
export function ControllerResultsLoading({label='Loading approved results…',pending=true}:{label?:string;pending?:boolean}){
 return <section id="controller-results" tabIndex={-1} aria-busy={pending} aria-label="Loading results" className={s.loadingResults}>
  <h3>Official results & rewards</h3><p role="status">{label}</p>
  <div className={s.loadingRows} aria-hidden="true">{Array.from({length:6},(_,i)=><div key={i}/>)}</div>
 </section>;
}
export default function ControllerLoading({label}:{label:string}){
 return <div className={s.distributionLayout} aria-label="Loading controller workspace">
  <ControllerResultsLoading label={label}/>
  <aside className={s.workflowPanel}><h2>From results to claims</h2><p>Loading your authorized workspace. Results and signing actions appear after verification.</p></aside>
 </div>;
}
