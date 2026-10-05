import {useEffect,useRef,useState} from 'react';
import {apiRequest,ApiError} from '@/lib/api';

type Award={beneficiaryId:string;name:string;place:number|null;value:string;amountWei:string};
type Group={nodeId:string;name:string;slot:number;type:string;beneficiaryKind:'athlete'|'club';budgetWei:string;proposedWei:string;heldWei:string;unusedWei:string;unallocatedWei:string;hold:string|null;awards:Award[]};
type Allocation={version:'podium-copy-allocation-v1';state:'unapproved';payableWei:'0';setupId:string;revision:number;sourceHash:string;configurationHash:string;budgetWei:string;proposedWei:string;heldWei:string;unallocatedWei:string;unusedWei:string;groups:Group[];reviewNote:string;sourceCounts:{results:number;finished:number;countedCombinedFinishes:number;unclassifiedFinishes:number}};
type Handoff={version:'podium-copy-review-handoff-v1';documentHash:string;document:{version:'podium-copy-review-document-v1';chainId:10143;state:'unapproved';payableWei:'0';setup:{id:string;revision:number};allocation:Allocation}};
const units=(wei:string)=>{const n=BigInt(wei),fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return `${n/10n**18n}${fraction?'.'+fraction:''}`;};
const holdLabel=(hold:string)=>hold.split(',').map(reason=>({duplicate_athlete_round:'More than one finish needs a sporting decision',duplicate_round_finish_requires_review:'More than one finish needs a sporting decision',duplicate_classified_finish:'Duplicate classified finish',missing_distance:'A course distance is missing',unattributed_club:'Some finishes have no confirmed club attribution'}[reason]??'Sporting evidence needs review')).join('; ');
/** Only a saved revision is requested. Parent unmounts this view as soon as the
 * sponsor edits rules, and account changes remount the whole hosted workspace. */
