/** Public test-account aliases from the isolated five-round copy. This list
 * grants no role, sporting eligibility, wallet ownership or claim authority. */
export type PodiumDemoRole = 'athlete' | 'club' | 'sponsor' | 'reviewer' | 'admin';
export type PodiumDemoAccount = Readonly<{role: PodiumDemoRole; ordinal: number | null; username: string; label: string; href: string}>;
export const podiumDemoAccountCounts = {athlete: 274, club: 41} as const;
export const podiumDemoDestinations = {athlete: '/athlete/rewards', club: '/club/rewards', sponsor: '/rewards/manage', reviewer: '/rewards/review', admin: '/rewards/admin/wallets'} as const;
const numbered = (role: 'athlete' | 'club', count: number): PodiumDemoAccount[] => Array.from({length: count}, (_, index) => ({
 role, ordinal: index + 1, username: `demo.${role}${index + 1}`, label: `${role === 'athlete' ? 'Athlete' : 'Club'} ${index + 1}`, href: podiumDemoDestinations[role],
}));
export const podiumDemoAccounts: readonly PodiumDemoAccount[] = Object.freeze([
 ...numbered('athlete', podiumDemoAccountCounts.athlete), ...numbered('club', podiumDemoAccountCounts.club),
 {role: 'sponsor', ordinal: null, username: 'demo.sponsor', label: 'Sponsor', href: podiumDemoDestinations.sponsor},
 {role: 'reviewer', ordinal: null, username: 'demo.review', label: 'Reviewer', href: podiumDemoDestinations.reviewer},
 {role: 'admin', ordinal: null, username: 'demo.master', label: 'Admin', href: podiumDemoDestinations.admin},
]);
const accounts = new Map(podiumDemoAccounts.map(account => [account.username, account]));
export function podiumDemoAccount(username: unknown): PodiumDemoAccount | null {
 return typeof username === 'string' ? accounts.get(username) ?? null : null;
}
export function podiumDemoAccountSwitchEnabled(target: {mode: string; chainId: number; supabaseUrl: string} | null | undefined, hostedCopy: boolean): boolean {
 return hostedCopy && target?.mode === 'testnet' && target.chainId === 10143 && target.supabaseUrl === 'https://niklhlmljiikwbkrmapw.supabase.co';
}
