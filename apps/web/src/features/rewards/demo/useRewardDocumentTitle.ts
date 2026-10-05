import { useLayoutEffect, useRef } from "react";

/** The embedded router owns Podium titles; Next also observes navigation and can
 * restore shell metadata or announce the preceding page before this router runs.
 * Keep the existing Next live region aligned, without adding a second announcer.
 * Mirrors the shared DocumentTitleScope lifecycle, preserving Podium branding. */
export function useRewardDocumentTitle(routeKey: string, title: string) {
  const previous = useRef<{ routeKey: string; title: string } | null>(null);
  useLayoutEffect(() => {
    const enforceTitle = () => {
      if (document.title !== title) document.title = title;
    };
    enforceTitle();
    const titleObserver = new MutationObserver(enforceTitle);
    titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    const changed = previous.current && (previous.current.routeKey !== routeKey || previous.current.title !== title);
    previous.current = { routeKey, title };
    let announcerObserver: MutationObserver | null = null;
    if (changed) {
      const announce = () => {
        const announcer = document.querySelector("next-route-announcer")?.shadowRoot?.getElementById("__next-route-announcer__");
        if (!announcer) return false;
        if (announcer.textContent !== title) announcer.textContent = title;
        return true;
      };
      if (!announce()) {
        announcerObserver = new MutationObserver(() => {
          if (announce()) announcerObserver?.disconnect();
        });
        announcerObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
    return () => { titleObserver.disconnect(); announcerObserver?.disconnect(); };
  }, [routeKey, title]);
}
