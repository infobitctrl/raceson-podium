import {useEffect, useRef, useState, type ReactNode} from 'react';
import {useNavigate} from 'react-router-dom';
import {useAuth} from '@/lib/auth';
import {publicEnv} from '@/lib/public-env';
import {useI18n} from '@/shared/i18n/I18nContext';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {podiumDemoAccount, podiumDemoAccountSwitchEnabled, type PodiumDemoAccount, type PodiumDemoRole} from '@raceson/domain/rewards/demo-accounts';
import {DemoAccountSwitchContext as Context, useDemoAccountSwitch, type DemoSwitchAuth as Auth, type DemoSwitchSelection as Selection, type DemoAccountSwitchContextValue as SwitchContext} from '../data/demoAccountSwitchContext';
import s from './DemoAccountSwitcher.module.css';

/** Lives above Auth's identity-cache remount. Credentials and the operation lock
 * stay in memory in this tab, never in localStorage, URLs, logs or app source. */
export function DemoAccountSwitchProvider({children}: {children: ReactNode}) {
 const {locale} = useI18n(), hr = locale === 'hr';
 const enabled = podiumDemoAccountSwitchEnabled(publicEnv.rewardDemo, publicEnv.hostedCopy);
 const credentials = useRef(new Map<PodiumDemoRole | 'shared', string>());
 const locked = useRef(false);
 const [busy, setBusy] = useState(false), [selection, setSelection] = useState<Selection | null>(null);
 const [dialogOpen, setDialogOpen] = useState(false);
 const [destination, setDestination] = useState<SwitchContext['destination']>(null);
 const [password, setPassword] = useState(''), [shared, setShared] = useState(true), [error, setError] = useState('');
 function forget() {credentials.current.clear(); setPassword('');}
 useEffect(() => {const vault = credentials.current; return () => vault.clear();}, []);
 async function run(next: Selection, credential?: string) {
  if (locked.current || !enabled) return;
  locked.current = true; setBusy(true); setError(''); setPassword('');
  try {
   // Explicitly retire the old ordinary login and all Auth-bound private state.
   await next.auth.signOut();
   if (next.account) {
    const account = await next.auth.signIn({identifier: next.account.username, password: credential ?? '', demoAccountSwitch: true});
    if (account?.loginUsername !== next.account.username) throw Error('demo_identity_mismatch');
    credentials.current.set(next.account.role, credential!);
    if (shared) credentials.current.set('shared', credential!);
    setDestination(next.account);
   } else {forget(); setDestination('guest');}
   setDialogOpen(false);
  } catch {
   if (next.account) {
    credentials.current.delete(next.account.role);
    if (credentials.current.get('shared') === credential) credentials.current.delete('shared');
   }
   setSelection(next);
   setDialogOpen(true);
   setError(hr ? 'Promjena računa nije uspjela. Provjerite lozinku ili pokušajte kasnije.' : 'Could not switch accounts. Check the demo password or try again later.');
  } finally {locked.current = false; setBusy(false);}
 }
 function select(account: PodiumDemoAccount | null, auth: Auth) {
  if (locked.current || !enabled || account && !podiumDemoAccount(account.username)) return;
  setError('');
  if (account && auth.account?.loginUsername === account.username) {setDestination(account); return;}
  const next = {account, auth};
  const credential = account ? credentials.current.get(account.role) ?? credentials.current.get('shared') : undefined;
  if (account && !credential) {setSelection(next); setDialogOpen(true); setPassword(''); return;}
  void run(next, credential);
 }
 return <Context.Provider value={enabled ? {busy, destination, select, forget, arrived: () => setDestination(null)} : null}>
  {children}
  {enabled ? <Dialog open={dialogOpen} onOpenChange={open => {if (!open && !locked.current) {setDialogOpen(false); setPassword(''); setError('');}}}>
   <DialogContent className={s.dialog}>
    <DialogTitle>{hr ? 'Prijava u demo račun' : 'Open demo account'}</DialogTitle>
    <DialogDescription>{selection?.account?.label ?? (hr ? 'Gost' : 'Guest')} {selection?.account ? `· ${selection.account.username}` : ''}</DialogDescription>
    {selection?.account ? <form onSubmit={event => {event.preventDefault(); if (password && selection) void run(selection, password);}}>
     <label htmlFor="podium-demo-password">{hr ? 'Demo lozinka' : 'Demo password'}</label>
     <input id="podium-demo-password" type="password" autoComplete="off" required value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/>
     <label className={s.checkbox}><input type="checkbox" checked={shared} disabled={busy} onChange={event => setShared(event.target.checked)}/>{hr ? 'Koristi istu lozinku za druge demo uloge' : 'Use this password for other demo roles'}</label>
     <p className={s.hint}>{hr ? 'Lozinka ostaje samo u memoriji ove kartice. Promjena računa ne podnosi zahtjev za nagradu.' : 'Remembered only in this tab. Switching accounts does not submit a reward claim.'}</p>
     {error ? <p role="alert">{error}</p> : null}
     <button className={s.primary} disabled={busy || !password}>{busy ? (hr ? 'Promjena računa…' : 'Switching accounts…') : (hr ? 'Otvori račun' : 'Open account')}</button>
    </form> : <>{error ? <p role="alert">{error}</p> : null}<button className={s.primary} disabled={busy} onClick={() => selection && void run(selection)}>{hr ? 'Pokušaj ponovno' : 'Try again'}</button></>}
   </DialogContent>
  </Dialog> : null}
 </Context.Provider>;
}

/** Navigation runs in the current router after Auth remounts its child tree. */
export function DemoAccountSwitchNavigation() {
 const controller = useDemoAccountSwitch(), auth = useAuth(), navigate = useNavigate();
 const destination = controller?.destination;
 const userId = auth.user?.id;
 useEffect(() => {
  if (!destination || auth.isLoading) return;
  if (destination === 'guest' ? userId === undefined : auth.account?.loginUsername === destination.username && auth.account.userId === userId) {
   navigate(destination === 'guest' ? '/rewards' : destination.href); controller?.arrived();
  }
 }, [destination, auth.isLoading, auth.account?.loginUsername, auth.account?.userId, userId, navigate, controller]);
 return null;
}
