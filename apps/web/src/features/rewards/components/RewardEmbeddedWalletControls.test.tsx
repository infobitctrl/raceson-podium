import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {RewardEmbeddedWalletContext} from "./RewardEmbeddedWalletContext";
import RewardEmbeddedWalletControls from "./RewardEmbeddedWalletControls";
it("reconnects a saved wallet without creating or replacing an address",()=>{
  const enable=vi.fn(),create=vi.fn(),address=`0x${"ab".repeat(20)}`;
  const view=(status:"off"|"ready")=><I18nProvider initialLocale="en"><RewardEmbeddedWalletContext.Provider value={{status,wallet:null,enable,create}}><RewardEmbeddedWalletControls existingAddress={address}/></RewardEmbeddedWalletContext.Provider></I18nProvider>;
  const page=render(view("off"));fireEvent.click(screen.getByRole("button",{name:"Reconnect Privy wallet"}));expect(enable).toHaveBeenCalledOnce();
  page.rerender(view("ready"));expect(screen.queryByRole("button",{name:"Create my Privy wallet"})).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your saved address has not changed");expect(create).not.toHaveBeenCalled();
});
