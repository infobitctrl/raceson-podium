import { render,screen } from "@testing-library/react";
import { expect,it } from "vitest";
import RewardExplorerLink from "./RewardExplorerLink";
import {rewardExplorerUrl} from "../model/rewardExplorerUrl";
it("links only valid Monad testnet chain identifiers, never local IDs or private URLs",()=>{
  for(const [kind,value] of [["address",`0x${"a".repeat(40)}`],["tx",`0x${"b".repeat(64)}`],["block","62549190"]] as const){
    expect(rewardExplorerUrl(10143,kind,value)).toBe(`https://testnet.monadvision.com/${kind}/${value}`);
    expect(rewardExplorerUrl(31337,kind,value)).toBeNull();expect(rewardExplorerUrl(143,kind,value)).toBeNull();
  }
  for(const value of [null,undefined,"uuid-private","https://example.test/?secret=x","javascript:alert(1)","12?key=x"]){
    expect(rewardExplorerUrl(10143,"block",value)).toBeNull();
  }
  expect(rewardExplorerUrl(10143,"tx",`0x${"a".repeat(40)}`)).toBeNull();
});
it("opens verified addresses safely and keeps simulation identifiers as plain text",()=>{
  const value=`0x${"a".repeat(40)}`;
  const view=render(<RewardExplorerLink chainId={10143} kind="address" value={value}/>);
  expect(screen.getByRole("link")).toHaveAttribute("target","_blank");expect(screen.getByRole("link")).toHaveAttribute("rel","noopener noreferrer");
  view.rerender(<RewardExplorerLink chainId={31337} kind="address" value={value}/>);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();expect(screen.getByText(value)).toBeVisible();
});
