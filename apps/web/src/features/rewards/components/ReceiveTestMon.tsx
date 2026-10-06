import {useState} from 'react';
import RewardExplorerLink from './RewardExplorerLink';
import s from './ReceiveTestMon.module.css';

/** Receiving funds needs no signer access and does not deposit campaign prizes. */
export default function ReceiveTestMon({address,chainId,hr=false}:{address:string;chainId:number;hr?:boolean}){
 const [copied,setCopied]=useState<string|null>(null),[failed,setFailed]=useState<string|null>(null);
 if(chainId!==10143||!/^0x[0-9a-f]{40}$/i.test(address))return null;
 const t=(en:string,local:string)=>hr?local:en;
 async function copy(){try{await navigator.clipboard.writeText(address);setCopied(address);setFailed(null);}catch{setFailed(address);}}
 return <details className={s.receive}>
  <summary>{t('Receive test MON','Primite test MON')}</summary>
  <p>{t('Send test MON on Monad testnet (10143) to this wallet, then refresh its balance.','Pošaljite test MON na Monad testnetu (10143) u ovaj novčanik, zatim osvježite stanje.')}</p>
  <p className={s.address}><code>{address}</code></p>
  <div className={s.actions}><button type="button" onClick={()=>void copy()}>{copied===address?t('Address copied','Adresa kopirana'):t('Copy wallet address','Kopiraj adresu novčanika')}</button><a href="https://faucet.monad.xyz/" target="_blank" rel="noopener noreferrer">{t('Open Monad testnet faucet','Otvori Monad testnet slavinu')}</a><RewardExplorerLink chainId={10143} kind="address" value={address}>{t('View wallet on explorer','Pogledaj novčanik u pregledniku')}</RewardExplorerLink></div>
  {failed===address?<p role="status">{t('Copy is unavailable. Select the address above and copy it manually.','Kopiranje nije dostupno. Odaberite adresu iznad i ručno je kopirajte.')}</p>:null}
  <p>{t('The faucet has its own availability and limits. Receiving wallet funds does not fund a campaign or approve a claim.','Slavina ima vlastitu dostupnost i ograničenja. Primanje sredstava u novčanik ne financira kampanju niti odobrava preuzimanje nagrade.')}</p>
 </details>;
}
