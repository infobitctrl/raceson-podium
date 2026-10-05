import { useMemo } from "react";
import type { Session } from "@supabase/supabase-js";

/** A private UI epoch, not authentication. Supabase can re-emit SIGNED_IN on
 * tab focus with a new object containing the exact same credentials. Preserve
 * pending UI only for that exact session; token rotation/logout still retires
 * it. Never use credentials as a React key, query key, log or persisted value. */
export function useRewardSessionEpoch(session: Session | null): string {
  const access = session?.access_token;
  const refresh = session?.refresh_token;
  const userId = session?.user?.id;
  const expiry = session?.expires_at;
  const type = session?.token_type;
  // Incomplete/malformed snapshots cannot acquire same-session equivalence.
  const incomplete = access && refresh && userId && Number.isFinite(expiry) && type ? null : session;
  // Dependencies deliberately invalidate an opaque ID without embedding secrets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => crypto.randomUUID(), [access, refresh, userId, expiry, type, incomplete]);
}
