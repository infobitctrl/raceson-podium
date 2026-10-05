import {useState} from "react";
import {fireEvent,render,screen,within} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {expect,it,vi} from "vitest";
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {decodeStoredRewardSnapshot} from "@raceson/domain/rewards/published-preview-v2";
import {finishRewardSetup,type RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import {publishedSnapshot,id} from "../../../../../../apps/api/test/fixtures/published-reward-v2.mjs";
import type {SetupEventSelection} from "./RewardSetupEvent";
import GuidedRewardSetup from "./GuidedRewardSetup";
vi.mock("@/lib/auth",()=>({useAuth:()=>({account:{hasOrganizerAccess:true}})}));
vi.mock("./RewardSetupEvent",()=>({default:()=> <p>Season source picker</p>}));
vi.mock("./RewardLeagueMetrics",()=>({default:({onReviewUnsavedChange}:{onReviewUnsavedChange?:(v:boolean)=>void})=> <div><button onClick={()=>onReviewUnsavedChange?.(true)}>Edit contribution review</button><button onClick={()=>onReviewUnsavedChange?.(false)}>Save contribution review</button></div>}));
vi.mock("./RewardSetupChart",()=>({default:({onAddChild,onSelect,root}:{onAddChild?:unknown;onSelect:(id:string)=>void;root:{id:string}})=> <div aria-label="Overview chart"><span>{onAddChild?"Authoring enabled":"Overview only"}</span><button onClick={()=>onSelect(root.id)}>Select main pot</button></div>}));
vi.mock("recharts",async importOriginal=>({...await importOriginal<typeof import("recharts")>(),ResponsiveContainer:({children}:{children:React.ReactNode})=><div>{children}</div>}));
const onFinish=vi.fn();
function fixture(){let seq=2000;const next=()=>id(seq++),catalogue=decodeStoredRewardSnapshot(publishedSnapshot()).catalogue;
 const context={draftId:id(90),roundId:null,editionId:null,catalogueHash:"a".repeat(64),programmeName:"Synthetic season",eventName:"Synthetic season"};
 const setup=bindGuidedSeason(createGuidedSetup(next),context,catalogue);
 return {next,catalogue,setup,selection:{record:{draftId:context.draftId},workspace:{catalogueHash:context.catalogueHash,catalogue}} as SetupEventSelection};
}
function Harness({initial,initialStep=1,campaign=false,copySource}:{initial:ReturnType<typeof fixture>;initialStep?:number;campaign?:boolean;copySource?:{name:string;slot:number}}){
 const [configuration,setConfiguration]=useState(initial.setup),[step,setStep]=useState(initialStep);
 return <MemoryRouter><GuidedRewardSetup campaign={campaign} copySource={copySource} configuration={configuration} onChange={setConfiguration} step={step} onStep={setStep} disabled={false} hr={false} selection={initial.selection} onLoaded={()=>{}} initialProgramme={null}
 saveAction={<button>Save draft</button>} saveStatus="Unsaved changes" error={null} onFinish={()=>onFinish(finishRewardSetup(configuration))} canSave busy={false} revision={null}/><output data-testid="configuration">{JSON.stringify(configuration)}</output></MemoryRouter>;
}
const current=()=>JSON.parse(screen.getByTestId("configuration").textContent!) as RewardDistributionSetup;
const go=(n:number)=>fireEvent.click(screen.getByRole("button",{name:new RegExp(`^${n} `)}));
it("has five guided steps, reconciles pots and keeps the chart an optional overview",()=>{
 render(<Harness initial={fixture()}/>);expect(within(screen.getByRole("list",{name:"Setup progress"})).getAllByRole("button")).toHaveLength(5);
 expect(screen.queryByLabelText("Overview chart")).not.toBeInTheDocument();go(2);
 expect(screen.getByLabelText("League %")).toHaveValue(50);fireEvent.change(screen.getByLabelText("Synthetic round 1 %"),{target:{value:"12"}});
 expect(screen.getByLabelText("Synthetic round 2 %")).toHaveValue(10);expect(screen.getByText(/102% allocated/)).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Distribution overview"}));expect(screen.getByText("Overview only")).toBeVisible();
 expect(screen.queryByRole("button",{name:/Add subpot/})).not.toBeInTheDocument();
});
it("adds a category with a chosen winner count and copies only to explicitly selected rounds",()=>{
 const initial=fixture();render(<Harness initial={initial} initialStep={3}/>);
 fireEvent.change(screen.getByLabelText("Official category"),{target:{value:initial.catalogue.categories[0].id}});
 fireEvent.click(screen.getByRole("button",{name:"Add reward group"}));
 fireEvent.change(screen.getByLabelText("Synthetic short · Female prize positions"),{target:{value:"5"}});
 fireEvent.change(screen.getByLabelText("Synthetic short · Female budget %"),{target:{value:"100"}});
 fireEvent.click(screen.getByText("Copy these settings to other rounds"));
 fireEvent.click(screen.getByLabelText(/Synthetic round 2 · 0 → 1 groups/));
 fireEvent.click(screen.getByRole("button",{name:"Preview copy"}));
 expect(current().root.children[2].children).toHaveLength(0);
 fireEvent.click(screen.getByRole("button",{name:"Apply to selected rounds"}));
 expect(current().root.children[2].children[0].rule!.sharesBps).toHaveLength(5);
 expect(current().root.children[3].children).toHaveLength(0);
 expect(current().root.children[2].shareBps).toBe(1000);
});
it("participation methods expose top-N only for ranking and preserve the other pools",()=>{
 render(<Harness initial={fixture()} initialStep={4}/>);
 fireEvent.change(screen.getByLabelText("Reward type"),{target:{value:"club_metres"}});fireEvent.click(screen.getByRole("button",{name:"Add reward group"}));
 expect(screen.queryByLabelText(/prize positions/)).not.toBeInTheDocument();
 expect(current().guided!.groups[0].method).toBe("proportional");
 fireEvent.change(screen.getByLabelText("Club kilometres budget %"),{target:{value:"20"}});
 fireEvent.change(screen.getByLabelText("Distribution"),{target:{value:"ranked"}});
 expect(screen.getByLabelText("Club kilometres prize positions")).toHaveValue(5);
 expect(current().root.children[0].children[0].shareBps).toBe(2000);
 fireEvent.change(screen.getByLabelText("Distribution"),{target:{value:"proportional"}});
 expect(current().root.children[0].children[0].rule!.sharesBps).toEqual([]);
 go(5);expect(screen.getByRole("button",{name:"Finish setup → Review awards"})).toBeDisabled();
});
it("reconnects a copied category group through its form without deleting its budget or prizes",()=>{
 const initial=fixture();initial.setup=addGuidedGroup(initial.setup,initial.setup.guided!.pots[1].nodeId,"athlete_standings",initial.next,null);
 const group=initial.setup.root.children[1].children[0];group.name="Preserved category";group.shareBps=4000;
 render(<Harness initial={initial} initialStep={3}/>);
 fireEvent.change(screen.getByLabelText("Official category · Preserved category"),{target:{value:initial.catalogue.categories[0].id}});
 expect(current().root.children[1].children[0]).toMatchObject({name:"Preserved category",shareBps:4000,rule:{source:{categoryId:initial.catalogue.categories[0].id}}});
 expect(current().root.children[1].children[0].rule!.sharesBps).toEqual(group.rule!.sharesBps);
 expect(current().guided!.groups[0].eligibilityApproved).toBe(false);
});
it("finish requires complete round bindings and reviewed groups, while upcoming results are allowed",()=>{
 const initial=fixture();initial.catalogue.rounds.push({...initial.catalogue.rounds[0],id:id(104),editionId:id(204),slot:5,name:"Synthetic finale",status:"upcoming"});
 initial.setup=bindGuidedSeason(initial.setup,initial.setup.context!,initial.catalogue);
 for(const pot of initial.setup.guided!.pots)initial.setup=addGuidedGroup(initial.setup,pot.nodeId,pot.slot===0?"athlete_finishes":"athlete_standings",initial.next,pot.slot===0?null:initial.catalogue.categories[0]);
 initial.setup.root.children.forEach(p=>p.children[0].shareBps=10000);initial.setup.guided!.groups.forEach(g=>g.eligibilityApproved=true);
 render(<Harness initial={initial} initialStep={5}/>);
 fireEvent.click(screen.getByRole("button",{name:"Finish setup → Review awards"}));expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({version:5,stage:"ready"}));
});

