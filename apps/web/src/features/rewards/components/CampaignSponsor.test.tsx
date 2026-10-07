import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {ApiError} from '@/lib/api';
import {CampaignSponsor} from './CampaignSponsor';
const mocks=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),prepare:vi.fn(),auth:{user:{id:'owner'},session:null}}));
vi.mock('@/lib/auth',()=>({useAuth:()=>mocks.auth}));
vi.mock('../data/campaignBranding',()=>({readCampaignBranding:mocks.read,saveCampaignBranding:mocks.save,prepareSponsorLogo:mocks.prepare}));
const id='72000000-0000-4000-8000-000000000003',record={id,name:'Trail sponsor',logo:null,revision:3};
beforeEach(()=>{vi.clearAllMocks();mocks.read.mockResolvedValue([record]);mocks.save.mockResolvedValue({...record,name:'New sponsor',revision:4});});
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
 const promotion='Trail offer\n<script>plain text</script>',website='https://example.com/trail';
 mocks.read.mockResolvedValue([{...record,website,promotion}]);mocks.save.mockResolvedValue({...record,website,promotion,revision:4});
 render(<CampaignSponsor id={id}/>);
 const link=await screen.findByRole('link',{name:'Visit sponsor website'});expect(link).toHaveAttribute('href',website);expect(link).toHaveAttribute('rel','noopener noreferrer');
 expect(screen.getByText(/<script>plain text<\/script>/)).toBeVisible();expect(document.querySelector('script')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Edit sponsor/}));expect(screen.getByLabelText('Website')).toHaveValue(website);expect(screen.getByLabelText('About your promotion')).toHaveValue(promotion);
 fireEvent.click(screen.getByRole('button',{name:'Save sponsor'}));await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith(id,{name:record.name,logo:null,website,promotion,expectedRevision:3}));
});