export default function HostedAllocationPreview({id,revision}:{id:string;revision:number}) {
 const [data,setData]=useState<Allocation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(''),[page,setPage]=useState(0),[downloading,setDownloading]=useState(false),[digest,setDigest]=useState(''),[file,setFile]=useState<{href:string;name:string}|null>(null);
 const alive=useRef(true),lock=useRef(false),downloadUrl=useRef<string|null>(null);
 function clearDownload(){if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;setFile(null);setDigest('');}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;};},[]);
 async function calculate(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setData(null);clearDownload();
  try {
   const result=await apiRequest<Allocation>({path:`/v1/rewards/demo-copy/sponsor-setups/${id}/allocation/${revision}`,cache:'no-store'});
   if(result.version!=='podium-copy-allocation-v1'||result.state!=='unapproved'||result.payableWei!=='0'||result.setupId!==id||result.revision!==revision
    ||[result.budgetWei,result.proposedWei,result.heldWei,result.unallocatedWei,result.unusedWei].some(n=>!/^\d+$/.test(n))
    ||BigInt(result.budgetWei)!==BigInt(result.proposedWei)+BigInt(result.heldWei)+BigInt(result.unallocatedWei)+BigInt(result.unusedWei))throw Error('invalid_preview');
   if(alive.current){setData(result);setSelected((result.groups.find(g=>BigInt(g.budgetWei)>0n)??result.groups[0])?.nodeId??'');setPage(0);}
  }catch(e){if(alive.current)setError(e instanceof ApiError&&e.status===409?'This campaign changed. Reopen its saved version, then calculate again.':e instanceof ApiError&&e.code==='reward_setup_overallocated'?'A split exceeds 100%. Adjust the shares, save, and calculate again.':'The verified allocation could not be loaded. Try again.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function download(){
  if(lock.current||!data)return;lock.current=true;setDownloading(true);setError('');clearDownload();
  try {
   const result=await apiRequest<Handoff>({path:`/v1/rewards/demo-copy/sponsor-setups/${id}/allocation/${revision}/handoff`,cache:'no-store'}),d=result.document;
   if(result.version!=='podium-copy-review-handoff-v1'||!/^[0-9a-f]{64}$/.test(result.documentHash)
    ||d.version!=='podium-copy-review-document-v1'||d.chainId!==10143||d.state!=='unapproved'||d.payableWei!=='0'
    ||d.setup.id!==id||d.setup.revision!==revision||d.allocation.configurationHash!==data.configurationHash||d.allocation.sourceHash!==data.sourceHash)throw Error('invalid_handoff');
   if(!alive.current)return;
   const href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));
   downloadUrl.current=href;setFile({href,name:`podium-review-${id}-r${revision}-${result.documentHash.slice(0,12)}.json`});
   setDigest(result.documentHash);
  }catch(e){if(alive.current)setError(e instanceof ApiError&&e.status===409?'This campaign changed. Reopen its saved version before downloading.':'The review record could not be downloaded. Try again.');}
  finally{lock.current=false;if(alive.current)setDownloading(false);}
 }
 const group=data?.groups.find(g=>g.nodeId===selected),awards=group?.awards??[];
 return <section className="hosted-allocation" aria-label="Saved allocation preview">
  <div className="hosted-allocation-heading"><div><h2>Allocation preview</h2><p>Calculate against saved revision {revision}. These are provisional awards for review.</p></div><button onClick={calculate} disabled={busy||downloading}>{busy?'Calculating…':data?'Recalculate saved rules':'Preview allocations'}</button></div>
  {error&&<p className="hosted-error" role="alert">{error}</p>}
  {data&&<>
   <p className="hosted-note">Not approved · Payable: 0 test MON. Athlete shares are retained regardless of wallet status. No transaction is created by this preview.</p>
   <dl className="hosted-allocation-totals">{[['Planned budget',data.budgetWei],['Calculated awards',data.proposedWei],['Held for review',data.heldWei],['Unallocated budget',data.unallocatedWei],['Unused prizes',data.unusedWei]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{units(value!)} <small>test MON</small></dd></div>)}</dl>
   <p>{data.sourceCounts.results} source results · {data.sourceCounts.finished} published finishes · {data.sourceCounts.countedCombinedFinishes} counted combined finishes. {data.sourceCounts.unclassifiedFinishes} unclassified finishes remain in participation without invented category awards.</p>
   <p className="hosted-note">{data.reviewNote}</p>
   <button onClick={download} disabled={downloading}>{downloading?'Preparing review record…':'Prepare review record'}</button>
   {file&&<p><a href={file.href} download={file.name}>Save review JSON</a></p>}
   <p>The JSON record binds these saved rules, source results and review decisions. Its checksum identifies the exact record; controller approval is still required.</p>
   {digest&&<p role="status" style={{overflowWrap:'anywhere'}}>Review record SHA-256: <code>{digest}</code></p>}
   <label>Reward group<select aria-label="Allocation reward group" value={selected} onChange={e=>{setSelected(e.target.value);setPage(0);}}>{data.groups.map(g=><option key={g.nodeId} value={g.nodeId}>{g.slot?`Round ${g.slot}`:'League'} · {g.name} · {units(g.budgetWei)} test MON{g.hold?' · held':''}</option>)}</select></label>
   {group&&<>
    <h3>{group.slot?`Round ${group.slot}`:'League'} · {group.name}</h3>
    <p>{units(group.proposedWei)} test MON calculated · {units(group.heldWei)} held · {units(group.unallocatedWei)} unallocated · {units(group.unusedWei)} unused prizes.</p>
    {group.hold?<p role="status" className="hosted-note">Held: {holdLabel(group.hold)}. The held amount is not redistributed.</p>:group.budgetWei==='0'?<p>No budget assigned to this group.</p>:!awards.length?<p>No positive awards in this group. Its prize budget remains unused.</p>:<>
     <div className="hosted-allocation-table"><table><caption>Provisional {group.beneficiaryKind} awards · saved revision {revision}</caption><thead><tr><th>Place</th><th>{group.beneficiaryKind==='club'?'Club':'Athlete'}</th><th>{group.type==='athlete_finishes'?'Finishes':group.type.endsWith('metres')?'Metres':group.slot&&group.type==='athlete_standings'?'Category place':'Points'}</th><th>Test MON</th></tr></thead><tbody>{awards.slice(page*15,page*15+15).map(a=><tr key={a.beneficiaryId}><td>{a.place??'—'}</td><td>{a.name}</td><td>{a.value}</td><td className="hosted-amount">{units(a.amountWei)}</td></tr>)}</tbody></table></div>
     <nav className="hosted-pot-tabs" aria-label="Allocation pages"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous awards</button><span>Page {page+1} of {Math.ceil(awards.length/15)} · {awards.length} recipients</span><button disabled={(page+1)*15>=awards.length} onClick={()=>setPage(p=>p+1)}>Next awards</button></nav>
    </>}
   </>}
  </>}
 </section>;
}
