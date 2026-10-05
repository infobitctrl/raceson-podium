import { describe, expect, it } from "vitest";
import { resolveRouteDocumentTitle } from "@/features/public-metadata/model/routeDocumentTitle";
describe("ordinary portal reward-route exclusion", () => {
  it("does not register demo athlete or club rewards as production page titles in either locale", () => {
    for (const path of ["/athlete/rewards", "/club/rewards"]) {
      expect(resolveRouteDocumentTitle(path, "en")).toEqual({ key: path, title: "Page not found" });
      expect(resolveRouteDocumentTitle(path, "hr")).toEqual({ key: path, title: "Stranica nije pronađena" });
    }
  });
});
