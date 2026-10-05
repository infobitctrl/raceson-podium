import type {SponsorClaim} from '../data/sponsorProgramme';
import RewardExplorerLink from './RewardExplorerLink';

export default function SponsorClaimTerms({view, hr}: {view: Pick<SponsorClaim, 'claim' | 'context' | 'signing' | 'chainId'>; hr: boolean}) {
  if (!view.claim || !view.context?.verifyingContract) return null;
  const t = (en: string, local: string) => hr ? local : en;
  const seconds = view.claim.expiresAt;
  const date = new Date(Number(seconds) * 1000);
  const expiry = view.chainId === 10143 && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(hr ? 'hr-HR' : 'en-GB', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zagreb'}).format(date)
    : `${seconds} (Unix seconds)`;
  return <details className="my-4 rounded-xl border border-border p-3 text-sm">
    <summary className="cursor-pointer font-medium">{t('Exact claim terms', 'Točni uvjeti preuzimanja')}</summary>
    <dl className="mt-3 space-y-3">
      <div><dt>{t('Claim authorization expires', 'Ovlaštenje za preuzimanje istječe')}</dt><dd>{expiry}{view.chainId === 10143 ? ' · Europe/Zagreb' : ''}</dd></div>
      <div><dt>{t('Reward contract', 'Ugovor nagrade')}</dt><dd className="break-all"><RewardExplorerLink chainId={view.chainId} kind="address" value={view.context.verifyingContract}/></dd></div>
      <div><dt>{t('Award reference', 'Referenca nagrade')}</dt><dd className="break-all font-mono text-xs">{view.claim.entitlementId}</dd></div>
    </dl>
    <p className="mt-3 text-muted-foreground">{t('This authorization deadline is separate from the campaign claim window. A signature does not confirm payment.', 'Ovaj rok ovlaštenja odvojen je od roka preuzimanja kampanje. Potpis ne potvrđuje isplatu.')}</p>
    {view.signing ? <details className="mt-3"><summary className="cursor-pointer">{t('Read the exact message', 'Pročitaj točnu poruku')}</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(view.signing, null, 2)}</pre></details> : null}
  </details>;
}
