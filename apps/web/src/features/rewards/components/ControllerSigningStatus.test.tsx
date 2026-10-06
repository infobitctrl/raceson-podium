import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import ControllerSigningStatus from './ControllerSigningStatus';
it('does not mark submission or confirmation complete while waiting for a wallet or an unknown submission',()=>{
 const v=render(<ControllerSigningStatus phase="wallet"/>);
 let stages=screen.getAllByRole('listitem');
 expect(stages.map(x=>x.getAttribute('data-state'))).toEqual(['current','upcoming','upcoming','upcoming']);
 v.rerender(<ControllerSigningStatus phase="submitting"/>);
 stages=screen.getAllByRole('listitem');
 expect(stages.map(x=>x.getAttribute('data-state'))).toEqual(['complete','current','upcoming','upcoming']);
 expect(screen.getByRole('status')).toHaveTextContent('Waiting for the server to return the transaction hash');
});
it('keeps a known transaction confirming until a verified receipt advances it, and stops animation on failure',()=>{
 const v=render(<ControllerSigningStatus phase="confirming"/>);
 expect(screen.getAllByRole('listitem').map(x=>x.getAttribute('data-state'))).toEqual(['complete','complete','current','upcoming']);
 v.rerender(<ControllerSigningStatus phase="confirming" paused/>);
 expect(screen.getByRole('group',{name:'Transaction progress'})).toHaveAttribute('aria-busy','false');
 expect(screen.getAllByRole('listitem')[2]).toHaveAttribute('data-state','paused');
 expect(screen.getAllByRole('listitem')[2].querySelector('svg')).toBeNull();
 v.rerender(<ControllerSigningStatus phase="next"/>);
 expect(screen.getAllByRole('listitem').every(x=>x.getAttribute('data-state')==='complete')).toBe(true);
 expect(screen.getByRole('status')).toHaveTextContent('Transaction confirmed');
});
it('recovering signed bytes does not claim the server has submitted or confirmed them',()=>{
 render(<ControllerSigningStatus phase="recovering"/>);
 expect(screen.getAllByRole('listitem').map(x=>x.getAttribute('data-state'))).toEqual(['complete','current','upcoming','upcoming']);
 expect(screen.getByRole('status')).toHaveTextContent('No new wallet signature is requested');
});

it('checking an owner-entered recovery hash does not claim a wallet signature or submission',()=>{
 render(<ControllerSigningStatus phase="confirming" receiptOnly/>);
 expect(screen.getAllByRole('listitem').map(x=>x.getAttribute('data-state'))).toEqual(['current','upcoming']);
 expect(screen.queryByText('Submitted')).not.toBeInTheDocument();
 expect(screen.queryByText('Wallet confirmation')).not.toBeInTheDocument();
});