it("keeps a pending contribution review on its step until saved or discarded",async()=>{
 render(<Harness initial={fixture()}/>);
 fireEvent.click(screen.getByText("Organizer data review"));
 fireEvent.click(await screen.findByRole("button",{name:"Edit contribution review"}));
 expect(screen.getByRole("button",{name:"Continue →"})).toBeDisabled();
 expect(screen.getByRole("button",{name:"Save draft"})).toBeDisabled();
 expect(screen.getByRole("textbox",{name:"Programme name"})).toBeDisabled();
 expect(within(screen.getByRole("list",{name:"Setup progress"})).getAllByRole("button").every(b=>b.hasAttribute("disabled"))).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Save contribution review"}));
 expect(screen.getByRole("button",{name:"Continue →"})).toBeEnabled();
 fireEvent.click(screen.getByRole("button",{name:"Continue →"}));expect(screen.getByLabelText("League %")).toBeVisible();
});


it("campaign preserves independent prize weights through its three-step navigation",()=>{
 const initial=fixture();render(<Harness campaign initial={initial}/>);
 const navigation=within(screen.getByRole('navigation',{name:'Campaign sections'}));
 expect(navigation.getAllByRole('button')).toHaveLength(3);
 fireEvent.click(navigation.getByRole('button',{name:/Reward rules/}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Synthetic short · Female Individual'}));
 expect(current().root.children[0].children[0].rule!.source!.categoryId).toBe(initial.catalogue.categories[0].id);
 fireEvent.change(screen.getByRole('spinbutton',{name:'Synthetic short · Female prize positions'}),{target:{value:'3'}});
 fireEvent.change(screen.getByRole('spinbutton',{name:'Synthetic short · Female #1 weight'}),{target:{value:'90'}});
 const shares=current().root.children[0].children[0].rule!.sharesBps;
 expect(shares.reduce((a,b)=>a+b,0)).toBe(10000);expect(shares[0]).toBeGreaterThan(shares[2]*4);
 expect(current().root.children[1].children).toHaveLength(0);
 fireEvent.change(screen.getByLabelText('Reward pot'),{target:{value:'1'}});
 expect(screen.getByLabelText('Reward pot')).toHaveValue('1');
 fireEvent.click(navigation.getByRole('button',{name:/Budget & terms/}));
 fireEvent.change(screen.getByLabelText('Synthetic round 1 %'),{target:{value:'20'}});
 expect(current().root.children[1].shareBps).toBe(2000);expect(current().root.children[0].shareBps).toBe(5000);
 expect(current().root.children[0].children[0].rule!.sharesBps).toEqual(shares);
 fireEvent.click(navigation.getByRole('button',{name:/Reward rules/}));
 fireEvent.click(screen.getByRole('checkbox',{name:'Include Synthetic short · Female'}));
 expect(current().root.children[0].children).toHaveLength(0);expect(current().guided!.groups).toHaveLength(0);
});

it("campaign retains unsaved contribution review until saved",async()=>{
 render(<Harness campaign initial={fixture()}/>);
 fireEvent.click(screen.getByText("Review results"));
 fireEvent.click(await screen.findByRole("button",{name:"Edit contribution review"}));
 expect(screen.getByRole("button",{name:/Reward rules/})).toBeDisabled();
 expect(screen.getByRole("button",{name:"Save draft"})).toBeDisabled();
 expect(screen.getByRole("textbox",{name:/Campaign name/})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Save contribution review"}));
 expect(screen.getByRole("button",{name:/Reward rules/})).toBeEnabled();
});


it('preserves the last valid allocation when all prize weights would become zero',()=>{
 const initial=fixture();render(<Harness campaign initial={initial}/>);fireEvent.click(screen.getByRole('button',{name:/Reward rules/}));fireEvent.click(screen.getByRole('checkbox',{name:'Synthetic short · Female Individual'}));fireEvent.change(screen.getByLabelText('Synthetic short · Female prize positions'),{target:{value:'1'}});const before=current();fireEvent.change(screen.getByLabelText('Synthetic short · Female #1 weight'),{target:{value:'0'}});expect(screen.getByRole('alert')).toHaveTextContent('At least one prize weight must be greater than zero');expect(current()).toEqual(before);expect(current().root.children[0].children[0].rule!.sharesBps).toEqual([10000]);
});


it.each([1,5])('presents a single race independently through budget, rules and review (internal slot %s)',slot=>{
 const initial=fixture(),name='Synthetic coastal race';
 const selected=initial.setup.guided!.pots.find(p=>p.slot===slot)!;
 initial.setup.root.children=initial.setup.root.children.map(n=>({...n,name:n.id===selected.nodeId?`Round ${slot}`:n.name,shareBps:n.id===selected.nodeId?10000:0}));
 initial.setup.sponsorSelection={sourceLeagueId:id(701),sourceSeasonId:id(702),eventEditionId:id(703)};
 initial.setup.budgetMon='';
 render(<Harness campaign initial={initial} copySource={{name,slot}}/>);
 const studio=within(screen.getByRole('article'));
 expect(studio.getByRole('heading',{name})).toBeVisible();
 expect(studio.queryByText(/Each percentage is a share/)).not.toBeInTheDocument();
 expect(studio.queryByLabelText(`Round ${slot} %`)).not.toBeInTheDocument();
 expect(studio.queryByRole('button',{name:'Split rounds equally'})).not.toBeInTheDocument();
 expect(studio.queryByText(`Round ${slot}`,{exact:true})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Total budget · test MON'),{target:{value:'123.456'}});
 expect(current().root).toEqual(initial.setup.root);
 expect(current().guided).toEqual(initial.setup.guided);
 expect(current().sponsorSelection).toEqual(initial.setup.sponsorSelection);
 for(const step of ['Reward rules','Review']){
  fireEvent.click(studio.getByRole('button',{name:new RegExp(step)}));
  expect(studio.queryByLabelText('Reward pot')).not.toBeInTheDocument();
  expect(studio.queryByText(`Round ${slot}`,{exact:true})).not.toBeInTheDocument();
  expect(studio.getAllByText(name).length).toBeGreaterThan(1);
 }
 expect(current()).toEqual({...initial.setup,budgetMon:'123.456'});
});
