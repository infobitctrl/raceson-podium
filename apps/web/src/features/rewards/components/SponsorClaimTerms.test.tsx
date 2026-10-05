import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it} from 'vitest';
import type {SponsorClaim} from '../data/sponsorProgramme';
import SponsorClaimTerms from './SponsorClaimTerms';

it('shows the exact authorization expiry without inventing campaign terms or signing',()=>{
  const view:Pick<SponsorClaim,'claim'|'context'|'signing'|'chainId'>={chainId:10143,
    claim:{entitlementId:'0x1234',recipient:`0x${'11'.repeat(20)}`,amount:'1',pot:'race',nonce:'0',issuedAt:'1800000000',expiresAt:'1800086400',allocationDigest:'0xab'},
    context:{environment:'monad-testnet',chainId:10143,verifyingContract:`0x${'22'.repeat(20)}`},
    signing:{message:{amount:'1',expiresAt:'1800086400'}}};
  render(<SponsorClaimTerms view={view} hr={false}/>);
  fireEvent.click(screen.getByText('Exact claim terms'));
  expect(screen.getByText('Claim authorization expires')).toBeVisible();
  expect(screen.getByText(/separate from the campaign claim window/)).toBeVisible();
  fireEvent.click(screen.getByText('Read the exact message'));
  expect(screen.getByText(/"expiresAt": "1800086400"/)).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
