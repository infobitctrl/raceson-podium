import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewQueue from './HostedReviewQueue';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/hostedReviewSources',()=>({readHostedReviewSources:mocks.read}));
vi.mock('./HostedReviewWorkspace',()=>({default:({campaign,requestedSlot,onBack}:{campaign:{id:string;revision:number};requestedSlot:number|null;onBack:()=>void})=><div>Preview {campaign.id} r{campaign.revision} reviewer<p>Awards {campaign.id} pot {requestedSlot??'default'}</p><button onClick={onBack}>Review queue</button></div>}));
const item={id:'copied',launchId:'retained',revision:2,name:'Copied campaign',budgetWei:'1000000000000000001',executionState:'awaiting_contract',pools:[{slot:4,name:'Sponsored race',budgetWei:'1000000000000000001'}]};
beforeEach(()=>{mocks.read.mockReset();});
it('opens retained contract rules through reviewer authority and preserves every wei',async()=>{
 mocks.read.mockResolvedValue({items:[item]});render(<HostedReviewQueue hr={false}/>);
 await screen.findByRole('button',{name:'Review awards: Copied campaign'});
 expect(screen.getByText('Awaiting contract')).toBeInTheDocument();expect(screen.getByTitle('1.000000000000000001 test MON')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Review awards: Copied campaign'}));expect(screen.getByText('Preview copied r2 reviewer')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Review queue'}));expect(screen.getByRole('button',{name:'Review awards: Copied campaign'})).toBeInTheDocument();
});
it('opens only an authorized requested campaign and retains the selected contract pot',async()=>{
 mocks.read.mockResolvedValue({items:[item]});render(<HostedReviewQueue hr={false} requestedCampaign={item.id} requestedSlot={4}/>);
 await screen.findByText('Preview copied r2 reviewer');expect(screen.getByText('Awards copied pot 4')).toBeInTheDocument();
});
it('a foreign navigation hint cannot select an absent campaign or borrow another campaign',async()=>{
 mocks.read.mockResolvedValue({items:[item]});render(<HostedReviewQueue hr={false} requestedCampaign="foreign" requestedSlot={4}/>);
 await screen.findByText('The requested campaign is not available for review.');expect(screen.queryByText(/Preview copied/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Review awards: Copied campaign'}));expect(screen.getByText('Awards copied pot default')).toBeInTheDocument();
});
it('clears selected private rows during a failed refresh and offers a fresh read',async()=>{
 mocks.read.mockRejectedValue(Error('revoked'));render(<HostedReviewQueue hr={false}/>);
 await screen.findByRole('alert');expect(screen.queryByText('Copied campaign')).not.toBeInTheDocument();
 mocks.read.mockResolvedValue({items:[]});fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await screen.findByText(/No sponsor has continued/);expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('retires a late response after an account-driven unmount',async()=>{
 let resolve!:(value:unknown)=>void;mocks.read.mockReturnValue(new Promise(r=>resolve=r));
 const old=render(<HostedReviewQueue hr={false}/>);old.unmount();resolve({items:[item]});
 await waitFor(()=>expect(screen.queryByText('Copied campaign')).not.toBeInTheDocument());
});

it('shows authorized sponsor details, event artwork and source links without offering owner edits',async()=>{
 const selection={sourceLeagueId:'ba81ced7-b2c5-4d51-95b6-d95d8c04fa36',sourceSeasonId:'323d55fc-a396-4ff4-a17e-eb7152c8f8f1',eventEditionId:null};
 mocks.read.mockResolvedValue({items:[{...item,selection,branding:{id:item.id,name:'Fictional Trail Sponsor',logo:null,website:'https://example.com',promotion:'A finish-line promotion',revision:1}}]});
 render(<HostedReviewQueue hr={false}/>);await screen.findByText('Fictional Trail Sponsor');
 expect(screen.getByRole('link',{name:'Visit sponsor website'})).toHaveAttribute('href','https://example.com');expect(screen.getByText('A finish-line promotion')).toBeVisible();
 expect(screen.getByRole('link',{name:'League on RacesOn'})).toHaveAttribute('href','https://www.raceson.com/leagues/sibenska-trail-liga');
 expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
});
it('shows the owned reviewer wallet and gas readiness even with no campaigns',async()=>{
 const wallet={address:'0x'+'11'.repeat(20),owned:true,balanceWei:'0'};mocks.read.mockResolvedValue({items:[],wallet});render(<HostedReviewQueue hr={false}/>);
 expect(await screen.findByRole('heading',{name:'Your rewards wallet'})).toBeVisible();expect(screen.getByRole('status')).toHaveTextContent('Add test MON');
 expect(screen.queryByRole('button',{name:/controller|hand over/i})).not.toBeInTheDocument();
 mocks.read.mockResolvedValue({items:[],wallet:{...wallet,balanceWei:'5000000000000000000'}});fireEvent.click(screen.getByRole('button',{name:'Refresh wallet balance'}));
 await waitFor(()=>expect(screen.queryByText('Add test MON before publishing awards.')).not.toBeInTheDocument());expect(await screen.findByText(/5 test MON/)).toBeVisible();
});
