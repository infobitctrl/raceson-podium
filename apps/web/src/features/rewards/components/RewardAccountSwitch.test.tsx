import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import RewardAccountSwitch from './RewardAccountSwitch';
const signOut=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/auth',()=>({useAuth:()=>({signOut})}));
function Location(){const l=useLocation();return <output aria-label="Route">{l.pathname+l.search}</output>;}
function view(){return render(<MemoryRouter initialEntries={['/athlete/rewards?campaign=example#awards']}><RewardAccountSwitch hr={false} label="Sign in with your athlete account"/><Location/></MemoryRouter>);}
beforeEach(()=>signOut.mockReset());
it('switches only after an explicit click and retains the reward destination',async()=>{
 signOut.mockResolvedValue(undefined);view();expect(signOut).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button'));
 await waitFor(()=>expect(screen.getByLabelText('Route')).toHaveTextContent('/auth?next=%2Fathlete%2Frewards%3Fcampaign%3Dexample%23awards'));
 expect(signOut).toHaveBeenCalledOnce();
});
it('keeps the current route when sign-out fails and permits retry',async()=>{
 signOut.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(undefined);view();fireEvent.click(screen.getByRole('button'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
 expect(screen.getByLabelText('Route')).toHaveTextContent('/athlete/rewards?campaign=example');
 fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(signOut).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByLabelText('Route')).toHaveTextContent('/auth?next='));
});
