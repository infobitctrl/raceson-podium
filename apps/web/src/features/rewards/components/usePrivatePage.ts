import { useCallback, useEffect, useRef, useState } from "react";
import { organizerAccessLost, type OrganizerPage, type RewardNetwork } from "../model/organizerRewards";

/** Local, session-keyed private state; no persisted cache, polling or eager
 * per-row review reads. Every selection remounts the next scoped view. */
export function usePrivatePage<T>(fetchPage: (after: string | null) => Promise<OrganizerPage<T>>, onAccessLost: (error: unknown) => void) {
  const [state, setState] = useState<{ items: T[]; nextCursor: string | null; chainId: RewardNetwork | null;
    loading: boolean; error: unknown }>({ items: [], nextCursor: null, chainId: null, loading: true, error: null });
  const epoch = useRef(0), flight = useRef(false), lost = useRef(onAccessLost); lost.current = onAccessLost;
  const load = useCallback(async (after: string | null = null) => {
    if (flight.current) return;
    const ticket = ++epoch.current; flight.current = true;
    setState(prev => ({ items: after ? prev.items : [], nextCursor: null, chainId: prev.chainId, loading: true, error: null }));
    try {
      const page = await fetchPage(after);
      if (ticket === epoch.current) setState(prev => ({ ...page, items: after ? [...prev.items, ...page.items] : page.items, loading: false, error: null }));
    } catch (error) { if (ticket === epoch.current) {
      setState({ items: [], nextCursor: null, chainId: null, loading: false, error }); if (organizerAccessLost(error)) lost.current(error);
    } } finally { if (ticket === epoch.current) flight.current = false; }
  }, [fetchPage]);
  useEffect(() => { void load(); return () => { epoch.current += 1; flight.current = false; }; }, [load]);
  return { ...state, load };
}
