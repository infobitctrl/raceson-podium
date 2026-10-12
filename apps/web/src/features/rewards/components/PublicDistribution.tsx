import {memo, useCallback, useMemo, useState} from 'react';
import {ArrowLeft, ArrowRight, ChevronRight, RotateCcw, Minus, Plus} from 'lucide-react';
import type {PublicSponsorCampaign} from '@raceson/domain/rewards/public-campaign';
import {useDistributionViewport} from '../model/useDistributionViewport';
import {radialDistribution} from '../model/radialDistribution';
import {publicDistributionTree, type DistributionNode} from '../model/publicDistribution';
import {usePublicCampaignRewards, type PublicRewardCache, type PublicRewardAnchor} from '../model/usePublicCampaignRewards';
import {publicRewardAmount as setupAmount} from '../model/publicAmount';
import {prizePercent} from '../model/prizeDisplay';
import PublicRewardTable from './PublicRewardTable';
import s from './PublicDistribution.module.css';
export default function PublicDistribution({campaign, pot, hr, refresh, subtitle, onSelectPot, startAtPot=false, ready=true, rewardCache, anchor}: {campaign: PublicSponsorCampaign; pot: PublicSponsorCampaign['pots'][number]; hr: boolean; refresh: number; subtitle: string;onSelectPot:(slot:number)=>void;startAtPot?:boolean;ready?:boolean;rewardCache?:PublicRewardCache;anchor?:PublicRewardAnchor}) {
  const loaded = usePublicCampaignRewards(campaign.id, pot.slot, refresh, ready, rewardCache, anchor);
  const rewards = {...loaded, busy: loaded.busy || !ready};
  const tree = useMemo(() => publicDistributionTree(campaign, pot, rewards.page?.rows ?? null, hr), [campaign, pot, rewards.page, hr]);
  return <>
    <p className={s.hint} role="status">{rewards.page
      ? `${hr ? 'Nagrade posljednji put provjerene' : 'Rewards last verified'}: ${new Date(Number(rewards.page.blockTimestamp)*1000).toLocaleString(hr?'hr-HR':'en-GB')}${rewards.busy||!ready ? hr?' · Provjera trenutačnog stanja…':' · Checking current status…' : rewards.failed ? hr?' · Osvježavanje nije uspjelo; prikazano je spremljeno stanje.':' · Refresh failed; showing saved status.' : ''}`
      : hr?'Spremljeni proračuni prikazani su dok se provjeravaju nagrade.':'Saved budgets are shown while rewards are verified.'}</p>
    <DistributionExplorer key={`${campaign.id}:${pot.slot}`} tree={tree} hr={hr} busy={rewards.busy||!ready} failed={rewards.failed} onSelectPot={onSelectPot} initialPath={campaign.pots.length>1&&startAtPot?[`pot-${pot.slot}`]:[]}/>
    <section className={s.ledger} aria-label={hr ? 'Odabrani fond' : 'Selected prize pot'}><PublicRewardTable id={campaign.id} key={pot.slot} slot={pot.slot} hr={hr} refresh={refresh} title={hr ? 'Pregled nagrada' : 'Reward ledger'} subtitle={subtitle} rewards={rewards}/></section></>;
}
export function DistributionExplorer({tree, hr, busy, failed, onSelectPot, initialPath=[]}: {tree: DistributionNode; hr: boolean; busy: boolean; failed: boolean; onSelectPot?:(slot:number)=>void;initialPath?:string[]}) {
  const t = (en: string, local: string) => hr ? local : en;
  const [path, setPath] = useState<string[]>(initialPath), [offset, setOffset] = useState(0);
  const [shown, setShown] = useState<'allocations'|'categories'|'rewards'>('rewards');
  const {viewportRef, zoom, dragging, canZoomIn, canZoomOut, focusPoint, zoomIn, zoomOut, fit, handlers} = useDistributionViewport();
  const categoryDepth = tree.children.some(child => /^pot-[0-5]$/.test(child.id)) ? 3 : 2;
  const maxDepth = shown === 'allocations' ? categoryDepth - 1 : shown === 'categories' ? categoryDepth : Infinity;
  const graph = useMemo(() => radialDistribution(tree, maxDepth), [tree, maxDepth]);
  const positions = useMemo(() => new Map(graph.nodes.map(entry => [entry.node.id, entry])), [graph]);
  const ancestors = [tree];
  for (const id of path) {const child = ancestors[ancestors.length-1]!.children.find(n => n.id === id); if (!child) break; ancestors.push(child);}
  const node = ancestors[ancestors.length-1]!, visible = node.children.slice(offset, offset+8);
  const open = useCallback((child: DistributionNode, childPath = [...path, child.id]) => {
    const potId = childPath.find(id => /^pot-[0-5]$/.test(id));
    if (potId && potId !== path[0]) onSelectPot?.(Number(potId.slice(4)));
    setPath(childPath); setOffset(0);
    if (child.children.length && childPath.length >= maxDepth) setShown(childPath.length >= categoryDepth ? 'rewards' : 'categories');
  }, [path, onSelectPot, maxDepth, categoryDepth]);
  const changeLevels = (level: typeof shown) => {setShown(level); setPath([]); setOffset(0); fit();};
  const back = useCallback((index: number) => {setPath(path.slice(0,index)); setOffset(0);}, [path]);
  const amount = (n: DistributionNode) => setupAmount(n.amountWei, hr);
  const state = (n: DistributionNode) => n.status === 'claimed' ? t('Claimed', 'Preuzeto') : n.status === 'unclaimed' ? t('Unclaimed', 'Nepreuzeto') : n.status === 'planned' ? t('Planned', 'Planirano') : n.level === 'reserve' ? t('Unallocated', 'Neraspoređeno') : t('Saved budget', 'Spremljeni fond');
  return <section className={s.panel} aria-label={t('Prize pool allocation', 'Raspodjela fonda nagrada')}>
    <header className={s.header}><div><span className={s.eyebrow}>{t('Follow the rewards', 'Pratite nagrade')}</span><h2>{t('Prize pool allocation', 'Raspodjela fonda nagrada')}</h2></div><div className={s.legend}><span data-status="claimed">{t('Claimed', 'Preuzeto')}</span><span data-status="unclaimed">{t('Unclaimed', 'Nepreuzeto')}</span><span>{t('Budget / planned', 'Fond / planirano')}</span></div></header>
    <nav className={s.breadcrumb} aria-label={t('Allocation path', 'Put raspodjele')}>{ancestors.map((n,i) => <span key={n.id}>{i ? <ChevronRight size={12}/> : null}<button onClick={() => back(i)} aria-current={i === ancestors.length-1 ? 'location' : undefined}>{n.label}</button></span>)}{path.length ? <button className={s.reset} onClick={() => back(0)} aria-label={t('Reset allocation view', 'Početni prikaz raspodjele')}><RotateCcw size={14}/></button> : null}</nav>
    <div className={s.toolbar}>
      <div className={s.levels} aria-label={t('Visible distribution levels', 'Vidljive razine raspodjele')} role="group">{(['allocations','categories','rewards'] as const).map(level => <button key={level} aria-pressed={shown===level} onClick={() => changeLevels(level)}>{level==='allocations'?t('Allocations','Raspodjela'):level==='categories'?t('Categories','Kategorije'):t('All rewards','Sve nagrade')}</button>)}</div>
      <div className={s.zoom}><button onClick={zoomOut} disabled={!canZoomOut} aria-label={t('Zoom out', 'Smanji prikaz')}><Minus size={14}/></button><button onClick={fit} aria-label={t('Fit entire distribution', 'Prikaži cijelu raspodjelu')}>{zoom===1?t('Fit','Cijeli prikaz'):`${Math.round(zoom*100)}%`}</button><button onClick={zoomIn} disabled={!canZoomIn} aria-label={t('Zoom in', 'Povećaj prikaz')}><Plus size={14}/></button></div>
    </div>
    <div className={s.body}>
      <div className={s.canvas}>
        <div ref={viewportRef} {...handlers} data-dragging={dragging} className={s.viewport} tabIndex={0} role="region" aria-label={t('Reward distribution chart. Zoom and scroll to explore.', 'Graf raspodjele nagrada. Povećajte i pomičite prikaz.')}>
          <svg viewBox={`0 0 ${graph.size} ${graph.size}`} style={{width:`${zoom*100}%`}} aria-label={`${tree.label}: ${amount(tree)} test MON`} role="group">
            <DistributionDiagram graph={graph} path={path} selectedId={node.id} hr={hr} maxDepth={maxDepth} open={open} back={back}/>
          </svg>
        </div>
        <p className={s.hint}>{t('Pot → allocations → categories → rewards, ordered outward by place', 'Fond → raspodjela → kategorije → nagrade, prema van po plasmanu')}</p>
      </div>
      <aside className={s.details}><div className={s.detailHeading}><div><small>{t('Exploring', 'Pregled')}</small><h3>{node.label}</h3></div>{path.length ? <button onClick={() => back(ancestors.length-2)} aria-label={t('Back one level', 'Natrag jednu razinu')}><ArrowLeft size={16}/></button> : null}</div>
        {path.length ? <p className={s.selectedAmount}><strong>{amount(node)}</strong> test MON</p> : null}
        {node.children.length ? <ul className={s.items}>{visible.map(child => <li key={child.id}><button onClick={() => open(child)}><i data-status={child.status ?? child.level}/><span><strong>{child.label}</strong><small>{child.level === 'winner' ? state(child) : `${prizePercent(child.amountWei,node.amountWei)}% ${t('of this pool','ovog fonda')}`}</small></span><b>{amount(child)}<small>test MON</small></b><ChevronRight size={14}/></button></li>)}</ul> : <div className={s.leaf}><strong>{state(node)}</strong>{node.reference ? <><p>{t('Public award reference', 'Javna oznaka nagrade')}</p><code>{node.reference}</code><p>{t('This circle shows this category’s share of the winner’s reward. The ledger combines their shares into one payment.', 'Krug prikazuje udio ove kategorije u nagradi dobitnika. Pregled spaja udjele u jednu isplatu.')}</p></> : <p>{node.level === 'reserve' ? t('Kept in the pool without a winner allocation.', 'Zadržano u fondu bez raspodjele dobitniku.') : busy ? t('Verifying winners…', 'Provjera dobitnika…') : failed ? t('Winner status unavailable. Retry below.', 'Stanje dobitnika nije dostupno. Pokušajte ponovno ispod.') : t('Winner breakdown is not available for this category yet.', 'Raspodjela dobitnicima još nije dostupna za ovu kategoriju.')}</p>}</div>}
        {node.children.length>8?<div className={s.paging}><button aria-label={t('Previous details', 'Prethodni detalji')} disabled={offset===0} onClick={() => setOffset(n=>Math.max(0,n-8))}><ArrowLeft size={14}/></button><span>{offset+1}–{Math.min(offset+8,node.children.length)} / {node.children.length}</span><button aria-label={t('Next details', 'Sljedeći detalji')} disabled={offset+8>=node.children.length} onClick={() => setOffset(n=>n+8)}><ArrowRight size={14}/></button></div>:null}
        {path.length > 0 && positions.has(node.id) ? <button className={s.focusSelection} onClick={() => {const point=positions.get(node.id)!; focusPoint(point.x, point.y, graph.size);}}>{t('Focus selection', 'Približi odabrano')}</button> : null}
        <p className={s.helper}>{t('Scroll the mouse wheel to zoom. Drag to pan; click a circle for details. Circle sizes show levels, not amounts.', 'Kotačićem miša povećajte ili smanjite prikaz. Povucite za pomicanje; kliknite krug za detalje. Veličine krugova označavaju razine, a ne iznose.')}</p>
      </aside>
    </div>
  </section>;
}

