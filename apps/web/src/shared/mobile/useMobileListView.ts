import { useEffect, useState } from "react";

const MOBILE_LIST_QUERY = "(max-width: 639px)";

/** Keeps compact catalogs in list view below Tailwind's `sm` breakpoint. */
export function useMobileListView<ViewMode extends string>(viewMode: ViewMode, listMode: ViewMode) {
  const [isMobileListOnly, setIsMobileListOnly] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(MOBILE_LIST_QUERY).matches
  ));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;

    const query = window.matchMedia(MOBILE_LIST_QUERY);
    const syncViewMode = () => setIsMobileListOnly(query.matches);
    syncViewMode();
    query.addEventListener("change", syncViewMode);
    return () => query.removeEventListener("change", syncViewMode);
  }, []);

  return isMobileListOnly ? listMode : viewMode;
}
