import {expect,it} from 'vitest';
import {athleteClaimSteps,clubClaimSteps} from './claimWorkflow';
const initial={hr:false,loading:false,failed:false,walletSelected:false,signatureCollected:false,consented:false,approved:false,payment:'unknown' as const,held:false,expired:false};
it('wallet choice is not proof and an in-memory signature is not recorded consent or payment',()=>{
 const chosen=athleteClaimSteps({...initial,walletSelected:true});expect(chosen[1].state).toBe('current');expect(chosen[2].state).toBe('waiting');
 const signed=athleteClaimSteps({...initial,signatureCollected:true});expect(signed[1].state).toBe('complete');expect(signed[2].state).toBe('current');expect(signed[4].state).toBe('waiting');
 const approved=athleteClaimSteps({...initial,consented:true,approved:true,payment:'submitted'});expect(approved[3].state).toBe('current');expect(approved[4].state).toBe('waiting');
 const paid=athleteClaimSteps({...initial,consented:true,approved:true,payment:'confirmed'});expect(paid.every(s=>s.state==='complete')).toBe(true);expect(paid[3].detail).toMatch(/approval and payment are confirmed/);
});
it.each([{loading:true},{failed:true}])('does not show completed stages with unavailable facts %j',patch=>{
 expect(athleteClaimSteps({...initial,consented:true,approved:true,payment:'confirmed',...patch})).toEqual([expect.objectContaining({state:'unverified'})]);
});
it.each([{held:true},{expired:true}])('blocks forward guidance for a held or expired award %j',patch=>{
 const steps=athleteClaimSteps({...initial,consented:true,...patch});expect(steps[3].state).toBe('waiting');expect(steps[3].detail).toMatch(/review|ended/);
});
it('club quorum collection does not imply consent recording or confirmed payment',()=>{
 const base={hr:false,loading:false,failed:false,stopped:false,signatures:1,recorded:false};
 expect(clubClaimSteps(base)[1].state).toBe('current');
 const quorum=clubClaimSteps({...base,signatures:2});expect(quorum[1].state).toBe('complete');expect(quorum[2].state).toBe('current');expect(quorum[3].state).toBe('waiting');
 expect(clubClaimSteps({...base,recorded:true})[2].state).toBe('complete');
 expect(clubClaimSteps({...base,stopped:true})).toEqual([expect.objectContaining({state:'unverified'})]);
});
it('uses Croatian stage and recovery descriptions',()=>{
 expect(athleteClaimSteps({...initial,hr:true})[2].title).toBe('Tvoj pristanak');
 expect(clubClaimSteps({hr:true,loading:false,failed:true,stopped:true,recorded:false,signatures:0})[0].detail).toMatch(/Zatvori/);
});
