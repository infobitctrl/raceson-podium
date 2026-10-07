import {createContext, useContext} from 'react';
import type {useAuth} from '@/lib/auth';
import type {PodiumDemoAccount} from '@raceson/domain/rewards/demo-accounts';

export type DemoSwitchAuth = Pick<ReturnType<typeof useAuth>, 'signIn' | 'signOut' | 'account'>;
export type DemoSwitchSelection = {account: PodiumDemoAccount | null; auth: DemoSwitchAuth};
export type DemoAccountSwitchContextValue = {
 busy: boolean; destination: PodiumDemoAccount | 'guest' | null;
 select: (account: PodiumDemoAccount | null, auth: DemoSwitchAuth) => void;
 forget: () => void; arrived: () => void;
};
export const DemoAccountSwitchContext = createContext<DemoAccountSwitchContextValue | null>(null);
export const useDemoAccountSwitch = () => useContext(DemoAccountSwitchContext);
