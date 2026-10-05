import {CampaignSponsor, CampaignSponsorProvider} from '../components/CampaignSponsor';
import {useEffect, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {ArrowLeft, Copy, ArrowUpDown, ArrowRight, RefreshCw, ShieldCheck} from 'lucide-react';
import type {PublicSponsorCampaign as Campaign} from '@raceson/domain/rewards/public-campaign';
import {campaignStatus, campaignSum, type DirectoryCampaign} from '@raceson/domain/rewards/public-directory';
import {useI18n} from '@/shared/i18n/I18nContext';
import {useAuth} from '@/lib/auth';
import {ApiError} from '@/lib/api';
import {readPublicCampaign} from '../data/publicCampaign';
import {sponsorColors} from '../model/sponsorCatalogue';
import {setupAmount} from '../model/setupAmount';
import {prizePercent} from '../model/prizeDisplay';
import {statusLabel} from '../model/podiumDirectory';
import {resultsHandoffLink, rewardsControlLink} from '../model/controllerLinks';
import PublicRewardTable from '../components/PublicRewardTable';
import RewardExplorerLink from '../components/RewardExplorerLink';
import s from '../components/Podium.module.css';
import detail from './PublicSponsorCampaign.module.css';

const categoryColors = [...sponsorColors, '#6f8d9b'];
type ChartRow = {label: string; value: string; color: string};
function CampaignChart({title, description, rows, total, hr}: {title: string; description: string; rows: ChartRow[]; total: string; hr: boolean}) {
  return <section className={detail.chart}>
    <h2>{title}</h2>
    <div className={detail.bar} role="img" aria-label={`${description}. ${rows.map(row => `${row.label}: ${setupAmount(BigInt(row.value), hr)} test MON`).join('; ')}`}>
      {rows.map(row => <span key={row.label} style={{width: `${prizePercent(BigInt(row.value), BigInt(total))}%`, background: row.color}}/>)}
    </div>
    <table className={detail.legend}><caption className="sr-only">{description}</caption><tbody>{rows.map(row => <tr key={row.label}>
      <th scope="row"><i aria-hidden="true" style={{background: row.color}}/>{row.label}</th>
      <td>{setupAmount(BigInt(row.value), hr)} <small>test MON</small></td>
      <td>{prizePercent(BigInt(row.value), BigInt(total))}%</td>
    </tr>)}</tbody></table>
  </section>;
}

export default function PublicSponsorCampaign() {
  const {id = ''} = useParams(), {locale} = useI18n(), auth = useAuth(), hr = locale === 'hr';
  const t = (en: string, local: string) => hr ? local : en;
  const [campaign, setCampaign] = useState<Campaign | null>(null), [failure, setFailure] = useState<'missing' | 'unavailable' | null>(null);
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(true), [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  const [params, setParams] = useSearchParams(), selected = params.get('pot');
  const [sort, setSort] = useState<'name' | 'amount'>('amount'), [descending, setDescending] = useState(true);
  useEffect(() => {setCampaign(null); setCopied(false); setCopyFailed(false);}, [id]);
  useEffect(() => {
    const abort = new AbortController(); setBusy(true); setFailure(null);
    void readPublicCampaign(id, abort.signal).then(c => {if (!abort.signal.aborted) setCampaign(c);})
      .catch(e => {if (!abort.signal.aborted) setFailure(e instanceof ApiError && e.status === 404 ? 'missing' : 'unavailable');})
      .finally(() => {if (!abort.signal.aborted) setBusy(false);});
    return () => abort.abort();
  }, [id, attempt]);
  if (!campaign) return <article className={s.page}>
    <Link className={s.back} to="/rewards/campaigns"><ArrowLeft size={16}/>{t('Campaigns', 'Kampanje')}</Link><h1>{t('Campaign', 'Kampanja')}</h1>
    {failure ? <div className={s.empty} role="alert"><p>{failure === 'missing' ? t('This campaign has not completed setup yet.', 'Postavljanje ove kampanje još nije dovršeno.') : t('Campaign status is temporarily unavailable. Try again.', 'Stanje kampanje trenutačno nije dostupno. Pokušajte ponovno.')}</p><button className={s.secondary} onClick={() => setAttempt(n => n + 1)}>{t('Try again', 'Pokušaj ponovno')}</button></div> : <p role="status">{t('Loading campaign and confirmed funding…', 'Učitavanje kampanje i potvrđene uplate…')}</p>}
  </article>;
  const item: DirectoryCampaign = {campaign, verified: true, selection: null, publishedAt: new Date(Number(campaign.blockTimestamp) * 1000).toISOString()};
  const pot = selected === null ? campaign.pots[0] : params.getAll('pot').length === 1 ? campaign.pots.find(p => String(p.slot) === selected) : undefined;
  const amount = (value: string | bigint) => `${setupAmount(BigInt(value), hr)} test MON`;
  const groups = (pot?.groups ?? []).map((g, i) => ({...g, id: i, color: categoryColors[i % categoryColors.length]})).sort((a, b) => {
    const n = sort === 'name' ? a.name.localeCompare(b.name) : BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : BigInt(a.amountWei) > BigInt(b.amountWei) ? 1 : 0;
    return (descending ? -n : n) || a.id - b.id;
  });
  const changeSort = (key: 'name' | 'amount') => {setSort(key); setDescending(sort === key ? !descending : key === 'amount');};
  const potLabel = (slot: number) => campaign.pots.length === 1 ? campaign.pots[0].name : slot === 0 ? t('League', 'Liga') : `${t('Round', 'Kolo')} ${slot}`;
  const select = (slot: string) => setParams(p => {const next = new URLSearchParams(p); next.set('pot', slot); return next;}, {replace: true});
  const metrics = [
    {label: t('Total campaign budget', 'Ukupan proračun kampanje'), value: campaign.budgetWei, note: t('Saved rule', 'Spremljeno pravilo')},
    {label: t('Selected prize pool', 'Odabrani fond nagrada'), value: pot?.amountWei, note: pot ? potLabel(pot.slot) : t('Choose a prize pot', 'Odaberite fond nagrada')},
    {label: t('Confirmed funding', 'Potvrđene uplate'), value: pot?.amountWei, note: t('On-chain · selected pot', 'Na lancu · odabrani fond')},
    {label: t('Funds still held', 'Preostala sredstva'), value: pot?.remainingWei, note: t('After payments & returns', 'Nakon isplata i povrata')},
    {label: t('Confirmed payments', 'Potvrđene isplate'), value: pot?.paidWei, note: t('Claimed only', 'Samo preuzete nagrade')},
  ];
  return <article className={`${s.page} ${detail.page}`}>
    <CampaignSponsorProvider><header className={detail.heading}>
      <div><div className={detail.eyebrow}><CampaignSponsor id={id} hr={hr} compact/></div><h1>{campaign.name}</h1><Link className={detail.subtitle} to="/rewards/campaigns">{t('All campaigns', 'Sve kampanje')} <ArrowRight size={14}/></Link></div>
      <span className={s.badge} data-state={campaignStatus(item)}>{statusLabel(item, hr)}</span>
    </header>
    <section className={detail.sponsor} aria-label={t('Sponsor', 'Sponzor')}>
      <CampaignSponsor id={id} hr={hr} backing={campaign.name}/>
      <dl className={detail.sponsorMetrics}>{[
        [t('Campaign budget', 'Proračun kampanje'), campaign.budgetWei],
        [t('Prize pool', 'Fond nagrada'), pot?.amountWei],
        [t('Deposited', 'Uplaćeno'), campaign.budgetWei],
        [t('Returned funds', 'Vraćena sredstva'), campaignSum(campaign, 'returnedWei')],
      ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value === undefined ? '—' : <>{setupAmount(BigInt(value), hr)} <small>test MON</small></>}</dd></div>)}</dl>
      <div className={detail.sponsorFooter}><p>{t('Sponsor-funded rewards on RacesOn.', 'Nagrade na RacesOnu koje financira sponzor.')}</p><div><Link className={detail.smallButton} to="/athlete/rewards">{t('My rewards', 'Moje nagrade')}<ArrowRight size={14}/></Link><button className={detail.smallButton} onClick={() => {void navigator.clipboard.writeText(location.href).then(() => {setCopied(true); setCopyFailed(false);}).catch(() => setCopyFailed(true));}}><Copy size={14}/>{copied ? t('Link copied', 'Poveznica kopirana') : t('Share', 'Podijeli')}</button></div></div>
    </section></CampaignSponsorProvider>
    {copied ? <p role="status">{t('Campaign link copied.', 'Poveznica kampanje je kopirana.')}</p> : null}
    {copyFailed ? <p role="alert">{t('Copy the page address from your browser to share this campaign.', 'Kopirajte adresu stranice iz preglednika za dijeljenje kampanje.')}</p> : null}
    <section aria-label={t('Totals', 'Ukupno')}>
      {campaign.pots.length > 1 || !pot ? <div className={detail.potPicker}>
        <label className={detail.mobilePot}>{t('Prize pot', 'Fond nagrada')}<select aria-label={t('Select prize pot', 'Odaberi fond nagrada')} value={pot?.slot ?? ''} onChange={e => select(e.target.value)}>{!pot ? <option value="" disabled>{t('Choose a prize pot', 'Odaberite fond nagrada')}</option> : null}{campaign.pots.map(p => <option key={p.slot} value={p.slot}>{potLabel(p.slot)} · {amount(p.amountWei)}</option>)}</select></label>
        <div className={detail.potButtons} role="group" aria-label={t('Prize pots', 'Fondovi nagrada')}>{campaign.pots.map(p => <button key={p.slot} aria-pressed={p.slot === pot?.slot} onClick={() => select(String(p.slot))} title={p.name} aria-label={`${potLabel(p.slot)} · ${amount(p.amountWei)}`}>{potLabel(p.slot)} <small>{setupAmount(BigInt(p.amountWei), hr)}</small></button>)}</div>
      </div> : null}
      {!pot ? <div className={s.notice} role="alert"><h3>{t('Prize pot not found', 'Fond nagrada nije pronađen')}</h3><p>{t('This link does not identify an available prize pot. Choose one above to view its allocation and payments.', 'Ova poveznica ne upućuje na dostupan fond nagrada. Odaberite fond iznad za pregled raspodjele i isplata.')}</p></div> : null}
      <dl className={detail.metrics}>{metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value === undefined ? '—' : <>{setupAmount(BigInt(metric.value), hr)} <small>test MON</small></>}</dd><p>{metric.note}</p></div>)}</dl>
      <div className={detail.verification}><ShieldCheck size={16}/><span>{t('Last verified', 'Posljednja provjera')}: {new Date(Number(campaign.blockTimestamp) * 1000).toLocaleString(hr ? 'hr-HR' : 'en-GB')}</span><button className={detail.smallButton} disabled={busy} aria-label={t('Refresh status', 'Osvježi stanje')} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={14}/>{busy ? t('Refreshing…', 'Osvježavanje…') : t('Refresh', 'Osvježi')}</button></div>
      {failure ? <p role="alert">{t('Refresh failed. Showing the last verified status below.', 'Osvježavanje nije uspjelo. Prikazano je posljednje provjereno stanje.')}</p> : null}
    </section>
    {pot ? <>
      <div className={detail.charts}>
        <CampaignChart title={t('Payment progress', 'Napredak isplata')} description={`${t('Payment progress of the selected prize pool', 'Napredak isplata odabranog fonda')} · ${potLabel(pot.slot)}`} hr={hr} total={pot.amountWei} rows={[
          {label: t('Paid', 'Isplaćeno'), value: pot.paidWei, color: '#f56617'},
          {label: t('Held in contract', 'U ugovoru'), value: pot.remainingWei, color: '#241f1b'},
          {label: t('Returned', 'Vraćeno'), value: pot.returnedWei, color: '#d9b38c'},
        ]}/>
        <CampaignChart title={t('Prize pool allocation', 'Raspodjela fonda nagrada')} description={t('Allocation of the campaign prize budget', 'Raspodjela proračuna kampanje')} hr={hr} total={campaign.budgetWei} rows={campaign.pots.map((p, i) => ({label: potLabel(p.slot), value: p.amountWei, color: categoryColors[i % categoryColors.length]}))}/>
      </div>
      <section className={detail.awards} aria-label={t('Selected prize pot', 'Odabrani fond')}>
        <PublicRewardTable key={`${id}:${pot.slot}`} id={id} slot={pot.slot} hr={hr} refresh={attempt} title={t('Reward ledger', 'Pregled nagrada')} subtitle={potLabel(pot.slot) === pot.name ? pot.name : `${potLabel(pot.slot)} · ${pot.name}`}/>
      </section>
      <details key={pot.slot} className={detail.budgets} open={pot.allocatedWei === '0'}><summary><span>{t('Saved category budgets', 'Spremljeni fondovi kategorija')}</span><span className={detail.summaryAmount}>{potLabel(pot.slot)} · {amount(pot.amountWei)}</span></summary><div className={detail.disclosureBody}>
        <div className={s.scroll}><table className={`${s.table} ${detail.categories}`}><caption className="sr-only">{t('Saved category budgets', 'Spremljeni fondovi kategorija')}</caption><thead><tr><th scope="col" aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort('name')}>{t('Category', 'Kategorija')}<ArrowUpDown size={14}/></button></th><th scope="col" aria-sort={sort === 'amount' ? descending ? 'descending' : 'ascending' : 'none'}><button onClick={() => changeSort('amount')}>{t('Budget', 'Fond')}<ArrowUpDown size={14}/></button></th></tr></thead><tbody>{groups.map(g => <tr key={g.id}><td><span className={detail.category}><i aria-hidden="true" style={{background: g.color}}/>{g.name}</span></td><td>{amount(g.amountWei)}</td></tr>)}</tbody></table></div><p className={s.muted}>{t('These are the saved budget splits. Individual awards depend on approved results.', 'Ovo su spremljeni udjeli proračuna. Pojedinačne nagrade ovise o odobrenim rezultatima.')}</p>
      </div></details>
    </> : null}
    <details className={detail.receipts}><summary>{t('Receipts & verification', 'Potvrde i provjera')}</summary><dl className={detail.receiptRows}>
      <div><dt>{t('Network', 'Mreža')}</dt><dd>{campaign.chainId === 10143 ? 'Monad testnet' : t('Local test chain', 'Lokalni testni lanac')} · test MON</dd></div>
      <div><dt>{t('Reward contract', 'Ugovor nagrada')}</dt><dd><RewardExplorerLink chainId={campaign.chainId} kind="address" value={campaign.address}>{campaign.address}</RewardExplorerLink></dd></div>
      <div><dt>{t('Deposit receipt', 'Potvrda uplate')}</dt><dd><RewardExplorerLink chainId={campaign.chainId} kind="tx" value={campaign.fundingHash}>{t('View deposit receipt ↗', 'Pogledaj potvrdu uplate ↗')}</RewardExplorerLink></dd></div>
      <div><dt>{t('Finalized block', 'Finalizirani blok')}</dt><dd>{campaign.blockNumber}</dd></div>
      {pot ? <><div><dt>{t('Approved allocation', 'Odobrena raspodjela')}</dt><dd>{amount(pot.allocatedWei)}</dd></div><div><dt>{t('Claim deadline', 'Rok za preuzimanje')}</dt><dd>{pot.claimDeadline === '0' ? t('Not set', 'Nije postavljen') : new Date(Number(pot.claimDeadline) * 1000).toLocaleString(hr ? 'hr-HR' : 'en-GB')}</dd></div></> : null}
      <div><dt>{t('Privacy', 'Privatnost')}</dt><dd>{t('Recipient identities and consents are never shown publicly.', 'Identiteti i privole primatelja nikad se ne prikazuju javno.')}</dd></div>
    </dl><p className={detail.receiptNote}>{t('Approval is separate from payment. Athletes and clubs explicitly claim their rewards.', 'Odobrenje je odvojeno od isplate. Sportaši i klubovi izričito preuzimaju nagrade.')}</p></details>
    {pot && auth.account?.hasOrganizerAccess ? <details className={s.history}><summary>{t('RacesOn team · confirm results', 'RacesOn tim · potvrdi rezultate')}</summary><div className={s.toolbar}><Link className={s.secondary} to={resultsHandoffLink(campaign.id, pot.slot)}>{t('Review official results', 'Pregledaj službene rezultate')}</Link><a className={s.primary} href={rewardsControlLink(campaign.id, pot.slot)}>{t('Review & sign in Rewards Control', 'Pregledaj i potpiši u Rewards Controlu')}</a></div></details> : null}
  </article>;
}
