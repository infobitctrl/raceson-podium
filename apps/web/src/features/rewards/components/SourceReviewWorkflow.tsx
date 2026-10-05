import type {ReactNode} from 'react';
import {Check} from 'lucide-react';
import s from './ControllerWorkflow.module.css';

/** Off-chain review evidence cannot attest on-chain signing or claim readiness. */
export default function SourceReviewWorkflow({current,loading,hr,children,completeThrough=-1}:{completeThrough?:number;current:'review'|'approve'|'controller'|null;loading:boolean;hr:boolean;children:ReactNode}){
 const t=(en:string,local:string)=>hr?local:en,keys=['review','approve','controller','claims'];
 const position=current===null?-1:keys.indexOf(current);
 const titles=[t('Review results','Pregled rezultata'),t('Approve rewards','Odobrenje nagrada'),t('Controller handoff','Predaja kontroloru'),t('Claims open','Preuzimanje otvoreno')];
 return <section className={s.workflow} aria-label={t('Reward distribution workflow','Tijek raspodjele nagrada')}><h2>{t('Workflow','Tijek rada')}</h2><p className={s.intro}>{t('Review evidence here, then continue to wallet signing in Rewards Control.','Ovdje pregledajte dokaze, zatim nastavite s potpisivanjem novčanikom u Rewards Control.')}</p>
 {position===-1&&completeThrough>=1?<div>{children}</div>:null}
 <ol className={s.steps} aria-label={t('Reward progress','Napredak nagrada')}>{titles.map((title,index)=>{const complete=position>index||index<=completeThrough,active=position===index;
  return <li key={keys[index]} data-state={complete?'complete':active?'current':'upcoming'} aria-current={active?'step':undefined}><span className={s.marker} aria-hidden="true">{complete?<Check size={18}/>:index+1}</span><div className={s.content}><div className={s.heading}><h3>{title}</h3><span className={s.status}>{loading?t('Checking…','Provjera…'):complete?t('Complete','Dovršeno'):active?t('Current','Trenutačno'):t('Check status','Provjeri stanje')}</span></div><span className={s.owner}>{index<2?t('Results team','Tim za rezultate'):index===2?t('Controller','Kontrolor'):t('Athletes & clubs','Natjecatelji i klubovi')}</span>{active?<div>{children}</div>:null}{index===3?<p className={s.note}>{t('Current signing and claim status is verified in Rewards Control.','Aktualno stanje potpisa i preuzimanja provjerava se u Rewards Control.')}</p>:null}</div></li>;
 })}</ol>{position===-1&&completeThrough<1?<div>{children}</div>:null}</section>;
}
