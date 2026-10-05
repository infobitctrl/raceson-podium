import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {RewardEmbeddedWalletContext} from '../components/RewardEmbeddedWalletContext';
import RewardWalletSettings from './RewardWalletSettings';
const mocks=vi.hoisted(()=>({signedIn:true,role:'athlete',accountId:'person',hosted:false,profile:null as string|null}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({isLoading:false,user:mocks.signedIn?{id:'person'}:null,session:mocks.signedIn?{access_token:'test-only'}:null,account:{userId:mocks.accountId,platformRole:mocks.role,primaryAthleteProfileId:mocks.profile}})}));
vi.mock('@/lib/public-env',()=>({publicEnv:{get hostedOperations(){return mocks.hosted;}}}));
vi.mock('../components/HostedAthleteDestination',()=>({default:({profileId}:{profileId:string})=><p>Destination profile {profileId}</p>}));
vi.mock('@/shared/i18n/I18nContext',()=>({useI18n:()=>({locale:'en'})}));
beforeEach(()=>{mocks.signedIn=true;mocks.role='athlete';mocks.accountId='person';mocks.hosted=false;mocks.profile=null;});
it('requires a matching signed-in account before exposing wallet setup',()=>{
 mocks.signedIn=false;render(<MemoryRouter><RewardWalletSettings/></MemoryRouter>);
 expect(screen.getByRole('link',{name:'Sign in'})).toHaveAttribute('href','/auth?next=%2Frewards%2Fwallet');expect(screen.queryByRole('button',{name:/Privy/})).not.toBeInTheDocument();
});
it('uses the matching signed-in profile for hosted destination setup and retires it on account mismatch',()=>{
 mocks.hosted=true;mocks.profile='linked-athlete';const view=render(<MemoryRouter><RewardWalletSettings/></MemoryRouter>);
 expect(screen.getByText('Destination profile linked-athlete')).toBeVisible();
 mocks.accountId='different-person';view.rerender(<MemoryRouter><RewardWalletSettings/></MemoryRouter>);
 expect(screen.queryByText('Destination profile linked-athlete')).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Sign in'})).toBeVisible();
});
it.each(['athlete','sponsor','organizer','super_admin'])('allows explicit personal creation for %s without assigning a role wallet',(role)=>{
 mocks.role=role;const create=vi.fn().mockResolvedValue(undefined);
 render(<MemoryRouter><RewardEmbeddedWalletContext.Provider value={{status:'ready',wallet:null,create}}><RewardWalletSettings/></RewardEmbeddedWalletContext.Provider></MemoryRouter>);
 expect(create).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Create my Privy wallet'}));expect(create).toHaveBeenCalledOnce();expect(screen.getByText(/does not grant a new role/)).toBeVisible();
});
