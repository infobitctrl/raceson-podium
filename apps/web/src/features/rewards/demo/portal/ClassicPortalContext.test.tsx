import { fireEvent, render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n/I18nProvider';
import ClassicPortalContext from './ClassicPortalContext';
const f = vi.hoisted(() => ({ load: vi.fn(), session: {} as object | null }));
vi.mock('./portalContext', () => ({ loadPortalContexts: f.load }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'actor' }, account: { userId: 'actor' }, session: f.session }) }));
vi.mock('@/lib/organizer-workspace', () => ({ useOrganizerWorkspace: () => ({ selectedOrganizationId: 'organization' }) }));
const result = { record: { draftId: 'draft', organizationName: 'Monad demo organization', seasonName: 'Practice league', seasonId: 'season', revision: 3 },
  workspace: { revision: 2, catalogueHash: 'source-hash', mapping: { rounds: [{ slot: 5, roundId: 'round' }] },
    catalogue: { rounds: [{ id: 'round', name: 'Synthetic finale', editionId: 'imported-ref', date: '2026-10-03', status: 'finished',
      races: [{ id: 'race', name: 'Short course', publicationState: 'official', publicationId: 'publication-v1' }] }] } },
  finale: { binding: { id: 'binding', editionId: 'practice-event' } } };
function tree() { return <I18nProvider initialLocale="en"><BrowserRouter><ClassicPortalContext /></BrowserRouter></I18nProvider>; }
beforeEach(() => { f.session = {}; f.load.mockReset().mockResolvedValue([result]); window.history.replaceState({}, '', '/organizer/reward-context?event=practice-event'); });
describe('classic organizer source continuity', () => {
  it('shows server revisions and publication IDs, with exact local event and same-draft links', async () => {
    render(tree()); await screen.findByText('Monad demo organization / Practice league');
    expect(f.load).toHaveBeenCalledWith('organization', { event: 'practice-event', draft: null, season: null });
    expect(screen.getByText('publication-v1')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Reward setup and distribution' })).toHaveAttribute('href', '/organizer/reward-planner?draft=draft');
    expect(screen.getByRole('link', { name: 'Standalone rewards' })).toHaveAttribute('href', '/rewards/manage?draft=draft');
    expect(screen.getAllByRole('link', { name: 'Events' }).at(-1)).toHaveAttribute('href', '/organizer/events/practice-event');
    expect(screen.getByRole('link', { name: 'Results' })).toHaveAttribute('href', '/organizer/registrations/results?edition=practice-event&view=official');
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toMatch(/^\//);
  });
  it('hides private context immediately when the session disappears', async () => {
    const view = render(tree()); await screen.findByText('publication-v1');
    f.session = null; view.rerender(tree()); expect(screen.queryByText('publication-v1')).not.toBeInTheDocument();
  });
  it('failed reads expose a retry without inventing source or payment state', async () => {
    f.load.mockRejectedValueOnce({ status: 503 }); render(tree());
    expect(await screen.findByRole('alert')).toHaveTextContent('Reward status is unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('publication-v1')).toBeVisible();
  });
});
