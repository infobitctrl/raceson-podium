import {useEffect,useState,type ReactNode} from 'react';
import RewardActionProgress from './RewardActionProgress';
import type {ControllerSigningProgress} from '../data/controllerTransactions';

export type SigningPhase='access'|'results'|'preparing'|'confirming'|'next'|ControllerSigningProgress;


export default function ControllerSigningStatus({phase,paused=false,children,failureMessage,receiptOnly=false}:{phase:SigningPhase;paused?:boolean;children?:ReactNode;failureMessage?:string;receiptOnly?:boolean}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{if(paused)return;const started=Date.now();const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[phase,paused]);
 const slow=elapsed>=15;
 const beforeWallet=phase==='access'||phase==='results'||phase==='preparing';
 const stage=receiptOnly?(phase==='next'?2:0):beforeWallet||phase==='wallet'?0:phase==='confirming'?2:phase==='next'?4:1;
 return <RewardActionProgress label="Transaction progress" stage={stage} paused={paused} messageRole={paused&&failureMessage?'alert':'status'} labels={receiptOnly?['Checking','Verified']:[beforeWallet?'Preparing':'Wallet confirmation','Submitted','Confirming','Confirmed']} message={<>
  {paused&&failureMessage?failureMessage:beforeWallet?(slow?'These checks are taking longer than usual. The wallet opens only after they pass.':'Checking account access, approved rewards and testnet gas before opening your wallet.')
   :phase==='wallet'?(slow?'Still waiting for Privy. Check for its confirmation window. If it has not appeared, the wallet request has not completed.':'Confirm the transaction in the Privy wallet window to continue.')
   :phase==='confirming'?'Checking the finalized receipt and current reward source. Your saved transaction stays available for recovery.'
   :phase==='next'?'Transaction confirmed. Loading the next wallet step; no new signature has been requested yet.'
   :phase==='recovering'?'Checking your existing transaction. No new wallet signature is requested.'
   :'Your signature was received. Waiting for the server to return the transaction hash. Do not sign again.'}
 </>}>{children}<small aria-live="off">{elapsed}s in this step</small></RewardActionProgress>;
}
