import { renderHook } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { useRewardSessionEpoch } from "./useRewardSessionEpoch";

const fixture = () => ({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
  user: { id: "synthetic-user" }, expires_at: 9999999999, token_type: "bearer" }) as Session;

describe("private reward session epoch", () => {
  it("preserves identical credentials after Auth re-emits new session/user objects", () => {
    const { result, rerender } = renderHook(useRewardSessionEpoch, { initialProps: fixture() });
    const epoch = result.current;
    rerender(fixture()); expect(result.current).toBe(epoch);
    expect(epoch).not.toContain("synthetic");
  });
  it.each(["access_token", "refresh_token", "expires_at", "token_type", "user"] as const)("invalidates on %s change", field => {
    const session = fixture(), { result, rerender } = renderHook(useRewardSessionEpoch, { initialProps: session });
    const epoch = result.current;
    rerender({ ...session, [field]: field === "user" ? { id: "other-user" } : field === "expires_at" ? 9999999998 : "other-synthetic" } as Session);
    expect(result.current).not.toBe(epoch);
  });
  it("does not resurrect an earlier epoch after logout or a token change and return", () => {
    const { result, rerender } = renderHook(useRewardSessionEpoch, { initialProps: fixture() as Session | null });
    const epoch = result.current; rerender(null); expect(result.current).not.toBe(epoch);
    rerender(fixture()); expect(result.current).not.toBe(epoch);
    const next = result.current;
    rerender({ ...fixture(), access_token: "rotated" }); rerender(fixture()); expect(result.current).not.toBe(next);
  });
  it("does not grant equivalence to incomplete session copies", () => {
    const incomplete = { access_token: "synthetic-only" } as Session;
    const { result, rerender } = renderHook(useRewardSessionEpoch, { initialProps: incomplete });
    const epoch = result.current; rerender({ ...incomplete }); expect(result.current).not.toBe(epoch);
  });
});
