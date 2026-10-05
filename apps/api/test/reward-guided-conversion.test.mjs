import assert from "node:assert/strict";
import test from "node:test";
import {convertToGuidedSetup,inspectGuidedConversion} from "../../../packages/domain/dist/rewards/guided-setup-conversion.js";
import {setupReadiness,setupNodes,presetSetupShares} from "../../../packages/domain/dist/rewards/distribution-setup.js";
import {legacyConversionFixture} from "./fixtures/guided-conversion.mjs";
import {id} from "./fixtures/published-reward-v2.mjs";
test("legacy league and five rounds become six pots with exact group/prize amounts and unallocated budget",()=>{
  const {source,potIds,choices}=legacyConversionFixture(),before=structuredClone(source);
  const result=convertToGuidedSetup(source,potIds,choices);
  assert.deepEqual(source,before);assert.equal(result.configuration.version,5);
  assert.deepEqual(result.configuration.root.children.map(n=>n.shareBps),[5000,1000,1000,1000,1000,1000]);
  assert.deepEqual(result.configuration.root.children[0].children.map(n=>n.shareBps),[2000,4000,2000]);
  assert.equal(result.retainedBeforeWei,10000n*10n**18n);assert.equal(result.retainedAfterWei,result.retainedBeforeWei);
  assert.ok(result.comparison.every(r=>r.beforeWei===r.afterWei));
  assert.ok(result.comparison.filter(r=>r.kind==="group").every(r=>JSON.stringify(r.beforeShares)===JSON.stringify(r.afterShares)));
  assert.deepEqual(result.removedContainers.map(n=>n.name),["Races"]);
  assert.deepEqual(result.configuration.guided.groups.slice(0,3).map(g=>[g.type,g.method]),[["athlete_finishes","ranked"],["athlete_metres","ranked"],["club_metres","ranked"]]);
  assert.ok(result.configuration.guided.groups.every(g=>!g.eligibilityApproved));
  assert.deepEqual(setupReadiness(result.configuration),["event","distribution","sources"]);
});
test("roles are mandatory and labels cannot silently choose a metric or distribution",()=>{
  const {source,potIds,choices}=legacyConversionFixture();
  assert.throws(()=>convertToGuidedSetup(source,potIds,[]));
  const explicit=structuredClone(choices);explicit[2].type="club_standings";
  const result=convertToGuidedSetup(source,potIds,explicit);
  assert.equal(result.configuration.guided.groups[2].type,"club_standings");
  assert.equal(result.configuration.root.children[0].children[2].name,"Club Kms");
  assert.throws(()=>convertToGuidedSetup(source,potIds,[...choices.slice(0,-1),{...choices.at(-1),type:"club_metres"}]));
  assert.throws(()=>convertToGuidedSetup(source,potIds,[...choices.slice(0,-1),choices[0]]));
});
test("unfinished groups require explicit new prizes and compare the change in unused budget",()=>{
  const {source,potIds,choices}=legacyConversionFixture();source.root.children[1].children[0].children[0].rule=null;
  assert.throws(()=>convertToGuidedSetup(source,potIds,choices));
  const result=convertToGuidedSetup(source,potIds,choices.map((c,i)=>i===3?{...c,newPrizeCount:5,newPrizeCurve:"descending"}:c));
  assert.equal(result.retainedBeforeWei-result.retainedAfterWei,10000n*10n**18n);
  assert.equal(result.configuration.root.children[1].children[0].rule.sharesBps.length,5);
  assert.equal(source.root.children[1].children[0].children[0].rule,null);
});
test("uncovered or overlapping pots and overallocated trees are refused",()=>{
  const {source,potIds,choices}=legacyConversionFixture();
  assert.throws(()=>inspectGuidedConversion(source,[potIds[0],source.root.children[1].id,...potIds.slice(2)]));
  assert.throws(()=>inspectGuidedConversion(source,[...potIds.slice(0,5),potIds[0]]));
  source.root.children[0].children[0].shareBps=5000;
  assert.throws(()=>convertToGuidedSetup(source,potIds,choices),/overallocated/);
});
test("flattening refuses fractional basis points and integer rounding changes instead of redistributing",()=>{
  const {source,potIds,choices}=legacyConversionFixture();
  source.root.children[1].shareBps=4999;source.root.children[1].children[0].shareBps=1999;
  assert.throws(()=>convertToGuidedSetup(source,potIds,choices),/precision/);
  const tiny=legacyConversionFixture();tiny.source.budgetMon="0.000000000000000007";
  assert.throws(()=>convertToGuidedSetup(tiny.source,tiny.potIds,tiny.choices),/precision/);
});
test("the 46-node, 355-prize legacy shape keeps seven independent categories in every round",()=>{
  const {source,potIds,choices}=legacyConversionFixture();let sequence=4000;
  const mapped=choices.slice(0,3);
  source.root.children[1].children.forEach((round,index)=>{
    round.children=presetSetupShares(7).map((shareBps,category)=>{
      const node={id:id(sequence++),name:`Round ${index+1} category ${category+1}`,shareBps,locked:false,children:[],
        rule:index===0?null:{basis:"race_position",sharesBps:presetSetupShares(10),source:null}};
      mapped.push({nodeId:node.id,type:"athlete_standings",...(index===0?{newPrizeCount:10,newPrizeCurve:"equal"}:{})});return node;
    });
  });
  const all=setupNodes(source.root);assert.equal(all.length,46);assert.equal(all.reduce((sum,n)=>sum+(n.rule?.sharesBps.length??0),0),355);
  const result=convertToGuidedSetup(source,potIds,mapped);
  assert.deepEqual(result.configuration.root.children.slice(1).map(n=>n.children.length),[7,7,7,7,7]);
  assert.equal(result.configuration.guided.groups.length,38);
  assert.equal(result.retainedBeforeWei,20000n*10n**18n);assert.equal(result.retainedAfterWei,10000n*10n**18n);
  assert.ok(source.root.children[1].children[0].children.every(n=>n.rule===null));
});
