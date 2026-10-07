import {setupAmount} from '../model/setupAmount';
import {prizePercent} from '../model/prizeDisplay';
import detail from '../screens/PublicSponsorCampaign.module.css';
type ChartRow = {label: string; value: string; color: string};
export default function CampaignChart({title, description, rows, total, hr, compact=false}: {title: string; description: string; rows: ChartRow[]; total: string; hr: boolean;compact?:boolean}) {
  return <section className={detail.chart} data-compact={compact}>
    <h2>{title}</h2>
    <div className={detail.bar} role="img" aria-label={`${description}. ${rows.map(row => `${row.label}: ${setupAmount(BigInt(row.value), hr)} test MON`).join('; ')}`}>
      {rows.map(row => <span key={row.label} style={{width: `${prizePercent(BigInt(row.value), BigInt(total))}%`, background: row.color}}/>)}
    </div>
    {!compact?<table className={detail.legend}><caption className="sr-only">{description}</caption><tbody>{rows.map(row => <tr key={row.label}>
      <th scope="row"><i aria-hidden="true" style={{background: row.color}}/>{row.label}</th>
      <td>{setupAmount(BigInt(row.value), hr)} <small>test MON</small></td>
      <td>{prizePercent(BigInt(row.value), BigInt(total))}%</td>
    </tr>)}</tbody></table>:null}
  </section>;
}
