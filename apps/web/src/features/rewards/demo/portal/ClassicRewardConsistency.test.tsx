import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Link } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n/I18nProvider';
import ProgrammeAthleteAllocationsV3 from '../../components/ProgrammeAthleteAllocationsV3';
import ClassicRewardFrame from './ClassicRewardFrame';
import { presentationLink } from './portalLinks';
import { award, claim, payment, state } from '../../../../../../../demo/rewards/portal-acceptance/fixture';
vi.mock('@/lib/api', () => import('../../../../../../../demo/rewards/portal-acceptance/fixture'));
vi.mock('@/lib/public-env', () => import('../../../../../../../demo/rewards/portal-acceptance/fixture'));
const noop = () => {};
function mount() {
  window.history.replaceState({}, '', `/athlete/rewards?draft=${award.draftId}&claim=${claim.claimId}`);
  return render(<I18nProvider initialLocale="en"><BrowserRouter><Link to={presentationLink(window.location.pathname, window.location.search, window.location.hash, true)}>Open classic demo</Link><ClassicRewardFrame>
    <ProgrammeAthleteAllocationsV3 items={[award]} claims={[claim]} claimsComplete pending={false}
      onRefresh={noop} onAccessLost={noop} />
  </ClassicRewardFrame></BrowserRouter></I18nProvider>);
}
beforeEach(() => { state.reads = []; state.writes = 0; state.unavailable = false; });
describe('real shared reward components across classic and standalone compositions', () => {
  it('retains exact amount and opened verified receipt; paid claim cannot request consent in either mode', async () => {
    mount(); await screen.findByText('Paid');
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByText('Exact amount', { exact: true }));
    fireEvent.click(screen.getByText('Reward payment status', { selector: 'summary' }));
    if (!screen.getByText('Claim history (1)', { exact: true }).closest("details")!.open) fireEvent.click(screen.getByText('Claim history (1)', { exact: true }));
    const reads = state.reads.length;
    for (const mode of ['Open classic demo', 'Standalone rewards']) {
      fireEvent.click(screen.getByRole('link', { name: mode }));
      expect(screen.getByText(`Wei (exact): ${award.amountWei}`)).toBeVisible();
      expect(screen.getByText(payment.transactionHash)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();
      expect(window.location.search).toContain(`claim=${claim.claimId}`);
    }
    expect(state.reads).toHaveLength(reads); expect(state.writes).toBe(0);
    expect(new Set(state.reads).size).toBe(1);
  });
  it('unavailable status remains unknown in both modes, with no payment shortcut', async () => {
    state.unavailable = true; mount();
    await screen.findByText('Payment status unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Open classic demo' }));
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim reward" })).not.toBeInTheDocument();
    state.unavailable = false; fireEvent.click(screen.getByRole('button', { name: 'Retry status check' }));
    await waitFor(() => expect(screen.getByText('Paid')).toBeVisible());
    expect(state.writes).toBe(0);
  });
});
