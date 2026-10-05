import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("loads scoped reward CSS in the isolated layout before client-only screens", () => {
  const layout = readFileSync("../../demo/rewards/web/app/layout.tsx", "utf8");
  // Browser acceptance checks computed styles too; JSDOM alone cannot detect
  // a Next stylesheet omitted from the client-only route's cold-load assets.
  for (const module of ["components/GuidedRewardSetup", "components/RewardLeagueMetrics", "components/RewardEditorial", "screens/ProgrammeSourceMapping", "screens/ContractCanary", "screens/RewardProgramme"]) {
    expect(layout).toContain(`import "../../../../apps/web/src/features/rewards/${module}.module.css";`);
  }
  // Podium contains compatibility components, not the production website shell.
  expect(existsSync("app/layout.tsx")).toBe(false);
});
