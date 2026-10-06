import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import PodiumHeader from './PodiumHeader';
const state=vi.hoisted(()=>({
 auth:{user:{id:'current'} as {id:string}|null,session:{access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:1800000000,token_type:'bearer',user:{id:'current'}} as object|null,
  account:{userId:'current',loginUsername:'demo.user',hasOrganizerAccess:false,hasAthleteAccess:false,platformRole:'user'} as {userId:string;loginUsername:string;hasOrganizerAccess:boolean;hasAthleteAccess:boolean;platformRole:string}|null,signOut:vi.fn()},
 api:vi.fn(),locale:'en',
}));
vi.mock('@/lib/auth',()=>({useAuth:()=>state.auth}));
vi.mock('@/lib/api',()=>({apiRequest:state.api}));
vi.mock('@/lib/public-env',()=>({publicEnv:{rewardDemo:{mode:'testnet',chainId:10143}}}));
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:state.locale})}));
const empty={chainId:10143,items:[],nextCursor:null};
const owned={...empty,items:[{clubId:'73000000-0000-4000-8000-000000000001',name:'Synthetic club'}]};
function view(path='/rewards'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const tree=()=><QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><PodiumHeader/></MemoryRouter></QueryClientProvider>;
 return {...render(tree()),tree,client};
}
function nav(){return within(screen.getByRole('navigation',{name:'Main navigation'}));}
beforeEach(()=>{
 state.auth.user={id:'current'};state.auth.session={access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_at:1800000000,token_type:'bearer',user:{id:'current'}};
 state.auth.account={userId:'current',loginUsername:'demo.user',hasOrganizerAccess:false,hasAthleteAccess:false,platformRole:'user'};
 state.auth.signOut.mockReset();state.api.mockReset().mockResolvedValue(empty);state.locale='en';
});
it.each([
 ['admin','Admin','/rewards/admin/wallets'],['reviewer','Review','/rewards/review'],['club','Club rewards','/club/rewards'],['athlete','My rewards','/athlete/rewards'],['sponsor','My campaigns','/rewards/manage'],
])('shows the %s workspace on Home from verified account facts',async(role,label,href)=>{
 if(role==='admin'){state.auth.account!.platformRole='super_admin';state.auth.account!.hasOrganizerAccess=true;}
 if(role==='reviewer')state.auth.account!.hasOrganizerAccess=true;
 if(role==='athlete')state.auth.account!.hasAthleteAccess=true;
 if(role==='club'){state.auth.account!.hasAthleteAccess=true;state.api.mockResolvedValue(owned);}
 view();expect(await nav().findByRole('link',{name:label})).toHaveAttribute('href',href);
 expect(nav().getAllByRole('link').map(link=>link.textContent)).toEqual(['Home','Events','Campaigns',label]);
 if(role==='admin'||role==='reviewer')expect(state.api).not.toHaveBeenCalled();
});
it.each(['/rewards','/rewards/events','/rewards/campaigns','/rewards/wallet','/athlete/rewards','/club/rewards'])('keeps Review on %s for a reviewer',async path=>{
 state.auth.account!.hasOrganizerAccess=true;view(path);expect(nav().getByRole('link',{name:'Review'})).toHaveAttribute('href','/rewards/review');
});
it('does not infer athlete, club or review authority from a sponsor route',async()=>{
 view('/rewards/review');expect(await nav().findByRole('link',{name:'My campaigns'})).toBeVisible();expect(nav().queryByRole('link',{name:'Review'})).not.toBeInTheDocument();
 expect(nav().queryByRole('link',{name:'My rewards'})).not.toBeInTheDocument();expect(nav().queryByRole('link',{name:'Club rewards'})).not.toBeInTheDocument();
});
it('exposes only Profile, Wallet and Sign out in the account menu',async()=>{
 view();fireEvent.click(screen.getByLabelText('Account menu'));
 const menu=within(screen.getByLabelText('Account menu').closest('details')!);
 expect(menu.getAllByRole('link').map(link=>link.textContent)).toEqual(['Profile','Wallet']);
 expect(menu.getByRole('button',{name:'Sign out'})).toBeVisible();expect(screen.getAllByRole('button',{name:'Sign out'})).toHaveLength(1);
 expect(menu.getByRole('link',{name:'Profile'})).toHaveAttribute('href','/rewards/profile');
 fireEvent.click(menu.getByRole('link',{name:'Profile'}));expect(screen.getByLabelText('Account menu').closest('details')).not.toHaveAttribute('open');
});
it('provides the same role link in the separate mobile navigation',async()=>{
 state.auth.account!.hasAthleteAccess=true;view();await nav().findByRole('link',{name:'My rewards'});
 fireEvent.click(screen.getByLabelText('Navigation'));const mobile=within(screen.getByRole('navigation',{name:'Mobile navigation'}));
 expect(mobile.getAllByRole('link').map(link=>link.textContent)).toEqual(['Home','Events','Campaigns','My rewards']);
 fireEvent.click(mobile.getByRole('link',{name:'Events'}));expect(screen.getByLabelText('Navigation').closest('details')).not.toHaveAttribute('open');
});
it.each(['guest','stale'])('withholds private navigation for a %s account',kind=>{
 if(kind==='guest'){state.auth.user=null;state.auth.session=null;state.auth.account=null;}else state.auth.account!.userId='other';
 view('/club/rewards');expect(nav().getAllByRole('link')).toHaveLength(3);expect(state.api).not.toHaveBeenCalled();
 if(kind==='guest'){expect(screen.queryByLabelText('Account menu')).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/auth?next=%2Fclub%2Frewards');}
});
it('fails closed on ownership lookup failure and retries',async()=>{
 state.api.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce(owned);view();
 expect(await screen.findByRole('alert')).toHaveTextContent('Account navigation is temporarily unavailable');expect(nav().getAllByRole('link')).toHaveLength(3);
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(await nav().findByRole('link',{name:'Club rewards'})).toBeVisible();
});
it('retires an old ownership response on an account change',async()=>{
 let resolve!:(value:typeof owned)=>void;state.api.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue(empty);
 const mounted=view();await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(1));
 state.auth.user={id:'next'};state.auth.account={...state.auth.account!,userId:'next'};state.auth.session={access_token:'next-synthetic-token',user:{id:'next'}};
 mounted.rerender(mounted.tree());resolve(owned);expect(await nav().findByRole('link',{name:'My campaigns'})).toBeVisible();expect(nav().queryByRole('link',{name:'Club rewards'})).not.toBeInTheDocument();
});
it('keeps sign-out failure actionable',async()=>{
 state.auth.signOut.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined);view();fireEvent.click(screen.getByLabelText('Account menu'));
 fireEvent.click(screen.getByRole('button',{name:'Sign out'}));expect(await screen.findByRole('alert')).toHaveTextContent('Sign out failed');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Sign out'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await waitFor(()=>expect(state.auth.signOut).toHaveBeenCalledTimes(2));
});
it('uses the same Croatian role and account labels',async()=>{
 state.locale='hr';state.auth.account!.platformRole='super_admin';view();expect(within(screen.getByRole('navigation',{name:'Glavna navigacija'})).getByRole('link',{name:'Administracija'})).toHaveAttribute('href','/rewards/admin/wallets');
 fireEvent.click(screen.getByLabelText('Izbornik računa'));expect(screen.getByRole('link',{name:'Profil'})).toHaveAttribute('href','/rewards/profile');expect(screen.getByRole('link',{name:'Novčanik'})).toHaveAttribute('href','/rewards/wallet');expect(screen.getByRole('button',{name:'Odjava'})).toBeVisible();
});

