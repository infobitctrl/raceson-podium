import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactElement} from 'react';
import type {Session} from '@supabase/supabase-js';
import {act,fireEvent,render as rtlRender,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ApiError} from '@/lib/api';
import {CampaignSponsor,CampaignSponsorProvider,CampaignSponsorRecords} from './CampaignSponsor';
const mocks=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),prepare:vi.fn(),auth:{user:{id:'owner'} as {id:string}|null,session:null as Session|null}}));
vi.mock('@/lib/auth',()=>({useAuth:()=>mocks.auth}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:mocks.read,saveCampaignBranding:mocks.save,prepareSponsorLogo:mocks.prepare}));
const id='72000000-0000-4000-8000-000000000003',record={id,name:'Trail sponsor',logo:null,revision:3};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.user={id:'owner'};mocks.auth.session=null;mocks.read.mockResolvedValue([record]);mocks.save.mockResolvedValue({...record,name:'New sponsor',revision:4});});
it('shows saved public identity but no edit control to nonowners',async()=>{
 mocks.read.mockImplementation(async(mine:boolean)=>mine?[]:[record]);render(<CampaignSponsor id={id}/>);
 expect(await screen.findByText('Trail sponsor')).toBeVisible();expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
});
it('keeps public branding visible if the owner-only request fails without granting editing',async()=>{
 mocks.read.mockImplementation((mine:boolean)=>mine?Promise.reject(Error('private unavailable')):Promise.resolve([record]));
 render(<CampaignSponsor id={id} backing="Trail event"/>);
 expect(await screen.findByText('Trail sponsor')).toBeVisible();
 expect(screen.getByText('Trail event')).toBeVisible();
 expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
 expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument();
});
it('retains a neutral sponsor card and backing context on failure, then recovers the saved identity',async()=>{
 mocks.read.mockRejectedValue(Error('unavailable'));
 render(<CampaignSponsor id={id} backing="Trail event"/>);
 expect(await screen.findByRole('button',{name:'Retry sponsor details'})).toBeVisible();
 expect(screen.getByText('Campaign sponsor')).toBeVisible();expect(screen.getByText('Trail event')).toBeVisible();
 expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
 mocks.read.mockImplementation(async(mine:boolean)=>mine?[]:[record]);
 fireEvent.click(screen.getByRole('button',{name:'Retry sponsor details'}));
 expect(await screen.findByText('Trail sponsor')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Retry sponsor details'})).not.toBeInTheDocument();
});
it('owner edits per-campaign name without touching money; save updates display',async()=>{
 render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'New sponsor'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(id,{name:'New sponsor',logo:null,website:null,promotion:null,expectedRevision:3}));
 expect(await screen.findByText('Sponsor details saved')).toBeVisible();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByText('New sponsor')).toBeVisible();
});
it('cancel leaves saved branding intact; failed save retains draft for retry',async()=>{
 render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Unsaved'}});fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(mocks.save).not.toHaveBeenCalled();expect(screen.getByText('Trail sponsor')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Edit sponsor/}));mocks.save.mockRejectedValue(Error('offline'));fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Retry me'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');expect(screen.getByLabelText('Sponsor name')).toHaveValue('Retry me');
});
it('uploads preview, removes logo, and preserves name on invalid file',async()=>{
 mocks.prepare.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));fireEvent.change(screen.getByLabelText('Upload logo or image'),{target:{files:[new File(['test'],'logo.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Remove image'}));expect(screen.queryByRole('button',{name:'Remove image'})).not.toBeInTheDocument();
 mocks.prepare.mockRejectedValue(Error('invalid'));fireEvent.change(screen.getByLabelText('Upload logo or image'),{target:{files:[new File(['test'],'evil.svg',{type:'image/svg+xml'})]}});expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG');expect(screen.getByLabelText('Sponsor name')).toHaveValue('Trail sponsor');
});

