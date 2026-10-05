import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import type { PublicRewardProgramme } from "@raceson/domain/rewards/public-report";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import PublicAllocationTable from "./PublicAllocationTable";
import PublicPrizeCharts from "./PublicPrizeCharts";
import { publicAllocationRows, sortAllocationRows } from "../model/publicAllocationTable";

const mon=(n:number)=>String(BigInt(n)*10n**18n);
const programme:PublicRewardProgramme={id:"demo",name:"Demo",host:"Host",chainId:10143,source:"synthetic",status:"distributing",pots:[{
 id:"round-1",name:"Round 1",slot:1,budgetWei:mon(100),approvedAt:"2026-09-16T00:00:00.000Z",
 rows:[{recipientId:"b",name:"Bea",kind:"athlete",amountWei:mon(20),claim:"not_submitted",payment:"not_paid",paidAt:null,transactionHash:null},
 {recipientId:"a",name:"Ada",kind:"athlete",amountWei:mon(30),claim:"submitted",payment:"paid",paidAt:"2026-09-16T01:00:00.000Z",transactionHash:`0x${"a".repeat(64)}`}],
 pools:[{key:"athlete_standings",budgetWei:mon(80),categories:[{id:"open",name:"Open",budgetWei:mon(80),slots:[{position:1,weight:60,amountWei:mon(48)},{position:2,weight:40,amountWei:mon(32)}]}],awards:[{recipientId:"b",amountWei:mon(20),position:2,categoryId:"open"},{recipientId:"a",amountWei:mon(25),position:1,categoryId:"open"}]},
 {key:"participation",budgetWei:mon(20),categories:[],awards:[{recipientId:"a",amountWei:mon(5),position:null,categoryId:null}]}]
}]};
function show(content:React.ReactNode){render(<I18nProvider initialLocale="en"><MemoryRouter>{content}</MemoryRouter></I18nProvider>);}
it("defaults to recorded position, exposes source and slot amount, and sorts every column",()=>{
 show(<PublicAllocationTable programme={programme}/>);
 const table=screen.getByRole("table"),rows=()=>within(table).getAllByRole("row").slice(1);
 expect(within(table).getByRole("columnheader",{name:"Position"})).toHaveAttribute("aria-sort","ascending");
 expect(rows().map(r=>within(r).getByRole("rowheader").textContent)).toEqual(["Ada","Bea","Ada"]);
 expect(rows()[0]).toHaveTextContent("60%");expect(rows()[0]).toHaveTextContent("48");expect(rows()[0]).toHaveTextContent("25");
 expect(within(rows()[0]).getByRole("link",{name:"Round 1"})).toHaveAttribute("href","/rewards/programmes/demo/pots/round-1?branch=pot%3Around-1%3Aathlete_standings");
 fireEvent.click(within(table).getByRole("button",{name:"Reward"}));
 expect(rows().map(r=>r.children[7].textContent)).toEqual(["5","20","25"]);
 fireEvent.click(within(table).getByRole("button",{name:"Reward"}));
 expect(rows().map(r=>r.children[7].textContent)).toEqual(["25","20","5"]);
 for(const header of within(table).getAllByRole("columnheader")){
  fireEvent.click(within(header).getByRole("button"));
  expect(header.getAttribute("aria-sort")).not.toBe("none");
 }
 fireEvent.change(screen.getByLabelText("Payment status"),{target:{value:"unpaid"}});
 expect(rows()).toHaveLength(1);expect(rows()[0]).toHaveTextContent("Bea");
});
it("sorts exact integer amounts without losing wei and keeps participation unranked",()=>{
 const rows=publicAllocationRows(programme);
 rows[0].amountWei="9007199254740993000000001";rows[1].amountWei="9007199254740993000000000";
 expect(sortAllocationRows(rows,"amountWei",false).map(r=>r.amountWei)).toEqual([mon(5),rows[1].amountWei,rows[0].amountWei]);
 expect(sortAllocationRows(rows,"position",true).map(r=>r.position)).toEqual([2,1,null]);
});
it("shows selectable prize shares and slot amounts while participation has no positions",()=>{
 show(<PublicPrizeCharts pot={programme.pots[0]}/>);
 const chart=screen.getByRole("region",{name:"Athletes · Prize distribution"});
 expect(chart).toHaveTextContent("80% of pot");
 fireEvent.click(within(chart).getByRole("button",{name:"Place 2 · 40%"}));
 expect(chart).toHaveTextContent("40% · 32 test MON");
 expect(within(chart).getByLabelText("Athletes · Category")).toHaveValue("open");
 const participation=screen.getByRole("region",{name:"Distance participation · Prize distribution"});
 expect(participation).toHaveTextContent("no finishing position");
 expect(within(participation).getByRole("button",{name:"Ada · 25%"})).toBeVisible();
});
