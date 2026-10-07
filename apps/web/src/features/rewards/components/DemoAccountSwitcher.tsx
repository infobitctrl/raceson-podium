import {useEffect, useRef, useState} from 'react';
import {useLocation} from 'react-router-dom';
import {ChevronDown, ChevronLeft, ChevronRight, UsersRound} from 'lucide-react';
import {useAuth} from '@/lib/auth';
import {useI18n} from '@/shared/i18n/I18nContext';
import {podiumDemoAccount, podiumDemoAccounts, podiumDemoAccountCounts, type PodiumDemoRole} from '@raceson/domain/rewards/demo-accounts';
import {useDemoAccountSwitch} from '../data/demoAccountSwitchContext';
import s from './DemoAccountSwitcher.module.css';

const labels = {athlete: ['Athletes', 'Sportaši'], club: ['Clubs', 'Klubovi'], sponsor: ['Sponsor', 'Sponzor'], reviewer: ['Reviewer', 'Pregledavatelj'], admin: ['Admin', 'Administrator']} as const;
function AccountList({role, current, disabled, choose}: {role: 'athlete' | 'club'; current: string | undefined | null; disabled: boolean; choose: (username: string) => void}) {
 const {locale} = useI18n(), hr = locale === 'hr', [query, setQuery] = useState(''), [open, setOpen] = useState(false);
 const search = query.trim().toLowerCase();
 const rows = podiumDemoAccounts.filter(account => account.role === role && (!search || (/^\d+$/.test(search)
  ? account.ordinal === Number(search) : `${account.label} ${account.username}`.toLowerCase().includes(search))));
 return <details className={s.submenu} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
  <summary onClick={event => {event.preventDefault(); setOpen(value => !value);}}>{labels[role][hr ? 1 : 0]} <span>1–{podiumDemoAccountCounts[role]}</span><ChevronRight size={14}/></summary>
  {open ? <div className={s.subpanel}>
   <label className={s.searchLabel}>{hr ? 'Pretraži' : 'Search'} {labels[role][hr ? 1 : 0].toLowerCase()}<input type="search" value={query} placeholder={hr ? 'Broj ili korisničko ime' : 'Number or username'} onChange={event => setQuery(event.target.value)}/></label>
   <div className={s.accounts} aria-label={hr ? `Demo ${labels[role][1].toLowerCase()}` : `Demo ${role} accounts`}>
    {rows.map(account => <button key={account.username} type="button" disabled={disabled} aria-current={current === account.username ? 'true' : undefined} onClick={() => choose(account.username)}><span>{hr ? role === 'athlete' ? `Sportaš ${account.ordinal}` : `Klub ${account.ordinal}` : account.label}</span><small>{account.username}</small></button>)}
    {!rows.length ? <p>{hr ? 'Nema odgovarajućih računa.' : 'No matching accounts.'}</p> : null}
   </div>
  </div> : null}
 </details>;
}
export default function DemoAccountSwitcher({disabled = false}: {disabled?: boolean}) {
 const controller = useDemoAccountSwitch(), auth = useAuth(), {locale} = useI18n(), hr = locale === 'hr';
 const menu = useRef<HTMLDetailsElement>(null);
 const {pathname, search} = useLocation();
 useEffect(() => {if (menu.current) menu.current.open = false;}, [pathname, search, auth.user?.id]);
 if (!controller) return null;
 const current = auth.account?.userId === auth.user?.id ? podiumDemoAccount(auth.account?.loginUsername) : null;
 const busy = disabled || controller.busy || auth.isLoading;
 function choose(username: string) {
  const account = podiumDemoAccount(username);
  if (!account || busy) return;
  if (menu.current) menu.current.open = false;
  controller!.select(account, auth);
 }
 function guest() {if (menu.current) menu.current.open = false; controller!.select(null, auth);}
 return <div className={s.root}>
  <details ref={menu} className={s.dropdown}>
   <summary aria-label={hr ? 'Promijeni demo račun' : 'Switch demo account'}><UsersRound size={18}/><span>{busy ? (hr ? 'Promjena…' : 'Switching…') : current ? `Demo · ${current.label}` : (hr ? 'Demo računi' : 'Demo accounts')}</span><ChevronDown size={13}/></summary>
   <div className={s.panel}>
    <p className={s.title}>{hr ? 'Hackathon · demo računi' : 'Hackathon · demo accounts'}</p>
    <p className={s.current}>{current?.username ?? auth.account?.loginUsername ?? (hr ? 'Gost' : 'Guest')}</p>
    <AccountList role="athlete" current={current?.username} disabled={busy} choose={choose}/>
    <AccountList role="club" current={current?.username} disabled={busy} choose={choose}/>
    {(['sponsor', 'reviewer', 'admin'] as const satisfies readonly PodiumDemoRole[]).map(role => <button key={role} disabled={busy} aria-current={current?.role === role ? 'true' : undefined} onClick={() => choose(podiumDemoAccounts.find(account => account.role === role)!.username)}>{labels[role][hr ? 1 : 0]}</button>)}
    <button disabled={busy} onClick={guest}>{hr ? 'Gost · javni prikaz' : 'Guest · public view'}</button>
    <button className={s.forget} disabled={busy} onClick={controller.forget}>{hr ? 'Zaboravi demo lozinke' : 'Forget demo passwords'}</button>
   </div>
  </details>
  {current?.ordinal ? <div className={s.steps} aria-label={hr ? 'Redoslijed demo računa' : 'Sequential demo accounts'}>
   <button aria-label={hr ? 'Prethodni račun' : 'Previous account'} disabled={busy || current.ordinal === 1} onClick={() => choose(`demo.${current.role}${current.ordinal! - 1}`)}><ChevronLeft size={16}/></button>
   <span>{current.ordinal}/{podiumDemoAccountCounts[current.role as 'athlete' | 'club']}</span>
   <button aria-label={hr ? 'Sljedeći račun' : 'Next account'} disabled={busy || current.ordinal === podiumDemoAccountCounts[current.role as 'athlete' | 'club']} onClick={() => choose(`demo.${current.role}${current.ordinal! + 1}`)}><ChevronRight size={16}/></button>
  </div> : null}
 </div>;
}

export function DemoAccountPhoneNavigation() {
 const controller = useDemoAccountSwitch(), auth = useAuth(), {locale} = useI18n(), hr = locale === 'hr';
 const account = auth.account?.userId === auth.user?.id ? podiumDemoAccount(auth.account?.loginUsername) : null;
 if (!controller || !account) return null;
 const count = account.ordinal ? podiumDemoAccountCounts[account.role as 'athlete' | 'club'] : null;
 const busy = controller.busy || auth.isLoading;
 function step(offset: number) {
  const next = podiumDemoAccount(`demo.${account!.role}${account!.ordinal! + offset}`);
  if (next && !busy) controller!.select(next, auth);
 }
 return <div className={s.phoneNavigation}>
  <span>{account.username}</span>
  {account.ordinal ? <div><button aria-label={hr ? 'Prethodni demo račun' : 'Previous demo account'} disabled={busy || account.ordinal === 1} onClick={() => step(-1)}><ChevronLeft size={16}/></button><span>{account.ordinal}/{count}</span><button aria-label={hr ? 'Sljedeći demo račun' : 'Next demo account'} disabled={busy || account.ordinal === count} onClick={() => step(1)}><ChevronRight size={16}/></button></div> : <small>{hr ? labels[account.role][1] : account.label}</small>}
 </div>;
}
