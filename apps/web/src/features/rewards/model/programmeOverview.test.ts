import { describe, expect, it } from "vitest";
import { createDefaultRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { buildProgrammeOverview, programmePath, programmePresentation, programmeSelection, rewardProgrammeRounds } from "./programmeOverview";
import { draftFromProgrammeForm, programmeForm } from "./programmeForm";

describe("v2 programme planning", () => {
  it("shows 100000 with equal race pots, league families and a dated but unmapped finale", () => {
    const model = buildProgrammeOverview(), mon = 10n ** 18n;
    expect(model.source).toBe("draft_preview");
    expect(model.budgetWei).toBe(100_000n * mon);
    expect(model.byId.get("race")?.amountWei).toBe(50_000n * mon);
    expect(model.byId.get("league")?.amountWei).toBe(50_000n * mon);
    for (const round of rewardProgrammeRounds) {
      expect(model.byId.get(round.id)?.amountWei).toBe(10_000n * mon);
      expect(model.byId.get(round.id + ":athlete_standings")?.amountWei).toBe(8_000n * mon);
      expect(model.byId.get(round.id + ":club_standings")?.amountWei).toBe(2_000n * mon);
    }
    expect(model.byId.get("league:athlete_standings")?.amountWei).toBe(25_000n * mon);
    expect(model.byId.get("league:club_standings")?.amountWei).toBe(10_000n * mon);
    expect(model.byId.get("league:participation_metres")?.amountWei).toBe(15_000n * mon);
    expect(model.roundFiveDate).toBe("2026-10-03"); expect(model.roundFiveEventId).toBeNull();
    expect(model.reviewSeconds).toBe(86400);
    expect(model.observedFundingWei).toBeNull(); expect(model.observedPaidWei).toBeNull();
    expect(model.contractAddresses).toEqual([]); expect(model.awards).toEqual([]);
  });
  it("conserves every tree node with exact shared-domain rounding", () => {
    for (const budgetMon of ["0.000000000000000001", "0.000000000000000007", "100000.000000000000000001"]) {
      const model = buildProgrammeOverview({ ...createDefaultRewardProgrammeDraftV2(), budgetMon });
      expect(model.nodes.length).toBe(21);
      for (const node of model.nodes) {
        if (node.children.length) expect(node.children.reduce((sum, id) => sum + model.byId.get(id)!.amountWei, 0n)).toBe(node.amountWei);
        expect(programmePath(node.id, model).at(-1)).toBe(node);
      }
      expect(model.nodes.filter(node => !node.children.length).reduce((sum, node) => sum + node.amountWei, 0n)).toBe(model.budgetWei);
    }
  });
  it("accepts only a single known node and presentation mode from the URL", () => {
    const model = buildProgrammeOverview();
    expect(programmeSelection(new URLSearchParams("node=league:club_standings"), model)).toBe("league:club_standings");
    for (const query of ["", "node=zlarin", "node=race&node=league", "node=__proto__", "node=<script>"]) {
      expect(programmeSelection(new URLSearchParams(query), model)).toBe("programme");
    }
    expect(programmePresentation(new URLSearchParams("view=portal"))).toBe("portal");
    for (const query of ["", "view=portal&view=standalone", "view=admin", "view=__proto__"]) {
      expect(programmePresentation(new URLSearchParams(query))).toBe("standalone");
    }
    expect(programmePath("subicevac:athlete_standings", model).map(n => n.id)).toEqual(["programme", "race", "subicevac", "subicevac:athlete_standings"]);
  });
  it("roundtrips editor percentages without floating-point money or object-order dependence", () => {
    const draft = createDefaultRewardProgrammeDraftV2();
    draft.raceFamilySharesBps = { clubStandings: 2000, athleteStandings: 8000 };
    expect(draftFromProgrammeForm(programmeForm(draft))).toEqual(draft);
    const form = programmeForm(draft);
    form.raceFamilies = ["79.99", "20.01"];
    expect(draftFromProgrammeForm(form).raceFamilySharesBps).toEqual({ athleteStandings: 7999, clubStandings: 2001 });
  });
  it("rejects invalid editor input instead of silently normalizing percentages or weights", () => {
    for (const league of ["", "-1", "50,5", "1e2", "100.01", "50.001", "NaN"]) {
      const form = programmeForm(createDefaultRewardProgrammeDraftV2()); form.league = league;
      expect(() => draftFromProgrammeForm(form)).toThrow();
    }
    const form = programmeForm(createDefaultRewardProgrammeDraftV2());
    form.rounds[0] = "11";
    expect(() => draftFromProgrammeForm(form)).toThrow();
    form.rounds[0] = "10"; form.raceWeights[1] = "4000";
    expect(() => draftFromProgrammeForm(form)).toThrow();
  });
});
