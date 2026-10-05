import {previewRewardSetup,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";

/** Sponsor configuration is independent of result-source and payout readiness. */
export function sponsorSetupComplete(configuration:RewardDistributionSetup):boolean{
 try{
  const preview=previewRewardSetup(configuration);
  return configuration.version===5&&Boolean(configuration.guided?.groups.length)&&preview.budgetWei>0n&&
   preview.rows.filter(row=>row.pathShare>0).every(row=>row.issue===null);
 }catch{return false;}
}
