import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import HostedCopyPreview from './HostedCopyPreview';
const mocks=vi.hoisted(()=>({user:{id:'test-user'} as {id:string}|null,api:vi.fn()}));
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:mocks.user,isLoading:false})}));
vi.mock('@/lib/api',()=>({apiRequest:mocks.api}));
const data=()=>({version:'podium-hosted-copy-preview-v1',state:'unapproved',payableWei:'0',counts:{rounds:5,results:5,finishes:5,unclassifiedFinishes:1},classifications:[{id:'open',name:'Open',competition:'Short'}],tables:[],participation:[{slot:5,heldReason:null,rows:[{athleteId:'a',name:'Races Mon1',finishes:1,distanceMetres:'5432'}]},{slot:3,heldReason:'duplicate',rows:[]}],results:[{id:'r',name:'Races Mon1',club:'Races Club1',competition:'Short',slot:5,status:'finished',finishTimeMs:'3600123',rank:1,classificationIds:['open']}]});
beforeEach(()=>{mocks.user={id:'test-user'};mocks.api.mockReset().mockResolvedValue(data());});
const ui=()=> <MemoryRouter><HostedCopyPreview/></MemoryRouter>;
it('requires ordinary login before fetching results',()=>{
 mocks.user=null;render(ui());expect(screen.getByRole('link',{name:'Sign in to the demo'})).toHaveAttribute('href','/auth?next=%2Frewards%2Fdemo-copy');expect(mocks.api).not.toHaveBeenCalled();
});
it('renders exact time and round-five participation, then shows the round-three review hold',async()=>{
 render(ui());expect(await screen.findByText('5 completed rounds')).toBeVisible();expect(screen.getByText('1:00:00.123')).toBeVisible();expect(screen.getByRole('option',{name:'Short · Open'})).toBeInTheDocument();
 expect(within(screen.getByRole('table',{name:'Unapproved reward standings'})).getByText('5432')).toBeVisible();
 fireEvent.change(screen.getByRole('combobox',{name:'Round'}),{target:{value:'3'}});expect(screen.getByRole('alert')).toHaveTextContent('Both source results are preserved');
});
it('hides loaded private results immediately when the signed-in account changes',async()=>{
 const {rerender}=render(ui());await screen.findByText('1:00:00.123');mocks.user=null;rerender(ui());expect(screen.queryByText('1:00:00.123')).not.toBeInTheDocument();
});
it('does not render an unexpected payable preview',async()=>{
 mocks.api.mockResolvedValue({...data(),payableWei:'1'});render(ui());expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
