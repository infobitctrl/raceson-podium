import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import SponsorSourceReview from './SponsorSourceReview';
import {historicalFixture} from '../data/historicalSourceV3.fixture';
const m=vi.hoisted(()=>({load:vi.fn(),request:vi.fn()}));
vi.mock('../data/historicalSourceV3',()=>({loadHistoricalReviewContext:m.load,requestHistoricalSourceV3:m.request}));
beforeEach(()=>{m.load.mockReset().mockResolvedValue(historicalFixture().context);m.request.mockReset().mockResolvedValue(historicalFixture().data);});
it('requires source acknowledgment, hides technical IDs and recovers an uncertain write exactly',async()=>{
 const saved=vi.fn();render(<SponsorSourceReview draftId={historicalFixture().context.record.draftId} slot={1} expectedContextHash={"a".repeat(64)} onReviewed={saved}/>);
 const button=await screen.findByRole('button',{name:'Confirm official results'});expect(button).toBeDisabled();
 expect(screen.getByText('a'.repeat(64))).not.toBeVisible();expect(m.request).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('checkbox'));m.request.mockRejectedValueOnce(Error('offline'));fireEvent.click(button);
 await screen.findByRole('alert');expect(saved).not.toHaveBeenCalled();const request=m.request.mock.calls[1][1];
 expect(request).toMatchObject({slot:1,expectedReviewId:null,decision:'confirmed_final'});
 fireEvent.click(screen.getByRole('button',{name:'Retry same confirmation'}));await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));
 expect(m.request.mock.calls[2][1]).toEqual(request);
});
it('does not expose confirmation when source access fails',async()=>{m.load.mockRejectedValue(Error('403'));render(<SponsorSourceReview draftId="private" slot={1} expectedContextHash={"a".repeat(64)} onReviewed={vi.fn()}/>);await screen.findByRole('alert');expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();expect(m.request).not.toHaveBeenCalled();});

it("refuses to confirm a newer source than the displayed result list",async()=>{render(<SponsorSourceReview draftId="private" slot={1} expectedContextHash={"b".repeat(64)} onReviewed={vi.fn()}/>);await screen.findByRole("alert");expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();expect(m.request.mock.calls.every(c=>!c[1])).toBe(true);});