it('saves the prepared logo and uses the confirmed response',async()=>{
 const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
 mocks.prepare.mockResolvedValue(logo);mocks.save.mockResolvedValue({...record,logo,revision:4});
 render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 fireEvent.change(screen.getByLabelText('Upload logo or image'),{target:{files:[new File(['test'],'logo.png',{type:'image/png'})]}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save sponsor'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(id,{name:record.name,logo,website:null,promotion:null,expectedRevision:3}));
 expect(await screen.findByText('Sponsor details saved')).toBeVisible();
});
it('conflict reloads server details without losing the draft or claiming success',async()=>{
 mocks.save.mockRejectedValue(new ApiError('Conflict',{status:409}));
 render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'My edit'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('another window');expect(screen.getByLabelText('Sponsor name')).toHaveValue('My edit');expect(screen.queryByText('Sponsor details saved')).not.toBeInTheDocument();
 await waitFor(()=>expect(mocks.read.mock.calls.length).toBeGreaterThanOrEqual(4));
});
it('shows saved website and plain promotion publicly and keeps them when editing',async()=>{
 const promotion='Trail offer\n<script>plain text</script>',website='example.com/trail';
 mocks.read.mockResolvedValue([{...record,website,promotion}]);mocks.save.mockResolvedValue({...record,website,promotion,revision:4});
 render(<CampaignSponsor id={id}/>);
 const link=await screen.findByRole('link',{name:'Visit sponsor website'});expect(link).toHaveAttribute('href','https://example.com/trail');expect(link).toHaveAttribute('rel','noopener noreferrer');
 expect(screen.getByText(/<script>plain text<\/script>/)).toBeVisible();expect(document.querySelector('script')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Edit sponsor/}));expect(screen.getByLabelText('Website')).toHaveValue(website);expect(screen.getByLabelText('Website')).toHaveAttribute('type','text');expect(screen.getByLabelText('Website')).toHaveAttribute('spellcheck','false');expect(screen.getByLabelText('About your promotion')).toHaveValue(promotion);
 fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(id,{name:record.name,logo:null,website,promotion,expectedRevision:3}));
});

it('renders non-web website text without an executable link',async()=>{
 mocks.read.mockResolvedValue([{...record,website:'javascript:alert(1)'}]);render(<CampaignSponsor id={id}/>);
 expect(await screen.findByText('javascript:alert(1)')).toBeVisible();expect(screen.queryByRole('link',{name:'Visit sponsor website'})).not.toBeInTheDocument();
});

