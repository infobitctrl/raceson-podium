import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appCss = readFileSync("src/index.css", "utf8");

const croatianLocaleFitBlocks = [
  ...appCss.matchAll(
    /html\[lang="hr"\]\s+\[data-locale-fit="([^"]+)"\]\s*\{([^}]*)\}/g,
  ),
];

describe("Croatian locale-fit typography", () => {
  it("preserves the component's minimum control width for touch targets", () => {
    const controlDeclarations = croatianLocaleFitBlocks.find((match) => match[1] === "control")?.[2];
    expect(controlDeclarations).toBeDefined();
    expect(controlDeclarations).not.toMatch(/(?:^|;)\s*min-width\s*:/);
  });

  it("keeps component font sizes instead of overriding them from the parent", () => {
    expect(croatianLocaleFitBlocks.map((match) => match[1])).toEqual([
      "stable-pill",
      "pill",
      "info-pill",
      "control",
      "table-heading",
    ]);

    for (const [, , declarations] of croatianLocaleFitBlocks) {
      expect(declarations).not.toMatch(/(?:^|;)\s*font-size\s*:/);
    }
  });
});
