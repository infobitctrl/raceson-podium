import type { ReactNode } from "react";
import { rewardExplorerUrl } from "../model/rewardExplorerUrl";
/** Only actual chain identifiers link out. Allocation hashes and private UUIDs
 * are not transactions and must never be sent to an explorer search. */
export default function RewardExplorerLink({chainId,kind,value,children}: {
  chainId:number;kind:"address"|"tx"|"block";value:string|null|undefined;children?:ReactNode;
}) {
  const href=rewardExplorerUrl(chainId,kind,value);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">{children ?? value}</a>
    : <span className="break-all">{children ?? value}</span>;
}