// Zoom and pan update the viewport only. Keep thousands of SVG labels/paths out
// of those React updates; selection and new reward data still update the diagram.
const DistributionDiagram = memo(function DistributionDiagram({graph, path, selectedId, hr, maxDepth, open, back}: {
  graph: ReturnType<typeof radialDistribution>; path: string[]; selectedId: string; hr: boolean; maxDepth: number;
  open: (child: DistributionNode, childPath: string[]) => void; back: (index: number) => void;
}) {
  const positions = useMemo(() => new Map(graph.nodes.map(entry => [entry.node.id, entry])), [graph]);
  const t = (en: string, local: string) => hr ? local : en;
  const amount = (n: DistributionNode) => setupAmount(n.amountWei, hr);
  const state = (n: DistributionNode) => n.status === 'claimed' ? t('Claimed', 'Preuzeto') : n.status === 'unclaimed' ? t('Unclaimed', 'Nepreuzeto') : n.status === 'planned' ? t('Planned', 'Planirano') : n.level === 'reserve' ? t('Unallocated', 'Neraspoređeno') : t('Saved budget', 'Spremljeni fond');
  return <>
            {graph.rings.map((r,i) => <circle key={i} className={s.orbit} cx={graph.size/2} cy={graph.size/2} r={r}/>)}
            {graph.nodes.filter(entry => entry.parentId).map(entry => {const parent=positions.get(entry.parentId!)!;return <path key={entry.node.id} className={s.connector} data-active={path.includes(entry.node.id)} d={`M${parent.x} ${parent.y} L${entry.x} ${entry.y}`}/>;})}
            {graph.nodes.map(entry => {const child=entry.node, root=entry.depth===0, selected=child.id===selectedId;return <g key={child.id} className={root?s.center:s.node} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${child.label}, ${amount(child)} test MON, ${state(child)}`} onClick={() => root?back(0):open(child,entry.path)} onKeyDown={e => {if(e.key==='Enter'||e.key===' '){e.preventDefault();if(root)back(0);else open(child,entry.path);}}} data-status={child.status ?? child.level} data-depth={entry.depth} transform={`translate(${entry.x} ${entry.y})`}>
              <title>{`${child.label} · ${amount(child)} test MON · ${state(child)}`}</title>
              <circle r={entry.radius}/>
              <text className={root?s.centerLabel:s.nodeLabel} y={root?-23:-14} textLength={!root&&child.label.length>11?entry.radius*1.72:undefined} lengthAdjust="spacingAndGlyphs">{child.label.length>18?child.label.slice(0,16)+'…':child.label}</text>
              <text className={root?s.centerAmount:s.nodeAmount} y={root?10:7} textLength={amount(child).length>(root?7:7)?entry.radius*1.65:undefined} lengthAdjust="spacingAndGlyphs">{amount(child)}</text>
              <text className={root?s.centerUnit:s.unit} y={root?29:21}>test MON</text>
              {child.status==='claimed'?<text className={s.statusMark} x={entry.radius*.75} y={-entry.radius*.6}>✓</text>:child.status==='unclaimed'?<text className={s.statusMark} x={entry.radius*.75} y={-entry.radius*.6}>○</text>:null}
              {child.children.length && entry.depth>=maxDepth?<text className={s.expand} x={entry.radius*.75} y={-entry.radius*.6}>+</text>:null}
            </g>;})}
  </>;
});
