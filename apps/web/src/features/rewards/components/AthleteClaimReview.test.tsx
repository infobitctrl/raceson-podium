import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import type {SponsorClaim} from '../data/sponsorProgramme';
import AthleteClaimReview from './AthleteClaimReview';

const address=`0x${'ab'.repeat(20)}`,id='73000000-0000-4000-8000-000000000010';
const view:SponsorClaim={schema:'raceson-sponsor-claim-view-v4',claimId:id,approvalId:id,chainId:10143,role:'recipient',current:true,status:'awaiting_consent',sourceStamp:'a'.repeat(64),profileFingerprint:'b'.repeat(64),operatorAddress:`0x${'cd'.repeat(20)}`,address,
 claim:{entitlementId:`0x${'a'.repeat(64)}`,recipient:address,amount:'1000000000000000000',pot:'race',nonce:'0',issuedAt:'1791331200',expiresAt:'1791417600',allocationDigest:`0x${'c'.repeat(64)}`},context:{environment:'monad-testnet',chainId:10143,verifyingContract:`0x${'ee'.repeat(20)}`},signing:{message:{}},transaction:null,receipt:null};
const props={view,hr:false,connected:false,consent:false,busy:false,signing:false,onConsent:vi.fn(),onSign:vi.fn(),signLabel:'Sign reward consent',walletControls:null};
it('requires the exact wallet connection and explicit consent independently of saved ownership proof',()=>{
 const page=render(<AthleteClaimReview {...props}/>);
 expect(screen.getByText('Verified sporting identity')).toBeVisible();expect(screen.getByText('Signature checked')).toBeVisible();
 expect(screen.getByRole('checkbox')).toBeDisabled();expect(screen.getByRole('button',{name:'Sign reward consent'})).toBeDisabled();
 expect(page.container.querySelectorAll('[data-state=complete]')).toHaveLength(2);
 page.rerender(<AthleteClaimReview {...props} connected/>);expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('button',{name:'Sign reward consent'})).toBeDisabled();
 page.rerender(<AthleteClaimReview {...props} connected consent/>);fireEvent.click(screen.getByRole('button',{name:'Sign reward consent'}));expect(props.onSign).toHaveBeenCalledOnce();
 expect(screen.queryByText('Claim reward')).not.toBeInTheDocument();expect(screen.getByText(/controller submits payment/)).toBeVisible();
});
it.each([{current:false,status:'awaiting_consent'},{current:true,status:'held'},{current:true,status:'awaiting_review'}] as const)('does not inherit old readiness or consent for $status, current=$current',state=>{
 const {container}=render(<AthleteClaimReview {...props} view={{...view,...state}} consent connected={false}/>);
 expect(container.querySelectorAll('[data-state=complete]')).toHaveLength(0);expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 expect(screen.queryByText('Verified sporting identity')).not.toBeInTheDocument();expect(screen.queryByText('Wallet control verified')).not.toBeInTheDocument();
});
it('labels the actual authorization expiry without inventing a campaign claim window or sporting category',()=>{
 render(<AthleteClaimReview {...props} connected/>);
 expect(screen.getByTitle('Authorization expires')).toBeVisible();expect(screen.getByText(/ · Zagreb$/)).toBeVisible();
 expect(screen.queryByText(/30 days|Kvarner|Classic 42K/)).not.toBeInTheDocument();expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('a recorded consent or both signatures never becomes a paid receipt',()=>{
 const page=render(<AthleteClaimReview {...props} view={{...view,status:'awaiting_operator',signing:null}}/>);
 expect(screen.getByText('Your signed consent is recorded')).toBeVisible();expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
 page.rerender(<AthleteClaimReview {...props} view={{...view,status:'ready_to_pay',signing:null}}/>);
 expect(screen.getByRole('status')).toHaveTextContent('Payment still needs to be submitted and confirmed');expect(screen.queryByText('Claim confirmed')).not.toBeInTheDocument();
});

it('demo rehearsal preparation never claims verification of the original sporting identity',()=>{
 const {container}=render(<AthleteClaimReview {...props} view={{...view,rehearsalPolicy:'podium-demo-alias-rehearsal-v1'}} connected/>);
 expect(screen.queryByText('Verified sporting identity')).not.toBeInTheDocument();expect(screen.getByText(/original athlete’s identity is not verified/)).toBeVisible();
 expect(container.querySelector('[data-step=identity]')).toHaveAttribute('data-state','waiting');expect(screen.getByText('Signature checked')).toBeVisible();
});
