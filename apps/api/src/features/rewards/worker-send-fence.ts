/** Last synchronous check after a successful SQL arm and immediately before
 * invoking a broadcaster. Never await network IO between this check and send.
 * Requires synchronized worker/DB clocks; cannot revoke already released bytes. */
export function rewardLeaseCanStartSend(lease:{leaseExpiresAt:string|null},now=Date.now()):boolean{
  if(typeof lease.leaseExpiresAt!=="string"||!Number.isFinite(now))return false;
  const expires=Date.parse(lease.leaseExpiresAt);return Number.isFinite(expires)&&expires>now;
}