function render(ui:ReactElement){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const tree=(content:ReactElement)=><QueryClientProvider client={client}>{content}</QueryClientProvider>;
 const view=rtlRender(tree(ui));return {...view,client,rerender:(content:ReactElement)=>view.rerender(tree(content))};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function session(label:string):Session{return {access_token:`synthetic-${label}-access`,refresh_token:`synthetic-${label}-refresh`,expires_at:2000000000,expires_in:3600,token_type:'bearer',user:{id:'owner'}} as Session;}

it('deduplicates public reads across independent providers and reuses them on navigation',async()=>{
 mocks.auth.user=null;
 const publicRead=deferred<typeof record[]>();mocks.read.mockReturnValue(publicRead.promise);
 const view=render(<><CampaignSponsor id={id}/><CampaignSponsor id={id}/></>);
 expect(mocks.read).toHaveBeenCalledTimes(1);
 await act(async()=>publicRead.resolve([record]));
 await waitFor(()=>expect(screen.getAllByText('Trail sponsor')).toHaveLength(2));
 view.rerender(<span>Other route</span>);view.rerender(<CampaignSponsor id={id}/>);
 expect(await screen.findByText('Trail sponsor')).toBeVisible();expect(mocks.read).toHaveBeenCalledTimes(1);
});
it('shares owner reads and saved details across nested campaign sections',async()=>{
 render(<CampaignSponsorProvider><CampaignSponsorProvider><CampaignSponsor id={id}/></CampaignSponsorProvider><CampaignSponsorProvider><CampaignSponsor id={id}/></CampaignSponsorProvider></CampaignSponsorProvider>);
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/Edit sponsor/})).toHaveLength(2));
 expect(mocks.read.mock.calls.filter(([mine])=>mine)).toHaveLength(1);
 expect(mocks.read.mock.calls.filter(([mine])=>!mine)).toHaveLength(1);
 fireEvent.click(screen.getAllByRole('button',{name:/Edit sponsor/})[0]);
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'New sponsor'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 await waitFor(()=>expect(screen.getAllByText('New sponsor')).toHaveLength(2));
});
it('keeps review records read-only without starting public or owner requests',()=>{
 render(<CampaignSponsorRecords records={[record]}><CampaignSponsorProvider><CampaignSponsor id={id}/></CampaignSponsorProvider></CampaignSponsorRecords>);
 expect(screen.getByText('Trail sponsor')).toBeVisible();expect(mocks.read).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
});
it('ignores a retired owner response after an account switch',async()=>{
 const oldRead=deferred<typeof record[]>(),newRead=deferred<typeof record[]>();
 mocks.read.mockImplementation((mine=false)=>!mine?Promise.resolve([record]):mocks.auth.user?.id==='owner'?oldRead.promise:newRead.promise);
 const view=render(<CampaignSponsor id={id}/>);expect(await screen.findByText('Trail sponsor')).toBeVisible();
 mocks.auth.user={id:'another-owner'};view.rerender(<CampaignSponsor id={id}/>);
 await act(async()=>oldRead.resolve([{...record,name:'Retired private draft'}]));
 expect(screen.queryByText('Retired private draft')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
 await act(async()=>newRead.resolve([]));expect(screen.getByText('Trail sponsor')).toBeVisible();
 expect(mocks.read.mock.calls.filter(([mine])=>!mine)).toHaveLength(1);
});
it.each(['logout','rotation'])('retires owner-only details and an open editor on %s',async(change)=>{
 mocks.auth.session=session('first');mocks.read.mockImplementation(async(mine=false)=>mine?[{...record,name:'Private draft'}]:[]);
 const view=render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 const nextRead=deferred<typeof record[]>();mocks.read.mockImplementation((mine=false)=>mine?nextRead.promise:Promise.resolve([]));
 if(change==='logout'){mocks.auth.user=null;mocks.auth.session=null;}else mocks.auth.session=session('second');
 view.rerender(<CampaignSponsor id={id}/>);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByText('Private draft')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
 expect(view.client.getQueryData(['podium-public-branding'])).toEqual([]);
 await act(async()=>nextRead.resolve([]));
});
it('does not let a late save repopulate public branding after logout',async()=>{
 const saved=deferred<typeof record>();mocks.save.mockReturnValue(saved.promise);
 const view=render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'Late name'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 mocks.auth.user=null;view.rerender(<CampaignSponsor id={id}/>);
 await act(async()=>saved.resolve({...record,name:'Late name',revision:4}));
 expect(screen.getByText('Trail sponsor')).toBeVisible();expect(screen.queryByText('Late name')).not.toBeInTheDocument();expect(view.client.getQueryData(['podium-public-branding'])).toEqual([record]);
});
it('never adds an unpublished owner record to the public cache after saving',async()=>{
 mocks.read.mockImplementation(async(mine=false)=>mine?[record]:[]);
 const view=render(<CampaignSponsor id={id}/>);fireEvent.click(await screen.findByRole('button',{name:/Edit sponsor/}));
 fireEvent.change(screen.getByLabelText('Sponsor name'),{target:{value:'New sponsor'}});fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));
 expect(await screen.findByText('New sponsor')).toBeVisible();expect(view.client.getQueryData(['podium-public-branding'])).toEqual([]);
 mocks.auth.user=null;view.rerender(<CampaignSponsor id={id}/>);
 expect(screen.queryByText('New sponsor')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Edit sponsor/})).not.toBeInTheDocument();
});
