import {act,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import ControllerWalletCard from "./ControllerWalletCard";
import type {ControllerConnection} from "../screens/RewardsControl";
const address="0x"+"22".repeat(20);
function fixture(){
 const request=vi.fn(async({method}:{method:string}):Promise<string>=>method==="eth_chainId"?"0x279f":"0x1bc16d674ec80000");
 const connection:ControllerConnection={subject:"did:privy:test",wallets:[address],isCurrent:()=>true,request:vi.fn(),getWallet:vi.fn(async()=>({address,provider:{request,on:vi.fn(),removeListener:vi.fn()}}))};
 return{request,connection};
}
afterEach(()=>{vi.useRealTimers();});
it("reads the verified testnet balance and copies the receiving address without signing",async()=>{
 const {request,connection}=fixture(),copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}});
 render(<ControllerWalletCard connection={connection} address={address}/>);
 await screen.findByText("2");expect(screen.getByText(/Send test MON on/)).toHaveTextContent("Monad testnet");
 fireEvent.click(screen.getByRole("button",{name:"Copy wallet address"}));await screen.findByText("Address copied");expect(copy).toHaveBeenCalledWith(address);
 expect(request.mock.calls.map(([v])=>v.method)).toEqual(["eth_chainId","eth_getBalance","eth_chainId"]);
 expect(request).toHaveBeenCalledWith({method:"eth_getBalance",params:[address,"latest"]});
});
it("refuses a balance on another chain and can retry",async()=>{
 const {request,connection}=fixture();request.mockResolvedValueOnce("0x1");render(<ControllerWalletCard connection={connection} address={address}/>);
 await screen.findByText("Balance unavailable. Refresh to try again.");expect(request).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button",{name:"Refresh balance"}));await screen.findByText("2");
});
it("bounds loading and ignores late provider replies",async()=>{
 vi.useFakeTimers();const {connection}=fixture();let finish!:(v:unknown)=>void;
 vi.mocked(connection.getWallet).mockImplementation(()=>new Promise(resolve=>{finish=resolve as never;}));
 render(<ControllerWalletCard connection={connection} address={address}/>);
 await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(screen.getByText("Balance unavailable. Refresh to try again.")).toBeVisible();
 await act(async()=>finish({address,provider:{request:async()=>"0x279f"}}));expect(screen.getByText("Balance unavailable. Refresh to try again.")).toBeVisible();
});
