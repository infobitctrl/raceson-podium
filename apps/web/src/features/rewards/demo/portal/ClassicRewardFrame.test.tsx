import { useEffect, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter, Link } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import ClassicRewardFrame from "./ClassicRewardFrame";
import { contextLink, presentationLink } from "./portalLinks";

describe("classic presentation continuity", () => {
  it("preserves exact identifiers, selected receipt and component instance across mode changes", () => {
    let mounts = 0;
    function Receipt() {
      const [selected, select] = useState(false);
      useEffect(() => { mounts++; }, []);
      return <><button onClick={() => select(true)}>Inspect receipt</button>{selected ? <p>Receipt selected</p> : null}</>;
    }
    window.history.replaceState({}, "", "/athlete/rewards?draft=programme&revision=3&entitlement=award&claim=claim#receipt");
    render(<I18nProvider initialLocale="en"><BrowserRouter><ClassicRewardFrame><Link to={presentationLink(window.location.pathname, window.location.search, window.location.hash, true)}>Switch presentation</Link><Receipt /></ClassicRewardFrame></BrowserRouter></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Inspect receipt" }));
    fireEvent.click(screen.getByRole("link", { name: "Switch presentation" }));
    expect(screen.getByText("Receipt selected")).toBeVisible(); expect(mounts).toBe(1);
    expect(window.location.search).toContain("entitlement=award"); expect(window.location.hash).toBe("#receipt");
    fireEvent.click(screen.getByRole("link", { name: "Standalone rewards" }));
    expect(window.location.search).toBe("?draft=programme&revision=3&entitlement=award&claim=claim");
    expect(mounts).toBe(1);
  });
  it("only changes presentation and safely encodes context selectors", () => {
    expect(presentationLink("/club/rewards", "?claim=x&experience=classic", "#receipt", false)).toBe("/club/rewards?claim=x#receipt");
    expect(contextLink({ event: "https://www.raceson.com/x" })).toBe("/organizer/reward-context?event=https%3A%2F%2Fwww.raceson.com%2Fx");
  });
});
