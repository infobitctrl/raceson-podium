import {fireEvent,render,screen,within} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {decodeRewardSetup} from "@raceson/domain/rewards/distribution-setup";
import {legacyConversionFixture} from "../../../../../../apps/api/test/fixtures/guided-conversion.mjs";
import RewardSetupConversion from "./RewardSetupConversion";
function selectPots(potIds:string[]){potIds.forEach((id,i)=>fireEvent.change(screen.getByLabelText(i===0?"League pot":`Round ${i}`),{target:{value:id}}));fireEvent.click(screen.getByRole("button",{name:"Continue to reward rules"}));}
function mapTypes(){for(const [name,type] of [["Athlete Participation","athlete_finishes"],["Athlete Kms","athlete_metres"],["Club Kms","club_metres"],...Array.from({length:5},(_,i)=>[`Category ${i+1}`,"athlete_standings"])])fireEvent.change(screen.getByLabelText(`Reward type · ${name}`),{target:{value:type}});}
it("requires explicit roles and comparison before creating a separate semantic copy",()=>{
 const f=legacyConversionFixture(),source=decodeRewardSetup(f.source),original=JSON.stringify(source),onCreate=vi.fn();
 render(<RewardSetupConversion source={source} revision={2} hr={false} busy={false} uncertain={false} error={null} onCancel={()=>{}} onCreate={onCreate}/>);
 expect(screen.getByRole("button",{name:"Continue to reward rules"})).toBeDisabled();selectPots(f.potIds);
 expect(screen.getByRole("button",{name:"Compare distributions"})).toBeDisabled();mapTypes();
 fireEvent.click(screen.getByRole("button",{name:"Compare distributions"}));
 expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(15);
 expect(screen.getByText(/10,000 → 10,000 test MON/)).toBeVisible();expect(screen.getByRole("button",{name:"Create guided copy"})).toBeDisabled();
 fireEvent.click(screen.getByLabelText("I reviewed the mapped rules and new prize choices"));fireEvent.click(screen.getByRole("button",{name:"Create guided copy"}));
 expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({version:5,stage:"draft",budgetMon:"100000"}));
 expect(JSON.stringify(source)).toBe(original);expect(onCreate.mock.calls[0][0].root.children[0].children[2].rule.basis).toBe("participation");
});
it("unfinished groups require new count and distribution and show the changed unused amount",()=>{
 const f=legacyConversionFixture();f.source.root.children[1].children[0].children[0].rule=null;
 render(<RewardSetupConversion source={decodeRewardSetup(f.source)} revision={2} hr={false} busy={false} uncertain={false} error={null} onCancel={()=>{}} onCreate={()=>{}}/>);
 selectPots(f.potIds);mapTypes();expect(screen.getByRole("button",{name:"Compare distributions"})).toBeDisabled();
 fireEvent.change(screen.getByLabelText("Prize positions · Category 1"),{target:{value:"5"}});expect(screen.getByRole("button",{name:"Compare distributions"})).toBeDisabled();
 fireEvent.change(screen.getByLabelText("New distribution · Category 1"),{target:{value:"descending"}});fireEvent.click(screen.getByRole("button",{name:"Compare distributions"}));
 expect(screen.getByText(/20,000 → 10,000 test MON/)).toBeVisible();expect(screen.getByText(/Unconfigured → 5 prize positions/)).toBeVisible();
});
