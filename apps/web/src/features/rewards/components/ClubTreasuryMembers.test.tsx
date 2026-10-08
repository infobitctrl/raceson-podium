import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import ClubTreasuryMembers from './ClubTreasuryMembers';
const m=vi.hoisted(()=>({read:vi.fn()}));vi.mock('../data/clubSafeCreation',()=>({clubCreationMembers:m.read}));
const rows=[1,2,3,4].map(n=>({memberId:String(n),name:`Member ${n}`,address:n===4?null:'0x'+String(n).repeat(40),status:n===4?'setup_needed':'ready'}));
beforeEach(()=>{vi.clearAllMocks();m.read.mockResolvedValue({clubId:'one',items:rows,nextCursor:null});});afterEach(cleanup);
it('selects people, limits the quorum to three and explains missing wallet setup',async()=>{
 const change=vi.fn();render(<ClubTreasuryMembers clubId="one" disabled={false} onChange={change}/>);
 fireEvent.click(await screen.findByLabelText('Select Member 4'));expect(screen.getByText(/Each selected member needs to sign in/)).toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Select Member 1'));fireEvent.click(screen.getByLabelText('Select Member 2'));expect(screen.getByLabelText('Select Member 3')).toBeDisabled();
 expect(change.mock.calls.at(-1)?.[0]).toHaveLength(3);fireEvent.change(screen.getByLabelText('Search club members'),{target:{value:'Member 2'}});expect(screen.queryByLabelText('Select Member 1')).not.toBeInTheDocument();
});
it('refresh retires readiness and failures cannot retain ready selections',async()=>{
 const change=vi.fn();render(<ClubTreasuryMembers clubId="one" disabled={false} onChange={change}/>);fireEvent.click(await screen.findByLabelText('Select Member 1'));
 m.read.mockRejectedValue(Error('offline'));fireEvent.click(screen.getByRole('button',{name:'Refresh wallets'}));await screen.findByRole('alert');expect(change.mock.calls.at(-1)?.[0]).toEqual([]);expect(screen.queryByLabelText('Select Member 1')).not.toBeInTheDocument();
});
it('ignores late member results from another club',async()=>{
 let finish:(v:unknown)=>void=()=>{};m.read.mockImplementation((club:string)=>club==='one'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({clubId:'two',items:[{...rows[0],name:'Other member'}],nextCursor:null}));
 const change=vi.fn(),v=render(<ClubTreasuryMembers clubId="one" disabled={false} onChange={change}/>);v.rerender(<ClubTreasuryMembers clubId="two" disabled={false} onChange={change}/>);await screen.findByLabelText('Select Other member');finish({clubId:'one',items:rows,nextCursor:null});await waitFor(()=>expect(screen.queryByLabelText('Select Member 1')).not.toBeInTheDocument());
});
