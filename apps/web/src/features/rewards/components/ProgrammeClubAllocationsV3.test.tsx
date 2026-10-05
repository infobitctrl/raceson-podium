import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeClubAllocationsV3 from "./ProgrammeClubAllocationsV3";
const mock = vi.hoisted(() => ({ read: vi.fn(), lost: vi.fn(), wallet: vi.fn() }));
vi.mock("../data/clubAllocationsV3", () => ({ getOwnClubAllocationsV3: mock.read }));
vi.mock("./ClubConsentV3", () => ({ default: ({ selection }: { selection: { amountWei: string; recipientAddress: string } }) =>
  <section aria-label="Exact selected club consent">{selection.amountWei} · {selection.recipientAddress}</section> }));
const id = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const award = { entitlementId: `0x${"1".repeat(64)}`, draftId: id(1), slot: 1, sourceKind: "synthetic_rehearsal", amountWei: "1000000000000000000", allocationRevision: "latest", campaignAddress: `0x${"2".repeat(40)}`, claimAccess: "not_prepared", claim: null, payment: null };
const page = (items = [award]) => ({ chainId: 10143, items, nextCursor: null });
beforeEach(() => { mock.read.mockReset().mockResolvedValue(page()); mock.lost.mockReset(); mock.wallet.mockReset();
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request: mock.wallet } }); });
const mount = (locale: "en" | "hr" = "en", clubId = id(8)) => render(<I18nProvider initialLocale={locale}>
  <ProgrammeClubAllocationsV3 key={clubId} clubId={clubId} onAccessLost={mock.lost} /></I18nProvider>);
describe("V3 club programme ledger", () => {
  it("opens only an available latest unpaid claim and closes it on a refresh", async () => {
    const candidate={...award,uploadId:id(10),claimAccess:"available",claim:{claimId:id(11),requestId:id(12),recipientAddress:`0x${"4".repeat(40)}`,recipientConsented:false,operatorApproved:false}};
    mock.read.mockResolvedValue(page([candidate] as never)); mount();
    fireEvent.click(await screen.findByRole("button",{name:"Review club consent"}));
    expect(await screen.findByRole("region",{name:"Exact selected club consent"})).toHaveTextContent(candidate.amountWei);
    fireEvent.click(screen.getByRole("button",{name:"Refresh programme club rewards"}));
    await waitFor(()=>expect(screen.queryByRole("region",{name:"Exact selected club consent"})).not.toBeInTheDocument());
    expect(mock.wallet).not.toHaveBeenCalled();
  });
  it.each(["superseded","organizer_required","consented","payment"])("does not offer a new signature for %s",async kind=>{
    const candidate={...award,uploadId:id(10),claimAccess:"available",claim:{claimId:id(11),requestId:id(12),recipientAddress:`0x${"4".repeat(40)}`,recipientConsented:kind==="consented",operatorApproved:false},
      ...(kind==="superseded"?{allocationRevision:"superseded"}:{}),...(kind==="organizer_required"?{claimAccess:"organizer_required",claim:null}:{}),
      ...(kind==="payment"?{payment:{confirmed:false,state:"prepared"}}:{})};
    mock.read.mockResolvedValue(page([candidate] as never)); mount(); await screen.findByText("Round 1 reward");
    expect(screen.queryByRole("button",{name:"Review club consent"})).not.toBeInTheDocument();
  });
  it.each(["en", "hr"] as const)("shows reserved shares and Safe requirements without wallet access in %s", async locale => {
    mount(locale);
    expect(await screen.findByText(locale === "en" ? "Share reserved · payment not prepared" : "Udio je rezerviran · isplata nije pripremljena")).toBeVisible();
    expect(screen.getByText(/2-of-3|2-od-3/)).toBeVisible();
    expect(mock.read).toHaveBeenCalledWith(id(8), null); expect(mock.wallet).not.toHaveBeenCalled();
    expect(screen.queryByText("Test payment confirmed")).not.toBeInTheDocument();
  });
  it("retains confirmed receipt history on a superseded allocation without claiming current extra earnings", async () => {
    const hash=`0x${"3".repeat(64)}`;
    mock.read.mockResolvedValue(page([{...award,allocationRevision:"superseded",claimAccess:"organizer_required",
      payment:{state:"confirmed",confirmed:true,recipientAddress:`0x${"4".repeat(40)}`,transactionHash:hash,blockNumber:"123",blockHash:`0x${"5".repeat(64)}`} }] as never));
    mount(); await screen.findByText("Test payment confirmed");
    expect(screen.getByText("Superseded allocation · history only")).toBeVisible();
    expect(screen.getByText(/Previous private claim details/)).toBeVisible();
    fireEvent.click(screen.getByText("Allocation and receipt evidence")); expect(screen.getByText(hash)).toBeVisible();
    expect(mock.wallet).not.toHaveBeenCalled();
  });
  it("does not equate a submitted hash with payment and clears stale rows on failed refresh", async () => {
    mock.read.mockResolvedValueOnce(page([{...award,payment:{state:"submitted",confirmed:false,transactionHash:`0x${"3".repeat(64)}`}}] as never)).mockRejectedValue({status:403});
    mount(); await screen.findByText("Payment not confirmed: submitted, awaiting receipt");
    expect(screen.queryByText("Test payment confirmed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Refresh programme club rewards"})); await screen.findByRole("alert");
    expect(screen.queryByText("Round 1 reward")).not.toBeInTheDocument(); expect(mock.lost).toHaveBeenCalledWith({status:403});
  });
  it("discards a late club response after unmount", async () => {
    let resolve!: (v: unknown) => void; mock.read.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const view=mount(); view.unmount(); await act(async()=>resolve(page()));
    expect(screen.queryByText("Round 1 reward")).not.toBeInTheDocument(); expect(mock.wallet).not.toHaveBeenCalled();
  });
});
