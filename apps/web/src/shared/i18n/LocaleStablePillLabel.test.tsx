import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleStablePillLabel } from "@/shared/i18n/LocaleStablePillLabel";
import { installCroatianDocumentLocalization } from "@/shared/i18n/documentLocalization";

describe("LocaleStablePillLabel", () => {
  it("reserves the English label footprint while Croatian uses a smaller stable label", () => {
    const { container } = render(
      <LocaleStablePillLabel referenceLabel="Short">
        Kratka ruta
      </LocaleStablePillLabel>,
    );

    const label = screen.getByText("Kratka ruta");
    const root = label.parentElement;

    expect(root).toHaveAttribute("data-locale-pill-reference", "Short");
    expect(root).toHaveAttribute("data-i18n-skip");
    expect(label).toHaveAttribute("data-locale-fit", "stable-pill");
    expect(root?.querySelector('[aria-hidden="true"]')).toHaveTextContent("Short");

    const restore = installCroatianDocumentLocalization(container);
    expect(root?.querySelector('[aria-hidden="true"]')).toHaveTextContent("Short");
    restore();
  });
});