it('withholds a cached club link when a fresh ownership check fails',async()=>{
 state.api.mockResolvedValueOnce(owned).mockRejectedValueOnce(new Error('unavailable'));
 const mounted=view();expect(await nav().findByRole('link',{name:'Club rewards'})).toBeVisible();
 await mounted.client.invalidateQueries({queryKey:['podium-navigation-clubs']});
 expect(await screen.findByRole('alert')).toHaveTextContent('Account navigation is temporarily unavailable');
 expect(nav().getAllByRole('link')).toHaveLength(3);
});

it.each([false,true])('uses verified non-club ownership for athlete=%s without hiding its workspace',async athlete=>{
 state.auth.account!.hasAthleteAccess=athlete;
 state.api.mockRejectedValue({status:403,code:'reward_club_owner_required'});
 view();expect(await nav().findByRole('link',{name:athlete?'My rewards':'My campaigns'})).toBeVisible();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(nav().queryByRole('link',{name:'Club rewards'})).not.toBeInTheDocument();
});
it.each([{status:401,code:'reward_club_owner_required'},{status:403,code:'reward_account_session_required'},{status:503,code:'reward_club_owner_required'}])('does not treat an unrelated failure as non-ownership: %j',async error=>{
 state.api.mockRejectedValue(error);view();expect(await screen.findByRole('alert')).toHaveTextContent('Account navigation is temporarily unavailable');expect(nav().getAllByRole('link')).toHaveLength(3);
});
