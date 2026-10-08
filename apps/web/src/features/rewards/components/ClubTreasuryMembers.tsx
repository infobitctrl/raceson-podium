import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,Clock3,RefreshCw,Users} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clubCreationMembers,type ClubCreationMember} from '../data/clubSafeCreation';
export default function ClubTreasuryMembers({clubId,disabled,onChange}:{clubId:string;disabled:boolean;onChange:(members:ClubCreationMember[])=>void}){
 const [members,setMembers]=useState<ClubCreationMember[]>([]),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState('');
 const [cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const epoch=useRef(0),change=useRef(onChange),selection=useRef(selected),known=useRef(members);known.current=members;change.current=onChange;selection.current=selected;
 const load=useCallback(async(after:string|null=null)=>{const ticket=++epoch.current;setBusy(true);setError(false);
  // Retain selected names locally, but retire readiness while refreshing.
  change.current([]);
  try{const page=await clubCreationMembers(clubId,after);if(ticket!==epoch.current)return;
   const next=after?[...known.current,...page.items]:page.items;setMembers(next);setCursor(page.nextCursor);
   // A full refresh resets selection rather than silently dropping a selected
   // member outside the first page or retaining an old provider address.
   const ids=after?selection.current:[];if(!after)setSelected([]);change.current(next.filter(m=>ids.includes(m.memberId)));
  }catch{if(ticket===epoch.current){setError(true);setMembers([]);setSelected([]);setCursor(null);}}
  finally{if(ticket===epoch.current)setBusy(false);}
 },[clubId]);
 const cancel=useCallback(()=>{epoch.current++;},[]);
 useEffect(()=>{setMembers([]);setSelected([]);setQuery('');void load();return cancel;},[load,cancel]);
 const visible=members.filter(m=>m.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <div className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 font-medium"><Users size={18} aria-hidden="true"/>Choose 3 members <span className="text-sm text-muted-foreground">{selected.length}/3</span></p>
   <Button type="button" variant="ghost" disabled={busy||disabled} onClick={()=>void load()}><RefreshCw size={15} className="mr-2" aria-hidden="true"/>Refresh wallets</Button></div>
  <input aria-label="Search club members" className="w-full rounded-lg border bg-background p-3" placeholder="Search club members" value={query} onChange={e=>setQuery(e.target.value)}/>
  {busy?<p role="status" className="text-sm text-muted-foreground">Checking member wallets…</p>:null}
  {error?<p role="alert">Member wallets could not be checked. Refresh to retry.</p>:null}
  <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{visible.map(m=>{const checked=selected.includes(m.memberId);return <label key={m.memberId} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked?'border-primary bg-primary/5':''}`}>
   <input type="checkbox" aria-label={`Select ${m.name}`} checked={checked} disabled={disabled||busy||!checked&&selected.length===3} onChange={()=>{const next=checked?selected.filter(id=>id!==m.memberId):[...selected,m.memberId];setSelected(next);change.current(members.filter(item=>next.includes(item.memberId)));}} className="mt-1"/>
   <span className="min-w-0"><span className="block break-words font-medium">{m.name}</span><span className={`mt-1 flex items-center gap-1 text-xs ${m.status==='ready'?'text-emerald-700':'text-muted-foreground'}`}>{m.status==='ready'?<CheckCircle2 size={14} aria-hidden="true"/>:<Clock3 size={14} aria-hidden="true"/>}{m.status==='ready'?'Wallet ready':m.status==='setup_needed'?'Wallet setup needed':'Wallet check unavailable'}</span></span>
  </label>;})}</div>
  {!busy&&!error&&!visible.length?<p className="text-sm text-muted-foreground">{members.length?'No matching members.':'No active club members found.'}</p>:null}
  {!busy&&!error&&!cursor&&members.length<3?<p role="status" className="rounded-lg bg-muted p-3 text-sm">This club has {members.length} active {members.length===1?'member':'members'} recorded. Three active members are needed to create a treasury.</p>:null}
  {cursor?<Button variant="outline" disabled={busy||disabled} onClick={()=>void load(cursor)}>Load more members</Button>:null}
  {members.some(m=>selected.includes(m.memberId)&&m.status!=='ready')?<p role="status" className="rounded-lg bg-muted p-3 text-sm">Each selected member needs to sign in and set up their Privy wallet. Then refresh wallets and select the three members again.</p>:null}
 </div>;
}
