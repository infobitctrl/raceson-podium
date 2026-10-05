import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HostedCopyApp from './HostedCopyApp';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, account: null as { displayName: string; loginUsername: string } | null,
  isLoading: false, hasSupabase: true, epoch: 0, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => auth, AuthProvider: ({children}) => <div key={auth.epoch}>{children}</div> }));
vi.mock('./screens/HostedCopyPreview', () => ({ default: () => <p>Verified results view</p> }));
beforeEach(() => { auth.user = null; auth.account = null; auth.isLoading = false; auth.epoch = 0; auth.signIn.mockReset().mockResolvedValue({}); auth.signOut.mockReset().mockResolvedValue(undefined); });

it('submits only credentials to ordinary auth and clears the password after an error', async () => {
  auth.signIn.mockRejectedValue(new Error('private backend detail'));
  render(<HostedCopyApp />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' racesmon1 ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('alert');
  expect(auth.signIn).toHaveBeenCalledWith({ identifier: 'racesmon1', password: 'test-only-secret' });
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
  expect(screen.queryByText('Verified results view')).not.toBeInTheDocument();
});

it('keeps a remounted login form disabled until sign-out finishes', async () => {
  let finish!: () => void;
  auth.signOut.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  auth.user = { id: 'demo-user' };
  const { rerender } = render(<HostedCopyApp />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  auth.user = null; auth.epoch += 1; rerender(<HostedCopyApp />);
  expect(screen.getByLabelText('Username')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByLabelText('Username')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('shows the signed-in alias and removes results as soon as sign-out clears the user', async () => {
  auth.user = { id: 'demo-user' }; auth.account = { displayName: 'Races Mon1', loginUsername: 'racesmon1' };
  const { rerender } = render(<HostedCopyApp />);
  expect(screen.getByText('Verified results view')).toBeVisible();
  expect(screen.getByText('racesmon1')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
  auth.user = null; auth.account = null; rerender(<HostedCopyApp />);
  expect(screen.queryByText('Verified results view')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Username')).toBeVisible();
});
