import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRewardDocumentTitle } from "./useRewardDocumentTitle";

function createAnnouncer() {
  const host = document.createElement("next-route-announcer");
  const live = document.createElement("div"); live.id = "__next-route-announcer__"; live.setAttribute("aria-live", "assertive");
  host.attachShadow({ mode: "open" }).append(live); document.body.append(host);
  return live;
}
function Page({ path, title }: { path: string; title: string }) {
  useRewardDocumentTitle(path, title);
  return null;
}
afterEach(() => { document.querySelectorAll("next-route-announcer").forEach(node => node.remove()); });

it("keeps initial load silent and replaces the preceding announcement on navigation and Back", () => {
  const live = createAnnouncer();
  const view = render(<Page path="/club/rewards" title="Club | RacesOn Podium" />);
  expect(document.title).toBe("Club | RacesOn Podium"); expect(live).toHaveTextContent("");
  view.rerender(<Page path="/athlete/rewards" title="Athlete | RacesOn Podium" />);
  expect(live).toHaveTextContent("Athlete | RacesOn Podium");
  view.rerender(<Page path="/club/rewards" title="Club | RacesOn Podium" />);
  expect(live).toHaveTextContent("Club | RacesOn Podium");
});
it("restores the current title after shell metadata changes and releases ownership on unmount", async () => {
  const view = render(<Page path="/club/rewards" title="Club | RacesOn Podium" />);
  act(() => { document.title = "Shell"; });
  await waitFor(() => expect(document.title).toBe("Club | RacesOn Podium"));
  view.unmount(); document.title = "Next page";
  await act(async () => {}); expect(document.title).toBe("Next page");
});
it("announces only the current destination when Next creates its live region late", async () => {
  const view = render(<Page path="/a" title="A" />);
  view.rerender(<Page path="/b" title="B" />);
  view.rerender(<Page path="/c" title="C" />);
  const live = createAnnouncer();
  await waitFor(() => expect(live).toHaveTextContent("C"));
  view.rerender(<Page path="/c" title="C hrvatski" />);
  expect(live).toHaveTextContent("C hrvatski");
});
it("publishes the destination before an external passive-effect title reader", () => {
  const observed: string[] = [];
  function Reader() { useEffect(() => { observed.push(document.title); }); return null; }
  function Route({ path, title }: { path: string; title: string }) {
    useRewardDocumentTitle(path, title); return <Reader />;
  }
  const view = render(<Route path="/a" title="A" />);
  view.rerender(<Route path="/b" title="B" />);
  expect(observed).toEqual(["A", "B"]);
});
