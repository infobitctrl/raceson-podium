import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {I18nProvider} from '@/shared/i18n/I18nProvider';
import type {PublicDirectory} from '@raceson/domain/rewards/public-directory';
import PodiumDirectoryStatus from './PodiumDirectoryStatus';
const data={chainId:10143,sponsors:1,items:[{}],checkedAt:'2026-09-25T20:44:00Z',refreshStatus:'refreshing'} as PublicDirectory;
describe('public observation freshness',()=>{
 it('keeps original observation time during background checks and failed refreshes',()=>{
  const refresh=vi.fn();
  const view=(d:PublicDirectory)=><I18nProvider initialLocale="en"><PodiumDirectoryStatus data={d} fetching={false} error={false} onRefresh={refresh}/></I18nProvider>;
  const {rerender}=render(view(data));
  expect(screen.getByRole('status')).toHaveTextContent('Checking for updates in the background');
  expect(document.querySelector('time')).toHaveAttribute('dateTime',data.checkedAt);
  expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();
  rerender(view({...data,refreshStatus:'failed'}));
  expect(screen.getByRole('status')).toHaveTextContent('Showing last known figures');
  expect(document.querySelector('time')).toHaveAttribute('dateTime',data.checkedAt);
  fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));expect(refresh).toHaveBeenCalledOnce();
 });
 it('allows manual recovery when the polling request itself fails',()=>{
  render(<I18nProvider initialLocale="en"><PodiumDirectoryStatus data={data} fetching={false} error onRefresh={()=>{}}/></I18nProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Refresh failed');
  expect(screen.getByRole('button',{name:'Refresh status'})).toBeEnabled();
 });
});

it('shows active retry separately from the previous failed check without changing observed time',()=>{
 const view=(fetching:boolean)=><I18nProvider initialLocale="en"><PodiumDirectoryStatus data={{...data,refreshStatus:'failed'}} fetching={fetching} error={false} onRefresh={()=>{}}/></I18nProvider>;
 const page=render(view(false));expect(screen.getByRole('status')).toHaveTextContent('Showing earlier figures');
 page.rerender(view(true));expect(screen.getByRole('status')).toHaveTextContent('Checking campaign status');expect(screen.getByRole('status')).toHaveTextContent('Checking for updates in the background');
 expect(screen.getByRole('status')).not.toHaveTextContent('Refresh failed');expect(document.querySelector('time')).toHaveAttribute('dateTime',data.checkedAt);expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();
});


it('reports a first-request failure without inventing earlier figures and allows retry',()=>{
 const retry=vi.fn();
 render(<I18nProvider initialLocale="en"><PodiumDirectoryStatus fetching={false} error onRefresh={retry}/></I18nProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('Campaign status unavailable');
 expect(screen.getByRole('status')).toHaveTextContent('Campaign data could not be loaded');
 expect(screen.getByRole('status')).not.toHaveTextContent(/earlier figures|Loading|checked/);
 expect(document.querySelector('time')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));expect(retry).toHaveBeenCalledOnce();
});
it('keeps first load and active retry busy until facts are available',()=>{
 const view=(fetching:boolean,error:boolean)=><I18nProvider initialLocale="en"><PodiumDirectoryStatus fetching={fetching} error={error} onRefresh={()=>{}}/></I18nProvider>;
 const page=render(view(false,false));
 expect(screen.getByRole('status')).toHaveTextContent('Checking campaign status');
 expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();
 page.rerender(view(true,true));
 expect(screen.getByRole('status')).toHaveTextContent('Loading published campaigns');
 expect(screen.getByRole('status')).not.toHaveTextContent(/unavailable|earlier figures/);
 expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();
});
it('separates retrying an empty snapshot from confirmed empty and failed refresh',()=>{
 const empty={...data,items:[]};
 const view=(fetching:boolean,status:PublicDirectory['refreshStatus'])=><I18nProvider initialLocale="en"><PodiumDirectoryStatus data={{...empty,refreshStatus:status}} fetching={fetching} error={false} onRefresh={()=>{}}/></I18nProvider>;
 const page=render(view(true,'failed'));
 expect(screen.getByRole('status')).toHaveTextContent('last known published list is empty. Checking for updates');
 expect(screen.getByRole('status')).not.toHaveTextContent(/Refresh failed|currently published/);
 page.rerender(view(false,'current'));
 expect(screen.getByRole('status')).toHaveTextContent('No campaigns are currently published');
 expect(screen.getByRole('button',{name:'Refresh status'})).toBeEnabled();
 page.rerender(view(false,'failed'));
 expect(screen.getByRole('status')).toHaveTextContent('Refresh failed. The last known published list is empty.');
});
it('localizes first-request failure and recovery in Croatian',()=>{
 render(<I18nProvider initialLocale="hr"><PodiumDirectoryStatus fetching={false} error onRefresh={()=>{}}/></I18nProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('Stanje kampanja nije dostupno');
 expect(screen.getByRole('button',{name:'Pokušaj ponovno'})).toBeEnabled();
});
