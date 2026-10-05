import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/shared/i18n/I18nProvider';
import ClassicSourceEntry from './ClassicSourceEntry';

describe('classic source entry links', () => {
  it.each([
    ['/organizer/events/practice-finale', '/organizer/events/:eventId', false, '?event=practice-finale'],
    ['/organizer/leagues/season', '/organizer/leagues/:seasonId', false, '?season=season'],
    ['/leagues/season', '/leagues/:id', true, '?season=season'],
    ['/organizer/registrations/results?edition=practice&view=official', '/organizer/registrations/results', false, '?event=practice'],
    ['/organizer/reward-planner?draft=programme', '/organizer/reward-planner', false, '?draft=programme'],
  ])('retains the selected context from %s', (entry, path, league, query) => {
    render(<I18nProvider initialLocale="en"><MemoryRouter initialEntries={[entry]}><Routes><Route path={path}
      element={<ClassicSourceEntry league={league}><h1>Actual host workspace slot</h1></ClassicSourceEntry>} /></Routes></MemoryRouter></I18nProvider>);
    expect(screen.getByRole('link', { name: 'Reward setup and distribution' })).toHaveAttribute('href', `/organizer/reward-context${query}`);
    expect(screen.getByRole('link', { name: 'My rewards and receipts' })).toHaveAttribute('href', '/athlete/rewards?experience=classic');
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toMatch(/^\//);
  });
});
