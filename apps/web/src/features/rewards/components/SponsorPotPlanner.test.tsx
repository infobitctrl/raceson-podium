import {useState} from "react";
import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {createGuidedSetup,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import type {RewardDistributionSetup} from "@raceson/domain/rewards/distribution-setup";
import SponsorPotPlanner from "./SponsorPotPlanner";
const choose=vi.fn();
function Harness(){
 const [configuration,onChange]=useState(()=>{
  let c=createGuidedSetup(()=>crypto.randomUUID());
  for(let i=0;i<2;i++)c=addGuidedGroup(c,c.root.children[1].id,"athlete_standings",()=>crypto.randomUUID(),null);
  c.root.children[1].children[0].name="Women";c.root.children[1].children[1].name="Men";
  return c;
 });
 return <><SponsorPotPlanner configuration={configuration} onChange={onChange} hr={false} disabled={false} onChooseRewards={choose}/><output data-testid="saved-draft">{JSON.stringify(configuration)}</output></>;
}
const current=()=>JSON.parse(screen.getByTestId("saved-draft").textContent!) as RewardDistributionSetup;
it("edits total, sections, round amounts and category shares in the same saved draft",()=>{
 render(<Harness/>);
 fireEvent.click(screen.getByText("Plan the whole pot"));
 fireEvent.change(screen.getByLabelText("Programme pot · test MON"),{target:{value:"200000"}});
 fireEvent.change(screen.getByLabelText("League rewards %"),{target:{value:"40"}});
 expect(screen.getByLabelText("All rounds test MON")).toHaveValue("120000");
 fireEvent.click(screen.getByText("Split between rounds"));
 const round=screen.getByLabelText("Round 1 · of rounds test MON");
 fireEvent.change(round,{target:{value:"60000"}});fireEvent.blur(round);
 expect(current().root.children[1].shareBps).toBe(3000);
 expect(current().root.children.slice(2).map(n=>n.shareBps)).toEqual([750,750,750,750]);
 fireEvent.click(screen.getAllByText("Split reward categories")[0]);
 fireEvent.click(screen.getByRole("button",{name:"Split categories equally"}));
 expect(screen.getByLabelText("Round 1 / Women test MON")).toHaveValue("30000");
 const women=screen.getByLabelText("Round 1 / Women test MON");
 fireEvent.change(women,{target:{value:"12000"}});fireEvent.blur(women);
 expect(current().root.children[1].children.map(n=>n.shareBps)).toEqual([2000,5000]);
 fireEvent.click(screen.getByRole("button",{name:"Split rounds equally"}));
 expect(current().root.children.slice(1).map(n=>n.shareBps)).toEqual([1200,1200,1200,1200,1200]);
 expect(screen.getByLabelText("Round 1 / Women test MON")).toHaveValue("4800");
 expect(current().context).toBeNull();expect(current().guided!.groups.every(n=>!n.eligibilityApproved)).toBe(true);
});
it("rejects excessive amounts without changing the draft",()=>{
 render(<Harness/>);fireEvent.click(screen.getByText("Plan the whole pot"));
 const before=current(),field=screen.getByLabelText("League rewards test MON");
 fireEvent.change(field,{target:{value:"100001"}});fireEvent.blur(field);
 expect(current()).toEqual(before);expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount within the parent pot");
});
