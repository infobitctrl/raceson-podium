import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AthleteAllocationV3 } from "@raceson/domain/rewards/athlete-allocations-v3";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ProgrammeAthleteAllocationsV3 from "./ProgrammeAthleteAllocationsV3";
const award: AthleteAllocationV3 = { entitlementId: `0x${"a".repeat(64)}`, approvalId: "81000000-0000-4000-8000-000000000001",
  draftId: "81000000-0000-4000-8000-000000000002", slot: 1, athleteProfileId: "81000000-0000-4000-8000-000000000003",
  chainId: 31337, sourceKind: "synthetic_rehearsal", amountWei: "1", campaignAddress: `0x${"b".repeat(40)}`,
  recordedAt: "2026-09-10T18:00:00Z", ageStatus: "unverified_adult" };
describe("programme recipient allocation card", () => {
  it("shows each reward's actual programme and event pot before expansion", () => {
    const first = { ...award, origin: {schema:"raceson-reward-origin-v1" as const,programmeName:"League A · 2026",hostName:"Host A",potKind:"race" as const,
      roundId:"81000000-0000-4000-8000-000000000020",eventName:"Forest Trail",eventEditionId:"81000000-0000-4000-8000-000000000021",eventDate:"2026-09-01",sourceKind:"synthetic_rehearsal" as const} };
    const second = {...first,entitlementId:`0x${"c".repeat(64)}`,draftId:"81000000-0000-4000-8000-000000000009",origin:{...first.origin,programmeName:"League B · 2026",hostName:"Host B",eventName:"Coastal Trail"}};
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3 items={[first,second]} pending={false}/></I18nProvider>);
    expect(screen.getByRole("button",{name:"Forest Trail · Details"})).toHaveTextContent("League A · 2026 · Round pot 1");
    expect(screen.getByRole("button",{name:"Coastal Trail · Details"})).toHaveTextContent("League B · 2026 · Round pot 1");
    fireEvent.click(screen.getByRole("button",{name:"Forest Trail · Details"}));
    expect(screen.getByText("Host A")).toBeVisible();
    expect(screen.getByText("Forest Trail · 1 Sept 2026")).toBeVisible();
  });
  it.each(["en", "hr"] as const)("explains frozen placing and participation amounts in %s without a new payment action", locale => {
    const item: AthleteAllocationV3 = { ...award, slot: 6, sourceKind: "final_league", amountWei: "10",
      breakdown: { schema: "raceson-athlete-award-breakdown-v1", sourceKind: "synthetic_rehearsal", components: [
        { kind: "placing", categoryId: "81000000-0000-4000-8000-000000000008", sourceRowId: "81000000-0000-4000-8000-000000000009", rank: 2, poolWei: "50", amountWei: "4" },
        { kind: "participation", metres: "30000", totalMetres: "100000", finishes: 2, resultIds: ["81000000-0000-4000-8000-000000000010", "81000000-0000-4000-8000-000000000011"], poolWei: "20", amountWei: "6" },
      ] } };
    render(<I18nProvider initialLocale={locale}><ProgrammeAthleteAllocationsV3 items={[item]} pending={false} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Details|Detalji/ }));
    fireEvent.click(screen.getByText(locale === "en" ? "Why this amount?" : "Zašto ovaj iznos?"));
    expect(screen.getByText(locale === "en" ? "Category placing · 2" : "Poredak u kategoriji · 2")).toBeVisible();
    expect(screen.getByText(locale === "en" ? "Distance participation" : "Nagrada za prijeđenu udaljenost")).toBeVisible();
    expect(screen.getByText(/30[,.]000 \/ 100[,.]000 m/)).toBeVisible();
    expect(screen.queryByText(/not supplied by this allocation API/)).not.toBeInTheDocument();
    // Final-league source provenance remains synthetic without relying on age policy.
    expect(screen.getByText(locale === "en" ? /not a real athlete award/ : /nije nagrada stvarnog natjecatelja/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /connect|claim|wallet|preuzmi|novčanik/i })).not.toBeInTheDocument();
  });
  it("presents all six pots in programme order without changing paginated input", () => {
    const items = ([1, 5, 6, 4, 2, 3] as const).map(slot => ({ ...award, slot,
      entitlementId: `0x${String(slot).repeat(64)}`,
      sourceKind: slot === 5 ? "native_finale" as const : slot === 6 ? "final_league" as const : award.sourceKind,
    }));
    Object.freeze(items);
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3
      items={items} pending={false} /></I18nProvider>);
    expect(screen.getAllByRole("button", { name: /Details/ }).map(node => node.getAttribute("aria-label")!.replace(" · Details", ""))).toEqual([
      "Round 1 reward", "Round 2 reward", "Round 3 reward", "Round 4 reward", "Round 5 reward", "League reward",
    ]);
    expect(items.map(item => item.slot)).toEqual([1, 5, 6, 4, 2, 3]);
  });
  it.each([5, 6] as const)("keeps synthetic identification on final pot %s without changing source kind", slot => {
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3 items={[{ ...award, slot,
      chainId: 10143, draftId: "9a000000-0000-4000-8000-000000000052",
      athleteProfileId: "9a000000-0000-4000-8000-000000001060", ageStatus: "synthetic_test",
      sourceKind: slot === 5 ? "native_finale" : "final_league",
    }]} pending={false} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.getByText(/Synthetic test results · not a real athlete award/)).toBeVisible();
  });
  it("does not label an ordinary native-finale allocation as synthetic", () => {
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3 items={[{ ...award,
      slot: 5, sourceKind: "native_finale",
    }]} pending={false} /></I18nProvider>);
    expect(screen.queryByText(/Synthetic test results/)).not.toBeInTheDocument();
  });
  it("keeps wallet setup out of each reward and retains exact allocation evidence", () => {
    render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3 items={[award]} pending={false}/></I18nProvider>);
    expect(screen.queryByRole("button", { name: /connect|claim|wallet|preuzmi|novčanik/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    fireEvent.click(screen.getByText("Reward details")); expect(screen.getByText(award.athleteProfileId)).toBeVisible();
    fireEvent.click(screen.getByText("Exact amount"));expect(screen.getByText(/0\.000000000000000001/)).toBeVisible();
  });
  it.each(["minor", "unknown"] as const)("does not offer a destination action for %s age and renders Croatian holds", ageStatus => {
    render(<I18nProvider initialLocale="hr"><ProgrammeAthleteAllocationsV3 items={[{...award,ageStatus}]} pending={false}
      /></I18nProvider>);
    expect(screen.getByText("Nagrada za 1. kolo")).toBeVisible();expect(screen.queryByRole("button", { name: /connect|claim|wallet|preuzmi|novčanik/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Detalji/ }));
    expect(screen.getByText(/nije nagrada stvarnog natjecatelja/)).toBeVisible();
    expect(screen.getByText(ageStatus === "minor" ? /maloljetnicima/ : /dobne uvjete/)).toBeVisible();
  });
});


