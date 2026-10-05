import {useEffect,useState} from 'react';
import type {ControllerSigningProgress} from '../data/controllerTransactions';

export type SigningPhase='access'|'results'|'preparing'|'confirming'|'next'|ControllerSigningProgress;


export default function ControllerSigningStatus({phase}:{phase:SigningPhase}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[]);
 const slow=elapsed>=15;
 const beforeWallet=phase==='access'||phase==='results'||phase==='preparing';
 return <div><p role="status" aria-live="polite">
  {beforeWallet?(slow?'These checks are taking longer than usual. The wallet opens only after they pass.':'Checking account access, approved rewards and testnet gas before opening your wallet.')
   :phase==='wallet'?(slow?'Still waiting for Privy. Check for its confirmation window. If it has not appeared, the wallet request has not completed.':'Confirm the transaction in the Privy wallet window to continue.')
   :phase==='confirming'?'Checking the finalized receipt and current reward source. Your saved transaction stays available for recovery.'
   :phase==='next'?'Transaction confirmed. Loading the next wallet step; no new signature has been requested yet.'
   :phase==='recovering'?'Checking your existing transaction. No new wallet signature is requested.'
   :'Your signature was received. Waiting for the server to return the transaction hash. Do not sign again.'}
 </p><small aria-live="off">{elapsed}s in this step</small></div>;
}
