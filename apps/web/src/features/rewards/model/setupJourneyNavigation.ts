export function goToSetupStep(step:number){
 document.getElementById(`setup-step-${step}`)?.scrollIntoView?.({block:'start',behavior:'smooth'});
}
