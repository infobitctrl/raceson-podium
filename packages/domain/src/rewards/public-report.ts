import { previewRewardRankSlotsV2 } from "./programme-draft-v2.js";
/** Public, dated reports. This is a read model, never a payment instruction. */
export type PublicPrizeCategory = { id:string; name:string; budgetWei:string; slots:Array<{position:number;weight:number;amountWei:string}> };
export type PublicPoolAward = { recipientId:string; amountWei:string; position?:number|null; categoryId?:string|null };
export type PublicRewardRow = {
  recipientId: string; name: string; kind: "athlete" | "club"; amountWei: string;
  claim: "not_submitted" | "submitted";
  payment: "not_paid" | "processing" | "paid";
  transactionHash: string | null; paidAt: string | null;
};
export type PublicRewardPot = {
  id: string; slot: number; name: string; budgetWei: string; approvedAt: string;
  pools: Array<{ key: string; budgetWei: string; awards?: PublicPoolAward[]; categories?:PublicPrizeCategory[] }>;
  rows: PublicRewardRow[];
};
export type PublicRewardProgramme = {
  id: string; name: string; host: string; chainId: 10143;
  source: "synthetic"; status: "distributing" | "completed";
  pots: PublicRewardPot[];
};
export type PublicRewardReport = {
  schema: "raceson-public-reward-report-v1" | "raceson-public-reward-report-v2" | "raceson-public-reward-report-v3"; observedAt: string;
  programmes: PublicRewardProgramme[];
};
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_public_reward_report"); }
function object(v: unknown, keys: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v));
  const r = v as Record<string, unknown>;
  check(Object.keys(r).sort().join() === [...keys].sort().join()); return r;
}
function list(v: unknown, max: number): unknown[] { check(Array.isArray(v) && v.length <= max); return v; }
function label(v: unknown): string { check(typeof v === "string" && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v)); return v; }
function slug(v: unknown) { const s = label(v); check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)); return s; }
function amount(v: unknown): string { check(typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n); return v; }
function time(v: unknown): string { check(typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v); return v; }
function unique(values: string[]) { check(new Set(values).size === values.length); }
export function publicRewardTotals(pots: PublicRewardPot[]) {
  const rows = pots.flatMap(p => p.rows);
  const budget = pots.reduce((n,p) => n + BigInt(p.budgetWei), 0n);
  const allocated = rows.reduce((n,r) => n + BigInt(r.amountWei), 0n);
  const paid = rows.filter(r => r.payment === "paid").reduce((n,r) => n + BigInt(r.amountWei), 0n);
  return { budget, allocated, paid, unpaid: allocated - paid, unallocated: budget - allocated,
    athletes: new Set(rows.filter(r => r.kind === "athlete").map(r => r.recipientId)).size,
    clubs: new Set(rows.filter(r => r.kind === "club").map(r => r.recipientId)).size };
}
export function decodePublicRewardReport(value: unknown): PublicRewardReport {
  const r = object(value, ["schema", "observedAt", "programmes"]);
  check(r.schema === "raceson-public-reward-report-v1" || r.schema === "raceson-public-reward-report-v2" || r.schema === "raceson-public-reward-report-v3"); const observedAt = time(r.observedAt);
  const ranked = r.schema === "raceson-public-reward-report-v3", breakdown = r.schema !== "raceson-public-reward-report-v1";
  const programmes = list(r.programmes, 50).map(raw => {
    const p = object(raw, ["id", "name", "host", "chainId", "source", "status", "pots"]);
    check(p.chainId === 10143 && p.source === "synthetic" && ["distributing", "completed"].includes(String(p.status)));
    const identities = new Map<string,string>(); const receipts: string[] = [];
    const pots = list(p.pots, 100).map(rawPot => {
      const pot = object(rawPot, ["id", "slot", "name", "budgetWei", "approvedAt", "pools", "rows"]);
      check(Number.isSafeInteger(pot.slot) && Number(pot.slot) > 0 && Number(pot.slot) <= 100);
      const approvedAt = time(pot.approvedAt); check(approvedAt <= observedAt);
      const pools = list(pot.pools, 20).map(rawPool => {
        const pool = object(rawPool, ranked ? ["key","budgetWei","awards","categories"] : breakdown ? ["key", "budgetWei", "awards"] : ["key", "budgetWei"]);
        check(["athlete_standings", "club_standings", "participation"].includes(String(pool.key)));
        const categories = ranked ? list(pool.categories,100).map(rawCategory=>{
          const c=object(rawCategory,["id","name","budgetWei","slots"]),budgetWei=amount(c.budgetWei);
          const slots=list(c.slots,25).map((rawSlot,i)=>{
            const s=object(rawSlot,["position","weight","amountWei"]);
            check(s.position===i+1&&Number.isSafeInteger(s.weight)&&Number(s.weight)>0&&Number(s.weight)<=1000000);
            return {position:i+1,weight:Number(s.weight),amountWei:amount(s.amountWei)};
          });
          check(slots.length===10||slots.length===25);
          const expected=previewRewardRankSlotsV2(BigInt(budgetWei),slots.map(s=>s.weight));
          check(slots.every((s,i)=>s.amountWei===String(expected[i].amountWei)));
          return {id:slug(c.id),name:label(c.name),budgetWei,slots};
        }) : undefined;
        if(categories){unique(categories.map(c=>c.id));check(categories.reduce((n,c)=>n+BigInt(c.budgetWei),0n)<=BigInt(amount(pool.budgetWei)));check(pool.key!=="participation"||categories.length===0);}
        const awards = breakdown ? list(pool.awards,10000).map(rawAward => {
          const award = object(rawAward,ranked?["recipientId","amountWei","position","categoryId"]:["recipientId","amountWei"]);
          const amountWei = amount(award.amountWei); check(BigInt(amountWei)>0n);
          if(ranked){
            if(pool.key==="participation")check(award.position===null&&award.categoryId===null);
            else check(Number.isSafeInteger(award.position)&&Number(award.position)>0&&categories!.some(c=>c.id===award.categoryId&&c.slots.some(s=>s.position===award.position)));
          }
          return {recipientId:slug(award.recipientId),amountWei,...(ranked?{position:award.position as number|null,categoryId:award.categoryId as string|null}:{})};
        }) : undefined;
        if (awards) unique(awards.map(a=>a.recipientId));
        if(categories&&awards)for(const c of categories)check(awards.filter(a=>a.categoryId===c.id).reduce((n,a)=>n+BigInt(a.amountWei),0n)<=BigInt(c.budgetWei));
        return { key: String(pool.key), budgetWei: amount(pool.budgetWei), ...(awards ? {awards} : {}),...(categories?{categories}:{}) };
      }); unique(pools.map(pool => pool.key));
      const rows = list(pot.rows, 10000).map(rawRow => {
        const row = object(rawRow, ["recipientId", "name", "kind", "amountWei", "claim", "payment", "transactionHash", "paidAt"]);
        check(["athlete", "club"].includes(String(row.kind)) && ["not_submitted", "submitted"].includes(String(row.claim))
          && ["not_paid", "processing", "paid"].includes(String(row.payment)));
        const recipientId = slug(row.recipientId), name = label(row.name), amountWei = amount(row.amountWei);
        check(BigInt(amountWei) > 0n);
        const identity = `${row.kind}:${name}`;
        check(!identities.has(recipientId) || identities.get(recipientId) === identity); identities.set(recipientId, identity);
        check((row.payment === "paid") === (row.transactionHash !== null) && (row.payment === "paid") === (row.paidAt !== null));
        if (row.payment !== "not_paid") check(row.claim === "submitted");
        if (row.payment === "paid") {
          check(typeof row.transactionHash === "string" && /^0x[0-9a-f]{64}$/.test(row.transactionHash) && BigInt(row.transactionHash) > 0n);
          check(time(row.paidAt) >= approvedAt && time(row.paidAt) <= observedAt); receipts.push(row.transactionHash);
        }
        return { ...row, recipientId, name, amountWei } as PublicRewardRow;
      }); unique(rows.map(row => row.recipientId));
      const result = { id: slug(pot.id), slot: Number(pot.slot), name: label(pot.name), budgetWei: amount(pot.budgetWei), approvedAt, pools, rows };
      check(publicRewardTotals([result]).unallocated >= 0n);
      check(pools.reduce((n,pool) => n + BigInt(pool.budgetWei),0n) === BigInt(result.budgetWei));
      if (breakdown) {
        const sums = new Map<string,bigint>();
        const recipients = new Map(rows.map(row=>[row.recipientId,row]));
        for (const pool of pools) {
          check(pool.awards!.reduce((n,a)=>n+BigInt(a.amountWei),0n)<=BigInt(pool.budgetWei));
          for (const award of pool.awards!) {
            const recipient = recipients.get(award.recipientId);
            check(recipient && recipient.kind === (pool.key === "club_standings" ? "club" : "athlete"));
            sums.set(award.recipientId,(sums.get(award.recipientId)??0n)+BigInt(award.amountWei));
          }
        }
        for (const row of rows) check(sums.get(row.recipientId)===BigInt(row.amountWei));
      }
      return result;
    });
    unique(pots.map(pot => pot.id)); unique(pots.map(pot => String(pot.slot))); unique(receipts);
    check(p.status !== "completed" || pots.length > 0 && publicRewardTotals(pots).unpaid === 0n);
    return { id: slug(p.id), name: label(p.name), host: label(p.host), chainId: 10143 as const,
      source: "synthetic" as const, status: p.status as PublicRewardProgramme["status"], pots };
  }); unique(programmes.map(p => p.id));
  return { schema: r.schema, observedAt, programmes };
}

/** Split amounts are exact approved components; settlement belongs to the combined pot award. */
export function publicRewardPool(pot: PublicRewardPot, key: string): PublicRewardPot | undefined {
  const pool = pot.pools.find(p=>p.key===key);
  if (!pool?.awards) return undefined;
  const amounts = new Map(pool.awards.map(a=>[a.recipientId,a.amountWei]));
  return {...pot,budgetWei:pool.budgetWei,pools:[pool],rows:pot.rows.filter(r=>amounts.has(r.recipientId)).map(r=>({...r,amountWei:amounts.get(r.recipientId)!}))};
}
