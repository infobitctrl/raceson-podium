import { isRewardPrivyToken } from "../model/privyConfiguration";

type Session = { access_token: string; user: { id: string } };
type AuthReader = {
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
};

/** Only the explicitly opted-in demo calls this. No local token is accepted as
 * verified identity: revalidate with Auth and recheck session after the await.
 * Returning undefined tells Privy to stop authentication, without leaking errors. */
export async function getRewardPrivyToken(auth: AuthReader, issuer: string, userId: string, isCurrent: () => boolean): Promise<string | undefined> {
  try {
    if (!isCurrent()) return undefined;
    const before = await auth.getSession();
    const session = before.data.session;
    if (!isCurrent() || before.error || !session || session.user.id !== userId
      || !isRewardPrivyToken(session.access_token, issuer, userId)) return undefined;
    const verified = await auth.getUser(session.access_token);
    if (!isCurrent() || verified.error || verified.data.user?.id !== userId) return undefined;
    const after = await auth.getSession();
    if (!isCurrent() || after.error || after.data.session?.access_token !== session.access_token
      || after.data.session.user.id !== userId || !isRewardPrivyToken(session.access_token, issuer, userId)) return undefined;
    return session.access_token;
  } catch { return undefined; }
}
