import {allocateRewardWeights,parseRewardUnits} from "@raceson/domain/rewards";
import type {RewardDistributionSetup,RewardSetupNode} from "@raceson/domain/rewards/distribution-setup";
/** Decimal editor values must preserve every wei, unlike compact display labels. */
export function sponsorBudgetAmount(wei:bigint|null){
 if(wei===null)return "";
 const fraction=(wei%10n**18n).toString().padStart(18,"0").replace(/0+$/,"");
 return `${wei/10n**18n}${fraction?`.${fraction}`:""}`;
}
export function sponsorAmountShare(value:string,budget:string){
 const wei=parseRewardUnits(value,18),total=parseRewardUnits(budget,18);
 if(total<=0n||wei>total)throw Error("invalid_budget_amount");
 // Stored settings use whole basis points. Reflect the canonical result on blur.
 return Number((wei*10000n+total/2n)/total);
}

/** The rounds branch is a presentation group; saved pots keep their existing IDs. */
export function sponsorPotBranches(setup:RewardDistributionSetup){
 const pots=setup.guided?.pots;
 const league=setup.root.children.find(n=>pots?.some(p=>p.nodeId===n.id&&p.slot===0));
 const rounds=setup.root.children.filter(n=>pots?.some(p=>p.nodeId===n.id&&p.slot>0));
 if(!league||!rounds.length)throw Error("invalid_sponsor_pots");
 return {league,rounds,roundsBps:rounds.reduce((sum,n)=>sum+n.shareBps,0)};
}
function distribute(total:number,nodes:RewardSetupNode[],equal=false){
 if(!Number.isInteger(total)||total<0||total>10000||nodes.some(n=>n.locked))throw Error("invalid_sponsor_split");
 const weighted=!equal&&nodes.some(n=>n.shareBps>0);
 const allocation=allocateRewardWeights(BigInt(total),nodes.map(n=>({key:n.id,weight:BigInt(weighted?n.shareBps:1)})));
 return new Map(allocation.allocations.map(n=>[n.key,Number(n.amount)]));
}
function replaceShares(setup:RewardDistributionSetup,shares:Map<string,number>):RewardDistributionSetup{
 return {...setup,stage:"draft",root:{...setup.root,children:setup.root.children.map(n=>shares.has(n.id)?{...n,shareBps:shares.get(n.id)!}:n)}};
}
export function splitSponsorSections(setup:RewardDistributionSetup,leagueBps:number){
 const {league,rounds}=sponsorPotBranches(setup);
 if(league.locked)throw Error("locked_sponsor_pot");
 const shares=distribute(10000-leagueBps,rounds);shares.set(league.id,leagueBps);
 return replaceShares(setup,shares);
}
export function splitSponsorRoundsEqually(setup:RewardDistributionSetup){
 const {rounds,roundsBps}=sponsorPotBranches(setup);
 return replaceShares(setup,distribute(roundsBps,rounds,true));
}
/** Edit one round within its parent pot and rebalance the other rounds proportionally. */
export function setSponsorRoundShare(setup:RewardDistributionSetup,nodeId:string,withinRoundsBps:number){
 const {rounds,roundsBps}=sponsorPotBranches(setup);
 if(!Number.isInteger(withinRoundsBps)||withinRoundsBps<0||withinRoundsBps>10000||roundsBps<=0||rounds.some(n=>n.locked)||!rounds.some(n=>n.id===nodeId))throw Error("invalid_round_split");
 const share=Math.round(roundsBps*withinRoundsBps/10000);
 const shares=distribute(roundsBps-share,rounds.filter(n=>n.id!==nodeId));shares.set(nodeId,share);
 return replaceShares(setup,shares);
}
