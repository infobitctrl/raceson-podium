import {useState} from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {beforeEach, expect, it, vi} from 'vitest';
import DemoAccountSwitcher from './DemoAccountSwitcher';
import {DemoAccountSwitchNavigation, DemoAccountSwitchProvider} from './DemoAccountSwitchProvider';
const state = vi.hoisted(() => ({
 auth: {user: null as {id: string} | null, account: null as {userId: string; loginUsername: string} | null, isLoading: false, signIn: vi.fn(), signOut: vi.fn()},
 env: {hostedCopy: true, rewardDemo: {mode: 'testnet', chainId: 10143, supabaseUrl: 'https://niklhlmljiikwbkrmapw.supabase.co'}}, notify: () => {}, locale: 'en',
}));
vi.mock('@/lib/auth', () => ({useAuth: () => state.auth}));
vi.mock('@/lib/public-env', () => ({publicEnv: state.env}));
vi.mock('@/shared/i18n/I18nContext', () => ({useI18n: () => ({locale: state.locale})}));
function Route() {const {pathname} = useLocation(); return <p data-testid="route">{pathname}</p>;}
function IdentityBoundary() {
 const [epoch, setEpoch] = useState(0); state.notify = () => setEpoch(value => value + 1);
 return <MemoryRouter key={epoch} initialEntries={['/rewards']}><DemoAccountSwitchNavigation/><DemoAccountSwitcher/><Route/></MemoryRouter>;
}
function view() {return render(<DemoAccountSwitchProvider><IdentityBoundary/></DemoAccountSwitchProvider>);}
function setAccount(username: string | null) {state.auth.user = username ? {id: username} : null; state.auth.account = username ? {userId: username, loginUsername: username} : null; state.notify();}
function openGroup(label: 'Athletes' | 'Clubs') {
 fireEvent.click(screen.getByLabelText('Switch demo account'));
 const summary = screen.getByText(label).closest('summary')!; fireEvent.click(summary);
 return within(summary.closest('details')!);
}
async function enterPassword(shared = true) {
 const dialog = within(await screen.findByRole('dialog'));
 fireEvent.change(dialog.getByLabelText('Demo password'), {target: {value: 'fictional-test-password'}});
 if (!shared) fireEvent.click(dialog.getByRole('checkbox'));
 fireEvent.click(dialog.getByRole('button', {name: 'Open account'}));
}
beforeEach(() => {
 state.auth.user = null; state.auth.account = null; state.auth.isLoading = false;
 state.env.hostedCopy = true; state.env.rewardDemo = {mode: 'testnet', chainId: 10143, supabaseUrl: 'https://niklhlmljiikwbkrmapw.supabase.co'};
 state.locale = 'en'; state.notify = () => {};
 state.auth.signOut.mockReset().mockImplementation(async () => {setAccount(null);});
 state.auth.signIn.mockReset().mockImplementation(async ({identifier}: {identifier: string}) => {setAccount(identifier); return state.auth.account;});
 localStorage.clear(); sessionStorage.clear();
});
it('offers all numbered accounts and exact search reaches first/middle/last without fabricated clubs', () => {
 view(); const athletes = openGroup('Athletes');
 expect(athletes.getAllByRole('button')).toHaveLength(274);
 for (const ordinal of [1,137,274]) {
  fireEvent.change(athletes.getByRole('searchbox'), {target: {value: String(ordinal)}});
  expect(athletes.getAllByRole('button')).toHaveLength(1);
  expect(athletes.getByRole('button', {name: `Athlete ${ordinal} demo.athlete${ordinal}`})).toBeInTheDocument();
 }
 fireEvent.change(athletes.getByRole('searchbox'), {target: {value: '275'}}); expect(athletes.queryByRole('button')).not.toBeInTheDocument();
 const clubs = within(screen.getByText('Clubs').closest('details')!); fireEvent.click(screen.getByText('Clubs').closest('summary')!);
 expect(clubs.getAllByRole('button')).toHaveLength(41);
 fireEvent.change(clubs.getByRole('searchbox'), {target: {value: 'demo.club41'}});
 expect(clubs.getByRole('button', {name: 'Club 41 demo.club41'})).toBeInTheDocument();
});
it('signs into the actual selected athlete, survives identity remount and opens their workspace', async () => {
 view(); const athletes = openGroup('Athletes'); fireEvent.change(athletes.getByRole('searchbox'), {target: {value: '274'}});
 fireEvent.click(athletes.getByRole('button', {name: 'Athlete 274 demo.athlete274'})); await enterPassword();
 await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/athlete/rewards'));
 expect(state.auth.signOut).toHaveBeenCalledTimes(1);
 expect(state.auth.signIn).toHaveBeenCalledWith({identifier: 'demo.athlete274', password: 'fictional-test-password', demoAccountSwitch: true});
 expect(screen.getByRole('button', {name: 'Next account'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button', {name: 'Previous account'}));
 await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.athlete273'));
 expect(state.auth.signIn).toHaveBeenCalledTimes(2); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});
it('shows only the current account sequential controls, including first and last club bounds', async () => {
 setAccount('demo.club1'); view(); expect(screen.getByRole('button', {name: 'Previous account'})).toBeDisabled();
 const clubs = openGroup('Clubs'); fireEvent.change(clubs.getByRole('searchbox'), {target: {value: '41'}});
 fireEvent.click(clubs.getByRole('button', {name: 'Club 41 demo.club41'})); await enterPassword();
 await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/club/rewards'));
 expect(state.auth.account?.loginUsername).toBe('demo.club41'); expect(screen.getByRole('button', {name: 'Next account'})).toBeDisabled();
});
it('supports different role passwords and reuses the validated athlete password within its cohort', async () => {
 view(); const athletes = openGroup('Athletes'); fireEvent.click(athletes.getByRole('button', {name: 'Athlete 1 demo.athlete1'})); await enterPassword(false);
 await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.athlete1'));
 fireEvent.click(screen.getByRole('button', {name: 'Next account'})); await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.athlete2'));
 fireEvent.click(screen.getByLabelText('Switch demo account')); fireEvent.click(screen.getByRole('button', {name: 'Sponsor'}));
 expect(await screen.findByRole('dialog')).toHaveTextContent('Sponsor · demo.sponsor'); expect(state.auth.signIn).toHaveBeenCalledTimes(2);
});
it('shares credentials only after a successful login, and Forget makes the next switch request them again', async () => {
 view(); const athletes = openGroup('Athletes'); fireEvent.click(athletes.getByRole('button', {name: 'Athlete 1 demo.athlete1'})); await enterPassword();
 await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.athlete1'));
 fireEvent.click(screen.getByLabelText('Switch demo account')); fireEvent.click(screen.getByRole('button', {name: 'Reviewer'}));
 await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/rewards/review'));
 fireEvent.click(screen.getByLabelText('Switch demo account')); fireEvent.click(screen.getByRole('button', {name: 'Forget demo passwords'}));
 fireEvent.click(screen.getByRole('button', {name: 'Admin'})); expect(await screen.findByRole('dialog')).toHaveTextContent('Admin · demo.master');
 expect(state.auth.signIn).toHaveBeenCalledTimes(2);
});
it('holds the switch lock through logout/remount and prevents duplicate requests', async () => {
 let finish!: () => void;
 state.auth.signOut.mockImplementation(() => {setAccount(null); return new Promise<void>(resolve => {finish = resolve;});});
 setAccount('demo.club1'); view(); fireEvent.click(screen.getByRole('button', {name: 'Next account'})); await enterPassword();
 await waitFor(() => expect(screen.getByText('Sponsor').closest('button')).toBeDisabled());
 fireEvent.click(screen.getByText('Sponsor').closest('button')!); expect(state.auth.signOut).toHaveBeenCalledTimes(1); expect(state.auth.signIn).not.toHaveBeenCalled();
 finish(); await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.club2'));
 expect(state.auth.signIn).toHaveBeenCalledTimes(1);
});
it('a failed switch leaves private state retired, exposes retry and never navigates to the requested workspace', async () => {
 state.auth.signIn.mockRejectedValueOnce(new Error('wrong password')); setAccount('demo.club1'); view();
 fireEvent.click(screen.getByRole('button', {name: 'Next account'})); await enterPassword();
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch accounts'); expect(state.auth.account).toBeNull();
 expect(screen.getByTestId('route')).toHaveTextContent('/rewards');
 expect(screen.getByLabelText('Demo password')).toHaveValue(''); await enterPassword();
 await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/club/rewards'));
});
it('Guest retires login, forgets remembered passwords and opens public Home', async () => {
 view(); const athletes = openGroup('Athletes'); fireEvent.click(athletes.getByRole('button', {name: 'Athlete 1 demo.athlete1'})); await enterPassword();
 await waitFor(() => expect(state.auth.account?.loginUsername).toBe('demo.athlete1'));
 fireEvent.click(screen.getByLabelText('Switch demo account')); fireEvent.click(screen.getByRole('button', {name: 'Guest · public view'}));
 await waitFor(() => expect(state.auth.user).toBeNull()); expect(screen.getByTestId('route')).toHaveTextContent('/rewards');
 const again = openGroup('Athletes'); fireEvent.click(again.getByRole('button', {name: 'Athlete 1 demo.athlete1'}));
 expect(await screen.findByRole('dialog')).toBeVisible(); expect(state.auth.signIn).toHaveBeenCalledTimes(1);
});
it.each(['disabled','other-project','local'])('withholds the switcher for %s configuration', kind => {
 if(kind === 'disabled') state.env.hostedCopy = false;
 if(kind === 'other-project') state.env.rewardDemo.supabaseUrl = 'https://icdtinbmtvzhswrrzjxq.supabase.co';
 if(kind === 'local') state.env.rewardDemo.mode = 'local'; view(); expect(screen.queryByLabelText('Switch demo account')).not.toBeInTheDocument();
});
