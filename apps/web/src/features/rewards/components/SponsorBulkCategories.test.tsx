vi.mock('./PodiumPrizeCurve',()=>({default:()=>null}));
import {useState} from "react";
import {fireEvent,render,screen,within} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {createGuidedSetup,addGuidedGroup} from "@raceson/domain/rewards/guided-setup-editor";
import {addSponsorDraftCategory,sponsorDraftCategories} from "../model/sponsorDraftCategories";
import {applySponsorCategorySettings} from "../model/applySponsorCategorySettings";
import SponsorBulkCategories from "./SponsorBulkCategories";
function fixture(){let i=1;const next=()=>`73000000-0000-4000-8000-${String(i++).padStart(12,"0")}`;let c=createGuidedSetup(next);
 for(const category of sponsorDraftCategories)c=addSponsorDraftCategory(c,c.root.children[0].id,category,next);
 c=addGuidedGroup(c,c.root.children[0].id,"athlete_finishes",next,null);
 return c;
}
it("applies one setup to a course, then a second group, only on explicit Apply",()=>{
 const initial=fixture(),changes=vi.fn();
 function Harness(){const [c,set]=useState(initial);return <SponsorBulkCategories configuration={c} pot={c.root.children[0]} catalogue={null} hr={false} disabled={false} onClose={()=>{}} onApply={(ids,settings)=>{const next=applySponsorCategorySettings(c,c.root.children[0].id,ids,settings);changes(next);set(next);return true;}}/>;}
 render(<Harness/>);expect(screen.getAllByRole("checkbox",{checked:true})).toHaveLength(7);
 fireEvent.click(screen.getByRole("button",{name:"Short course"}));expect(screen.getAllByRole("checkbox",{checked:true})).toHaveLength(5);
 fireEvent.click(within(screen.getByRole("group",{name:"Shared reward settings winners"})).getByRole("button",{name:"3"}));
 fireEvent.click(screen.getByRole("button",{name:"Equal prizes"}));expect(changes).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Apply to 5 categories"}));
 const first=changes.mock.calls[0][0];expect(first.root.children[0].children.slice(0,5).every(n=>n.rule.sharesBps.length===3)).toBe(true);
 expect(first.root.children[0].children[5].rule.sharesBps).toHaveLength(25);
 fireEvent.click(screen.getByRole("button",{name:"Long course"}));
 fireEvent.click(within(screen.getByRole("group",{name:"Shared reward settings winners"})).getByRole("button",{name:"5"}));
 fireEvent.click(screen.getByRole("button",{name:"Apply to 2 categories"}));
 expect(changes.mock.calls[1][0].root.children[0].children.slice(5,7).every(n=>n.rule.sharesBps.length===5)).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Clear selection"}));expect(screen.getByRole("button",{name:"Apply to 0 categories"})).toBeDisabled();
});
it("keeps participation separate and prevents incomplete custom splits from applying",()=>{
 const c=fixture(),apply=vi.fn();render(<SponsorBulkCategories configuration={c} pot={c.root.children[0]} catalogue={null} hr={false} disabled={false} onClose={()=>{}} onApply={apply}/>);
 fireEvent.click(screen.getByText("Rules & prize breakdown"));fireEvent.change(screen.getByLabelText("Shared reward settings #1 %"),{target:{value:"0"}});
 expect(screen.getByRole("button",{name:"Apply to 7 categories"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Participation"}));expect(screen.getAllByRole("checkbox")).toHaveLength(1);
 fireEvent.change(screen.getByLabelText("Minimum completed rounds"),{target:{value:"3"}});fireEvent.click(screen.getByRole("button",{name:"Apply to 1 categories"}));
 expect(apply.mock.calls[0][1]).toEqual({method:"proportional",minimumFinishes:3,sharesBps:[]});
});