it("sorts exact wei amounts and award dates without mutating input or losing expanded details", () => {
  const items = [
    {...award,slot:1 as const,amountWei:"1000000000000000001",recordedAt:"2026-09-12T00:00:00Z"},
    {...award,slot:2 as const,entitlementId:`0x${"c".repeat(64)}`,amountWei:"1000000000000000002",recordedAt:"2026-09-11T00:00:00Z"},
    {...award,slot:3 as const,entitlementId:`0x${"d".repeat(64)}`,amountWei:"1000000000000000001",recordedAt:"2026-09-13T00:00:00Z"},
  ];
  Object.freeze(items);
  render(<I18nProvider initialLocale="en"><ProgrammeAthleteAllocationsV3 items={items} pending={false} hasMore/></I18nProvider>);
  const order=()=>screen.getAllByRole('button',{name:/Details/}).map(node=>node.getAttribute('aria-label'));
  const select=screen.getByRole('combobox',{name:'Sort rewards'});
  fireEvent.click(screen.getByRole('button',{name:'Round 1 reward · Details'}));
  fireEvent.change(select,{target:{value:'highest'}});
  expect(order()).toEqual(['Round 2 reward · Details','Round 1 reward · Details','Round 3 reward · Details']);
  expect(screen.getByRole('button',{name:'Round 1 reward · Details'})).toHaveAttribute('aria-expanded','true');
  fireEvent.change(select,{target:{value:'lowest'}});
  expect(order()).toEqual(['Round 1 reward · Details','Round 3 reward · Details','Round 2 reward · Details']);
  fireEvent.change(select,{target:{value:'newest'}});
  expect(order()).toEqual(['Round 3 reward · Details','Round 1 reward · Details','Round 2 reward · Details']);
  expect(screen.getByText(/Sorting includes loaded rewards/)).toBeVisible();
  expect(items.map(item=>item.slot)).toEqual([1,2,3]);
});
