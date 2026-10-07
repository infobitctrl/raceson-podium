import {beforeEach,expect,it,vi} from 'vitest';
import {readHostedReviewWorkspace,hostedRecipientTotals} from './hostedReviewWorkspace';
const request=vi.hoisted(()=>vi.fn());vi.mock('@/lib/api',()=>({apiRequest:request}));
const id='7c000000-0000-4000-8000-000000009000';
const group={nodeId:'g',name:'Open',slot:4,type:'athlete_standings',beneficiaryKind:'athlete' as const,budgetWei:'101',proposedWei:'100',heldWei:'0',unusedWei:'1',unallocatedWei:'0',hold:null,awards:[{beneficiaryId:'a',name:'Same alias',place:1,value:'1',amountWei:'100'}]};
const data={version:'podium-copy-allocation-v1',setupId:id,revision:3,budgetWei:'101',proposedWei:'100',heldWei:'0',unusedWei:'1',unallocatedWei:'0',groups:[group],pools:[{slot:4,name:'Sponsored race',budgetWei:'101'}],funding:{state:'unverified',fundedWei:null,remainingWei:null,paidWei:null,returnedWei:null,blockNumber:null,programmeAddress:null,pools:[]}};
beforeEach(()=>request.mockReset());
it('validates the exact saved revision, scope and every wei before showing review',async()=>{
 request.mockResolvedValue(data);expect((await readHostedReviewWorkspace(id,3)).pools.map(p=>p.slot)).toEqual([4]);
 for(const change of [d=>d.revision++,d=>d.groups[0].slot=0,d=>d.pools.push({slot:0,name:'League',budgetWei:'0'}),d=>d.groups[0].awards[0].amountWei='101',d=>d.funding.state='funded']){
  const invalid=structuredClone(data);change(invalid);request.mockResolvedValue(invalid);await expect(readHostedReviewWorkspace(id,3)).rejects.toThrow('invalid_review');
 }
});
it('combines exact category awards by identity without merging aliases or clubs',()=>{
 const totals=hostedRecipientTotals([group,{...group,nodeId:'g2',awards:[{...group.awards[0],amountWei:'7'},{...group.awards[0],beneficiaryId:'b',amountWei:'2'}]},{...group,nodeId:'club',beneficiaryKind:'club'}]);
 expect(totals.find(r=>r.id==='athlete:a')).toMatchObject({amountWei:107n,categories:2});expect(totals.find(r=>r.id==='athlete:b')?.amountWei).toBe(2n);expect(totals.find(r=>r.id==='club:a')?.amountWei).toBe(100n);
});

it('retains exact source evidence and rejects duplicate result identifiers or rounded numeric time',async()=>{
 const row={key:'result1',beneficiaryId:'a',name:'Same alias',club:null,rankOverall:7,rankCategory:1,finishTimeMs:'9007199254740993',status:'finished',points:null};
 const evidence={...data,groups:[{...group,results:[row]}]};request.mockResolvedValue(evidence);
 expect((await readHostedReviewWorkspace(id,3)).groups[0].results[0]).toEqual(row);
 request.mockResolvedValue({...evidence,groups:[{...group,results:[row,row]}]});await expect(readHostedReviewWorkspace(id,3)).rejects.toThrow('invalid_review');
 request.mockResolvedValue({...evidence,groups:[{...group,results:[{...row,finishTimeMs:9007199254740993}]}]});await expect(readHostedReviewWorkspace(id,3)).rejects.toThrow();
});
