import {act,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ReviewStatusPills from './ReviewStatusPills';
import {notifyReviewStatus} from '../data/reviewStatus';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../data/reviewStatus',async original=>({...await original<typeof import('../data/reviewStatus')>(),readReviewStatus:mocks.read}));
const base={fundingState:'funded',claimState:'not_open',reviewState:'approved'};
beforeEach(()=>{mocks.read.mockReset();});afterEach(()=>vi.useRealTimers());
it('separates confirmed funding and approval from unopened claims, then updates after publication',async()=>{
 mocks.read.mockResolvedValue(base);render(<ReviewStatusPills id="raslina" revision={1} hr={false}/>);
 expect(await screen.findByText('Funding confirmed')).toBeVisible();expect(screen.getByText('Awards approved')).toBeVisible();expect(screen.getByText('Claims not open')).toBeVisible();
 mocks.read.mockResolvedValue({...base,claimState:'open'});act(()=>notifyReviewStatus('raslina'));
 expect(await screen.findByText('Claims open')).toBeVisible();expect(screen.queryByText('Funding needs confirmation')).not.toBeInTheDocument();
});
it('polls without manual reload, refreshes on focus, and clears success after verification fails',async()=>{
 mocks.read.mockResolvedValue(base);render(<ReviewStatusPills id="raslina" revision={1} hr={false}/>);await screen.findByText('Funding confirmed');
 mocks.read.mockResolvedValue({...base,claimState:'paused'});
 fireEvent(window,new Event('focus'));await act(async()=>{});expect(screen.getByText('Claims paused')).toBeVisible();
 mocks.read.mockRejectedValue(Error('access revoked'));fireEvent(window,new Event('focus'));await act(async()=>{});
 expect(screen.getByText('Status unavailable')).toBeVisible();expect(screen.queryByText('Funding confirmed')).not.toBeInTheDocument();
});
it('checks visible status every thirty seconds and never applies a late previous campaign response',async()=>{
 vi.useFakeTimers();mocks.read.mockResolvedValue(base);
 const ui=render(<ReviewStatusPills id="one" revision={1} hr={false}/>);await act(async()=>{});
 mocks.read.mockResolvedValue({...base,claimState:'open'});await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(screen.getByText('Claims open')).toBeVisible();
 let resolve!:(v:unknown)=>void;mocks.read.mockImplementationOnce(()=>new Promise(r=>resolve=r));act(()=>notifyReviewStatus('one'));
 mocks.read.mockResolvedValue({...base,fundingState:'awaiting_funding',reviewState:'pending'});ui.rerender(<ReviewStatusPills id="two" revision={1} hr={false}/>);await act(async()=>{});
 await act(async()=>resolve({...base,claimState:'open'}));expect(screen.getByText('Awaiting funding')).toBeVisible();expect(screen.queryByText('Claims open')).not.toBeInTheDocument();
});
