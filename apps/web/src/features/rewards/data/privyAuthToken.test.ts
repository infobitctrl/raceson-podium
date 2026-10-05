import { describe, expect, it, vi } from "vitest";
import { getRewardPrivyToken } from "./privyAuthToken";

const userId = "84000000-0000-4000-8000-000000000001", issuer = "http://127.0.0.1:55321/auth/v1";
function fixture() {
  const token = [btoa(JSON.stringify({ alg: "ES256", kid: "public-test-key" })), btoa(JSON.stringify({
    iss: issuer, sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated",
    session_id: "84000000-0000-4000-8000-000000000002",
  })), "synthetic"].join(".");
  const session = { access_token: token, user: { id: userId } };
  return { token, session, auth: {
    getSession: vi.fn(async () => ({ data: { session }, error: null as unknown })),
    getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null as unknown })),
  } };
}
describe("explicit demo Auth to Privy token bridge", () => {
  it("checks Auth and rereads the session without changing app credentials", async () => {
    const f = fixture(); expect(await getRewardPrivyToken(f.auth, issuer, userId, () => true)).toBe(f.token);
    expect(f.auth.getUser).toHaveBeenCalledWith(f.token); expect(f.auth.getSession).toHaveBeenCalledTimes(2);
  });
  it("does not read tokens without current consent/session scope", async () => {
    const f = fixture(); expect(await getRewardPrivyToken(f.auth, issuer, userId, () => false)).toBeUndefined();
    expect(f.auth.getSession).not.toHaveBeenCalled();
  });
  it("fails closed after logout or a changed session during verification", async () => {
    const f = fixture(); let active = true;
    f.auth.getUser.mockImplementation(async () => { active = false; return { data: { user: { id: userId } }, error: null }; });
    expect(await getRewardPrivyToken(f.auth, issuer, userId, () => active)).toBeUndefined();
    const other = fixture(); other.auth.getSession.mockResolvedValueOnce({ data: { session: other.session }, error: null })
      .mockResolvedValueOnce({ data: { session: { ...other.session, access_token: "changed" } }, error: null });
    expect(await getRewardPrivyToken(other.auth, issuer, userId, () => true)).toBeUndefined();
  });
  it("does not expose wrong-issuer tokens, provider errors or unverified users", async () => {
    const f = fixture(); expect(await getRewardPrivyToken(f.auth, "https://wrong.example/auth/v1", userId, () => true)).toBeUndefined();
    expect(f.auth.getUser).not.toHaveBeenCalled();
    f.auth.getUser.mockRejectedValue(new Error("private provider response"));
    expect(await getRewardPrivyToken(f.auth, issuer, userId, () => true)).toBeUndefined();
    f.auth.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
    expect(await getRewardPrivyToken(f.auth, issuer, userId, () => true)).toBeUndefined();
  });
});
