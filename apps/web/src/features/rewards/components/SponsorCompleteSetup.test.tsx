import {act,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import SponsorCompleteSetup from './SponsorCompleteSetup';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../data/publicCampaign',()=>({completeSponsorSetup:api,publicCampaignPath:(id:string)=>`/rewards/campaigns/${id}/public`}));
afterEach(()=>{vi.unstubAllGlobals();api.mockReset();});
it('completes once, prevents double clicks and opens the campaign public page',async()=>{
 let finish!:(value:unknown)=>void;api.mockImplementation(()=>new Promise(resolve=>finish=resolve));
 const assign=vi.fn();vi.stubGlobal('location',{assign});
 render(<SponsorCompleteSetup id="campaign" hr={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Complete setup'}));
 expect(screen.getByRole('button',{name:'Completing setup…'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Completing setup…'}));expect(api).toHaveBeenCalledTimes(1);expect(assign).not.toHaveBeenCalled();
 await act(async()=>finish({}));expect(assign).toHaveBeenCalledWith('/rewards/campaigns/campaign/public');
});
it('keeps the confirmed deposit intact and allows retry after completion fails',async()=>{
 api.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({});const assign=vi.fn();vi.stubGlobal('location',{assign});
 render(<SponsorCompleteSetup id="campaign" hr={false}/>);fireEvent.click(screen.getByRole('button',{name:'Complete setup'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('your confirmed deposit is still saved');expect(assign).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Complete setup'}));await act(async()=>{});expect(assign).toHaveBeenCalledTimes(1);
});

it('opens an already published campaign without publishing it again',()=>{
 render(<SponsorCompleteSetup id="campaign" hr={false} published/>);
 expect(screen.getByRole('link',{name:'View public campaign'})).toHaveAttribute('href','/rewards/campaigns/campaign/public');
 expect(screen.queryByRole('button',{name:'Complete setup'})).not.toBeInTheDocument();
 expect(api).not.toHaveBeenCalled();
});
