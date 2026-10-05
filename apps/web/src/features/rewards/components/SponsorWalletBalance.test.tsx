import {act, fireEvent, render, screen} from "@testing-library/react";
import {expect, it, vi} from "vitest";
import SponsorWalletBalance from "./SponsorWalletBalance";
const address = "0x" + "ab".repeat(20);
function provider() {return {on: vi.fn(), removeListener: vi.fn(), request: vi.fn(async ({method}: {method: string}): Promise<unknown> => method === "eth_accounts" ? [address] : method === "eth_chainId" ? "0x279f" : "0x1bc16d674ec80000")};}
it("shows funds in step one and refreshes read-only without a deployment plan", async () => {
  const p = provider(); render(<SponsorWalletBalance provider={p} address={address} chainId={10143} hr={false}/>);
  const region = screen.getByLabelText("Funding wallet funds");
  await screen.findByRole("button", {name:"Refresh balance"});
  expect(region).toHaveTextContent("2 test MON");
  expect(region).toHaveTextContent("separate from deposited prizes");
  p.request.mockImplementation(async ({method}) => method === "eth_accounts" ? [address] : method === "eth_chainId" ? "0x279f" : "0x0");
  fireEvent.click(screen.getByRole("button", {name: "Refresh balance"}));
  expect(region).toHaveTextContent("2 test MON");
  expect(region).toHaveTextContent("Refreshing…");
  await screen.findByRole("button", {name: "Refresh balance"}); expect(region).toHaveTextContent("0 test MON");
  expect(p.request.mock.calls.every(([call]) => ["eth_accounts", "eth_chainId", "eth_getBalance"].includes(call.method))).toBe(true);
});
it("shows unavailable rather than zero on failure, and retries in Croatian", async () => {
  const p = provider(); p.request.mockRejectedValue(Error("offline"));
  render(<SponsorWalletBalance provider={p} address={address} chainId={10143} hr/>);
  await screen.findByText("Stanje nije dostupno. Osvježite za ponovni pokušaj.");
  expect(screen.getByLabelText("Sredstva novčanika za uplatu")).toHaveTextContent("— test MON");
  expect(screen.getByRole("button", {name: "Osvježi stanje"})).toBeEnabled();
});
it("discards a late read when the connected provider changes", async () => {
  const old = provider(), next = provider(); let reply!: (value: string) => void;
  old.request.mockImplementation(async ({method}) => method === "eth_accounts" ? [address] : method === "eth_chainId" ? "0x279f" : new Promise<string>(resolve => {reply = resolve;}));
  const view = render(<SponsorWalletBalance provider={old} address={address} chainId={10143} hr={false}/>);
  await act(async () => {});
  next.request.mockImplementation(async ({method}) => method === "eth_accounts" ? [address] : method === "eth_chainId" ? "0x279f" : "0x0");
  view.rerender(<SponsorWalletBalance provider={next} address={address} chainId={10143} hr={false}/>);
  await screen.findByRole("button", {name: "Refresh balance"});
  await act(async () => reply("0x1bc16d674ec80000"));
  expect(screen.getByLabelText("Funding wallet funds")).toHaveTextContent("0 test MON");
});
