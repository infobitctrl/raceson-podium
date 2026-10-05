"use client";

import { createContext, useContext, type ReactNode } from "react";
import { storedEventSlug } from "@/features/events/model/eventUrl";
import type { PublicEventHeroShellData } from "@/features/public-metadata/model/publicPortalMetadata";

type InitialEvent = { slug: string; data: PublicEventHeroShellData };
const InitialEventContext = createContext<InitialEvent | null>(null);

/** Public server data survives a slow or failed browser request for this race only. */
export function PublicEventInitialDataProvider({ value, children }: {
  value: InitialEvent | null;
  children: ReactNode;
}) {
  return <InitialEventContext.Provider value={value}>{children}</InitialEventContext.Provider>;
}

export function usePublicEventInitialData(slug: string) {
  const initial = useContext(InitialEventContext);
  return initial && storedEventSlug(initial.slug) === storedEventSlug(slug) ? initial.data : null;
}

export function PublicEventInitialSummary({ data }: { data: PublicEventHeroShellData }) {
  return <div className="mx-auto max-w-3xl pb-8">
    <h1 className="font-display text-3xl font-bold">{data.name}</h1>
    <p className="mt-3 text-muted-foreground">{data.locationLabel}</p>
    {data.description ? <p className="mt-4 text-muted-foreground">{data.description}</p> : null}
  </div>;
}
