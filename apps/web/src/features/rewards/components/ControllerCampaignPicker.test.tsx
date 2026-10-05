import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {decodeControllerCampaigns} from '../data/controller';
import ControllerCampaignPicker from './ControllerCampaignPicker';

it('distinguishes identical campaign names and budgets by their complete reference',()=>{
 const ids=['73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002'];
 const campaigns=decodeControllerCampaigns(ids.map(setupId=>({setupId,name:'Same league',pots:[],execution:{
  plan:{version:4,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:1,configurationHash:'a'.repeat(64),chainId:10143,
   funder:'0x'+'11'.repeat(20),operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'33'.repeat(20),
   claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100','0','0','0','0','0'],budgetWei:'100'},deploymentHash:null,fundingHash:null}})));
 const select=vi.fn();
 render(<ControllerCampaignPicker campaigns={campaigns} busy={false} onSelect={select} onRefresh={()=>{}}/>);
 expect(screen.getByRole('button',{name:new RegExp(ids[0])})).toBeVisible();
 expect(screen.getByRole('button',{name:new RegExp(ids[1])})).toBeVisible();
 fireEvent.change(screen.getByRole('textbox',{name:'Find an assigned campaign'}),{target:{value:` ${ids[1].toUpperCase()} `}});
 expect(screen.queryByRole('button',{name:new RegExp(ids[0])})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:new RegExp(ids[1])}));
 expect(select).toHaveBeenCalledExactlyOnceWith(ids[1]);
});
