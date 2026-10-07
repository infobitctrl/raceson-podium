import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {ClaimDetail} from './SponsorClaims';
const m=vi.hoisted(()=>({claim:vi.fn(),sign:vi.fn()}));
vi.mock('../data/sponsorProgramme',()=>({sponsorClaim:m.claim}));
vi.mock('../data/sponsorProgrammeWallet',()=>({signProgrammeClaim:m.sign}));
vi.mock('./SponsorWallet',()=>({default:()=>null}));
const id='73000000-0000-4000-8000-000000000010';
it('labels rehearsal, omits fabricated age evidence, and requires reviewer acknowledgement without signing',async()=>{
 const view={claimId:id,rehearsalPolicy:'podium-demo-alias-rehearsal-v1',current:true,status:'awaiting_review',address:'0xrecipient',claim:null,signing:null,transaction:null,receipt:null,sourceStamp:'a'.repeat(64),profileFingerprint:'b'.repeat(64)};
 m.claim.mockResolvedValue(view);render(<ClaimDetail id={id} role="operator" hr={false} chainId={10143} reviewerOnly/>);
 const button=await screen.findByRole('button',{name:'Prepare demo claim'});expect(button).toBeDisabled();
 expect(screen.getByRole('note')).toHaveTextContent('does not verify');expect(screen.queryByLabelText('Verified date of birth')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
 await waitFor(()=>expect(m.claim).toHaveBeenCalledWith('operator',id,{action:'prepare',sourceStamp:view.sourceStamp,profileFingerprint:view.profileFingerprint,attestation:{schemaVersion:4,policy:view.rehearsalPolicy,chainId:10143,claimId:id}}));
 expect(m.sign).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Pay exact reward'})).not.toBeInTheDocument();
});
