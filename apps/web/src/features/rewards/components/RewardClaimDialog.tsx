import {useRef,useState,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import s from './RewardRoleWorkspace.module.css';

export default function RewardClaimDialog({club=false,hr,onClose,children}:{club?:boolean;hr:boolean;onClose:()=>void;children:(onBusy:(busy:boolean)=>void)=>ReactNode}){
 const [busy,setBusy]=useState(false),opener=useRef<HTMLElement|null>(null),title=useRef<HTMLHeadingElement>(null);
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className={s.dialog}
  onOpenAutoFocus={event=>{event.preventDefault();opener.current=document.activeElement as HTMLElement;title.current?.focus();}}
  onCloseAutoFocus={event=>{if(opener.current?.isConnected){event.preventDefault();opener.current.focus();}}}
  onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onInteractOutside={event=>event.preventDefault()}>
  <DialogTitle ref={title} tabIndex={-1} className={s.dialogTitle}>{club?(hr?'Preuzimanje na klupsku riznicu':'Claim to club treasury'):(hr?'Pregled vaše nagrade':'Review your reward')}</DialogTitle>
  <DialogDescription className={s.description}>{hr?'Provjerite iznos, odredište i preostale korake. Isplata je potvrđena tek nakon provjere potvrde transakcije.':'Check the amount, destination and remaining steps. Payment is confirmed only after its transaction receipt is verified.'}</DialogDescription>
  {children(setBusy)}
  <button type="button" className={s.closeReview} disabled={busy} onClick={onClose}>{hr?'Zatvori pregled':'Close review'}</button>
 </DialogContent></Dialog>;
}
