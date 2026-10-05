import { createContext, useContext, useEffect } from "react";

export type RegisterTitle = (key: string, title: string) => () => void;
export const TitleContext = createContext<RegisterTitle | null>(null);

export function documentTitleKey(kind: string, ...ids: string[]) {
  return JSON.stringify([kind, ...ids]);
}

export function brandedDocumentTitle(title: string) {
  const label = title.trim();
  return label.startsWith("RacesOn |") || label.endsWith(" | RacesOn")
    ? label
    : `${label} | RacesOn`;
}

/** Register already-loaded page data against its own identity, not the new URL. */
export function useDocumentTitle(key: string, title: string | null | undefined) {
  const register = useContext(TitleContext);
  const label = title?.trim();
  useEffect(() => {
    if (!register || !label) return;
    return register(key, label);
  }, [key, label, register]);
}
