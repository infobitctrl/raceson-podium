import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import HostedReviewWorkspace from './HostedReviewWorkspace';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/hostedReviewWorkspace',async original=>({...await original<typeof import('../data/hostedReviewWorkspace')>(),readHostedReviewWorkspace:mocks.read}));
vi.mock('./HostedAwardReview',()=>({default:({slot}:{slot:number})=><p>Review slot {slot}</p>}));
const group=(id:string,name:string,amount:string)=>({nodeId:id,name,slot:4,type:'athlete_standings',beneficiaryKind:'athlete',budgetWei:amount,proposedWei:amount,heldWei:'0',unusedWei:'0',unallocatedWei:'0',hold:null,awards:[{beneficiaryId:'runner',name:'Races Mon1',place:1,value:'1',amountWei:amount}]});
const data={setupId:'campaign',revision:3,pools:[{slot:4,name:'Vrpolje Trail',budgetWei:'1000000000000000000'}],groups:[group('mala','Mala · Overall men','400000000000000000'),group('velika','Velika · Overall men','600000000000000000')],funding:{state:'funded',blockNumber:'123',programmeAddress:'0x'+'a'.repeat(40),pools:[{slot:4,remainingWei:'1000000000000000000',paidWei:'0',returnedWei:'0'}]}};
const props={campaign:{id:'campaign',name:'Test Vrpolje',revision:3},hr:false,requestedSlot:null,onBack:vi.fn()};
beforeEach(()=>mocks.read.mockReset());
it('shows only the sponsored race and its categories, without league/other-round choices',async()=>{
 mocks.read.mockResolvedValue(data);render(<HostedReviewWorkspace {...props}/>);
 await screen.findByRole('heading',{name:'Test Vrpolje'});expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
 expect(screen.getByText('Review slot 4')).toBeInTheDocument();expect(screen.getByRole('table',{name:'Mala · Overall men'})).toBeInTheDocument();expect(screen.getByRole('table',{name:'Velika · Overall men'})).toBeInTheDocument();
 expect(screen.queryByText(/League|Round [1-5]/)).not.toBeInTheDocument();
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Recipient totals'}),{button:0,ctrlKey:false});
 const table=screen.getByRole('table');expect(within(table).getAllByText('Races Mon1')).toHaveLength(1);expect(within(table).getByText('2')).toBeInTheDocument();expect(within(table).getByTitle('1 test MON')).toBeInTheDocument();
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Funding'}),{button:0,ctrlKey:false});expect(screen.getByRole('heading',{name:'Prize funding'})).toBeInTheDocument();expect(screen.getByText('Paid to recipients')).toBeInTheDocument();
});
it('rejects an unfunded URL slot and opens the actual sponsored scope',async()=>{
 mocks.read.mockResolvedValue(data);render(<HostedReviewWorkspace {...props} requestedSlot={0}/>);
 await screen.findByText(/requested prize pool is not sponsored/);expect(screen.getByText('Review slot 4')).toBeInTheDocument();expect(screen.queryByText('Review slot 0')).not.toBeInTheDocument();
});
it('allows switching between multiple sponsored pools only',async()=>{
 mocks.read.mockResolvedValue({...data,pools:[...data.pools,{slot:5,name:'Finale',budgetWei:'1'}]});render(<HostedReviewWorkspace {...props}/>);
 const select=await screen.findByRole('combobox',{name:'Sponsored event'});expect(within(select).getAllByRole('option').map(o=>o.textContent)).toEqual(['Vrpolje Trail','Finale']);
 fireEvent.change(select,{target:{value:'5'}});expect(screen.getByText('Review slot 5')).toBeInTheDocument();expect(screen.queryByText('Mala · Overall men')).not.toBeInTheDocument();
});
it('retires private rows on refresh failure and ignores responses after unmount',async()=>{
 mocks.read.mockResolvedValueOnce(data).mockRejectedValueOnce(Error('revoked'));const ui=render(<HostedReviewWorkspace {...props}/>);
 await screen.findByText('Review slot 4');fireEvent.click(screen.getByRole('button',{name:'Refresh review'}));await screen.findByRole('alert');expect(screen.queryByText('Review slot 4')).not.toBeInTheDocument();ui.unmount();
 let resolve!:(v:unknown)=>void;mocks.read.mockReturnValue(new Promise(r=>resolve=r));const pending=render(<HostedReviewWorkspace {...props}/>);pending.unmount();resolve(data);await waitFor(()=>expect(screen.queryByText('Races Mon1')).not.toBeInTheDocument());
});

it('shows full category evidence beside awards, preserving tied official ranks and exact times',async()=>{
 const first={...data.groups[0],classification:{trackId:'mala',trackName:'Mala',categoryName:'Overall men'},results:[
  {key:'result1',beneficiaryId:'runner',name:'Races Mon1',club:'Races Club1',rankOverall:7,rankCategory:1,finishTimeMs:'3723123',status:'finished',points:null},
  {key:'result2',beneficiaryId:'runner2',name:'Races Mon2',club:null,rankOverall:7,rankCategory:1,finishTimeMs:'3723123',status:'finished',points:null},
  {key:'result3',beneficiaryId:'runner3',name:'Races Mon3',club:null,rankOverall:null,rankCategory:null,finishTimeMs:null,status:'dnf',points:null}]};
 mocks.read.mockResolvedValue({...data,groups:[first]});render(<HostedReviewWorkspace {...props}/>);
 const table=await screen.findByRole('table',{name:'Mala · Overall men'});
 expect(within(table).getByRole('columnheader',{name:'Overall rank'})).toBeInTheDocument();
 expect(within(table).getByRole('columnheader',{name:'Category rank'})).toBeInTheDocument();
 expect(within(table).getByRole('columnheader',{name:'Category'})).toBeInTheDocument();
 expect(within(table).getAllByText('01:02:03.123')).toHaveLength(2);expect(within(table).getAllByText('7')).toHaveLength(2);
 expect(within(table).getByText('Races Club1')).toBeInTheDocument();expect(within(table).getByText('DNF')).toBeInTheDocument();
 expect(within(table).getAllByTitle('0 test MON')).toHaveLength(2);
});
it('uses league points rather than a fabricated finish time',async()=>{
 mocks.read.mockResolvedValue({...data,pools:[{slot:0,name:'League',budgetWei:'1'}],groups:[{...data.groups[0],slot:0,results:[{key:'standing1',beneficiaryId:'runner',name:'Races Mon1',club:null,rankOverall:null,rankCategory:2,finishTimeMs:null,status:'standing',points:417}]}]});
 render(<HostedReviewWorkspace {...props}/>);const table=await screen.findByRole('table',{name:'Mala · Overall men'});
 expect(within(table).getByText('417')).toBeInTheDocument();expect(within(table).getByRole('columnheader',{name:'Points'})).toBeInTheDocument();
 expect(within(table).queryByRole('columnheader',{name:'Exact finish time'})).not.toBeInTheDocument();
});
