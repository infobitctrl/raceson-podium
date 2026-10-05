import {I18nProvider} from "@/shared/i18n/I18nProvider";
import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import ControllerWorkflow from './ControllerWorkflow';
import type {ControllerAllocation} from '../data/controller';

it.each([
 {state:3,paid:'0',paused:false,time:'10',title:'Claims open',unclaimed:'1'},
 {state:3,paid:'400000000000000000',paused:false,time:'10',title:'Claims open',unclaimed:'0.6'},
 {state:3,paid:'1000000000000000000',paused:false,time:'10',title:'All rewards claimed',unclaimed:'0'},
 {state:3,paid:'0',paused:true,time:'30',title:'Claims paused',unclaimed:'1'},
 {state:3,paid:'0',paused:false,time:'30',title:'Claim window ended',unclaimed:'1'},
 {state:4,paid:'400000000000000000',paused:false,time:'30',title:'Claims closed',unclaimed:'0.6'},
])('shows $title with actual paid/unclaimed totals, not another signature',({state,paid,paused,time,title,unclaimed})=>{
 const allocation={current:true,pot:{state,paidWei:paid,allocatedWei:'1000000000000000000',paused,claimDeadline:'20'},observedBlock:{timestamp:time}} as ControllerAllocation;
 render(<ControllerWorkflow allocation={allocation} ready hasApproval loading={false} reviewHref="#"><button>Sign again</button></ControllerWorkflow>);
 expect(screen.getByRole('heading',{name:title})).toBeVisible();
 expect(screen.getByText('Paid to recipients').nextElementSibling).toHaveTextContent(`${Number(BigInt(paid))/1e18} test MON`);
 expect(screen.getByText('Unclaimed awards').nextElementSibling).toHaveTextContent(`${unclaimed} test MON`);
 expect(screen.queryByRole('button',{name:'Sign again'})).not.toBeInTheDocument();
});
it('does not claim completion or show signing controls for a cancelled pot',()=>{
 const allocation={current:true,pot:{state:5,paidWei:'0',allocatedWei:'0',paused:false}} as ControllerAllocation;
 render(<ControllerWorkflow allocation={allocation} ready hasApproval loading={false} reviewHref="#"><button>Sign again</button></ControllerWorkflow>);
 expect(screen.getByRole('status')).toHaveTextContent('reward pot was cancelled');
 expect(screen.queryByRole('button',{name:'Sign again'})).not.toBeInTheDocument();
 expect(screen.queryByText('Paid to recipients')).not.toBeInTheDocument();
});

it('Croatian closed claims keep truthful totals without a signing action',()=>{
 const allocation={current:true,pot:{state:4,paidWei:'400000000000000000',allocatedWei:'1000000000000000000',paused:false,claimDeadline:'20'},observedBlock:{timestamp:'30'}} as ControllerAllocation;
 render(<I18nProvider initialLocale="hr"><ControllerWorkflow allocation={allocation} ready hasApproval loading={false} reviewHref="#"><button>Potpiši ponovno</button></ControllerWorkflow></I18nProvider>);
 expect(screen.getByRole('heading',{name:'Preuzimanje zatvoreno'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Potpiši ponovno'})).not.toBeInTheDocument();
 expect(screen.getByText('Isplaćeno primateljima').nextElementSibling).toHaveTextContent('0,4 testni MON');
});
