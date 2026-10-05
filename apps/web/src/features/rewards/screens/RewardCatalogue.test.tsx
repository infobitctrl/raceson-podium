import {fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {RewardsHome,RewardPotsDirectory,PublicRewardPot} from "./RewardCatalogue";
vi.mock("../model/usePublicRewardReport",()=>({usePublicRewardReport:()=>({data:{programmes:[]},failed:false,retry:vi.fn()})}));
it("keeps every directory filter empty without resurrecting the retired sample",()=>{
 render(<I18nProvider initialLocale="en"><MemoryRouter><RewardsHome/></MemoryRouter></I18nProvider>);
 expect(screen.getByRole("link",{name:"Choose an event to support"})).toHaveAttribute("href","/rewards/events");
 for(const name of ["All","Active","Planned","Completed"]){
  fireEvent.click(screen.getByRole("button",{name}));
  expect(screen.getByRole("status")).toHaveTextContent("No published programmes");
  expect(screen.queryByText("Šibenik Trail League")).not.toBeInTheDocument();
 }
});
it("shows no old sample pots after search and type changes",()=>{
 render(<I18nProvider initialLocale="en"><MemoryRouter><RewardPotsDirectory/></MemoryRouter></I18nProvider>);
 for(const name of ["", "Vrpolje"]){
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:name}});
  expect(screen.getByRole("status")).toHaveTextContent("No matching reward pots");
 }
 fireEvent.change(screen.getByLabelText("Pot type"),{target:{value:"league"}});
 expect(screen.getByRole("status")).toHaveTextContent("No matching reward pots");
 expect(screen.queryByRole("link",{name:/Vrpolje/})).not.toBeInTheDocument();
});
it("old sample pot links do not expose a fabricated active pot",()=>{
 render(<I18nProvider initialLocale="en"><MemoryRouter><PublicRewardPot/></MemoryRouter></I18nProvider>);
 expect(screen.getByRole("heading",{name:"Pot not found"})).toBeVisible();
 expect(screen.getByRole("link",{name:"All reward pots"})).toHaveAttribute("href","/rewards/pots");
});
