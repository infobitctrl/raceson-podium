import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
vi.mock('@/lib/auth',()=>({useAuth:()=>({user:null,session:null})}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:async()=>[]}));
import type {DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import PodiumCampaigns from './PodiumCampaigns';
const item=(name:string,finished=false,paid=false):DirectoryCampaign=>({campaign:{id:name,name,chainId:10143,budgetWei:'1000000000000000000',address:`0x${'11'.repeat(20)}`,fundingHash:`0x${'aa'.repeat(32)}`,blockNumber:'100',blockTimestamp:'1800000000',pots:[{slot:0,name:'League',amountWei:'1000000000000000000',allocatedWei:'1000000000000000000',paidWei:paid?'1000000000000000000':'0',remainingWei:finished||paid?'0':'1000000000000000000',returnedWei:finished&&!paid?'1000000000000000000':'0',state:finished?4:1,paused:false,claimDeadline:'0',groups:[]}]},verified:true,publishedAt:'2026-09-28T10:00:00Z',selection:null});
function Location(){return <output aria-label="URL query">{useLocation().search}</output>;}
const params=()=>new URLSearchParams(screen.getByLabelText('URL query').textContent!);
function view(query:string,options:{compact?:boolean;history?:boolean;hr?:boolean;directory?:boolean}={}){
 return render(<I18nProvider initialLocale={options.hr?'hr':'en'}><MemoryRouter initialEntries={['/rewards?'+query]}><Location/><PodiumCampaigns items={[item('Active league'),item('Finished league',true,true)]} compact={options.compact} history={options.history} directory={options.directory}/></MemoryRouter></I18nProvider>);
}
it.each([false,true])('clears unmatched search while preserving list choices and focus (compact %s)',compact=>{
 view('q=missing&status=active&sort=funded&order=asc&view=list&page=3&history-q=kept&history-page=2',{compact});
 expect(screen.getByRole('heading',{name:'No matching campaigns'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Explore events'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 expect(screen.getByRole('textbox',{name:'Search campaigns'})).toHaveFocus();
 expect(screen.getByRole('textbox')).toHaveValue('');
 expect(params().has('q')).toBe(false);expect(params().has('page')).toBe(false);
 expect(Object.fromEntries(params())).toEqual({status:'active',sort:'funded',order:'asc',view:'list','history-q':'kept','history-page':'2'});
 expect(screen.getByRole('link',{name:'Active league'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Finished league'})).not.toBeInTheDocument();
 if(compact)expect(screen.getByRole('combobox',{name:'Sort campaigns'})).toHaveValue('funded:asc');
 else expect(screen.getByRole('columnheader',{name:'Funded'})).toHaveAttribute('aria-sort','ascending');
});
it('preserves finished selection when clearing search',()=>{
 view('q=missing&status=finished&view=list');fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 expect(screen.getByRole('button',{name:'Finished',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('link',{name:'Finished league'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Active league'})).not.toBeInTheDocument();
});
it('recovers a filtered history link independently of the main campaign search',()=>{
 view('q=keep-main&page=4&history-q=missing&history-page=3&history-sort=paid&history-order=desc',{history:true});
 expect(screen.getByRole('heading',{name:'No matching distributions'})).toBeVisible();
 expect(screen.queryByText('No recipient payments are confirmed in the published campaigns yet.')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 const region=screen.getByRole('region',{name:'Past distributions'});expect(region).toHaveFocus();
 expect(within(region).getByRole('link',{name:'Finished league'})).toBeVisible();
 expect(Object.fromEntries(params())).toEqual({q:'keep-main',page:'4','history-sort':'paid','history-order':'desc'});
});
it('localizes empty search recovery',()=>{
 view('q=missing',{hr:true});expect(screen.getByText(/Pokušajte s drugim nazivom/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Očisti pretragu'}));
 expect(screen.getByRole('textbox',{name:'Pretraži kampanje'})).toHaveFocus();
});
it('opens the public directory as cards and preserves filters when switching layout',()=>{
 view('sort=funded&order=asc',{directory:true});
 expect(screen.getByRole('button',{name:'Grid view'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('link',{name:'View campaign'})).toHaveAttribute('href','/rewards/campaigns/Active league/public');
 expect(screen.getByText('Returned')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'List view'}));
 expect(screen.getByRole('button',{name:'List view'})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('table')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Active league'})).toBeVisible();
 expect(Object.fromEntries(params())).toEqual({sort:'funded',order:'asc',view:'list'});
 fireEvent.change(screen.getByRole('textbox',{name:'Search campaigns'}),{target:{value:'missing'}});
 expect(screen.getByRole('heading',{name:'No matching campaigns'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
 expect(screen.getByRole('textbox',{name:'Search campaigns'})).toHaveFocus();
 expect(params().get('view')).toBe('list');
});
it('honors a finished-list link in the directory and keeps the public destination',()=>{
 view('status=finished&view=list',{directory:true});
 expect(screen.getByRole('button',{name:'List view'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('link',{name:'View campaign'})).toHaveAttribute('href','/rewards/campaigns/Finished league/public');
 expect(screen.queryByRole('link',{name:'Active league'})).not.toBeInTheDocument();
});
it('does not show unavailable payment observations as zero on directory cards',()=>{
 render(<I18nProvider initialLocale="en"><MemoryRouter><PodiumCampaigns directory items={[{...item('Unknown campaign'),verified:false}]}/></MemoryRouter></I18nProvider>);
 expect(screen.getByText('Status unavailable')).toBeVisible();
 for(const label of ['Paid','Returned'])expect(screen.getByText(label).nextElementSibling).toHaveTextContent('—');
});
