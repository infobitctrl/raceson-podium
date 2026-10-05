/** Synthetic calculation only. No real recipients, wallets or chain writes. */
export type TestProgrammeConfiguration = {
  name: string; budgetMon: number; order: number[][]; rule: "equal" | "rank";
  approved: boolean; claims: Record<string, "claimed" | "paid">;
};
export type SavedTestProgramme = {
  id: string; chainId: 10143 | 31337; revision: number;
  configuration: TestProgrammeConfiguration; updatedAt: string;
};
function check(v: unknown): asserts v { if (!v) throw new Error("invalid_test_programme"); }
function object(v: unknown, keys?: string[]) {
  check(v && typeof v === "object" && !Array.isArray(v)); const r=v as Record<string,unknown>;
  if(keys)check(Object.keys(r).sort().join() === [...keys].sort().join()); return r;
}
export function testProgrammeId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v) && BigInt(`0x${v.replaceAll("-","")}`)>0n;
}
export function decodeTestProgrammeConfiguration(value: unknown): TestProgrammeConfiguration {
  const c=object(value,["name","budgetMon","order","rule","approved","claims"]);
  check(typeof c.name === "string" && c.name.trim()===c.name && c.name.length>0 && c.name.length<=100 && !/[\u0000-\u001f\u007f]/.test(c.name));
  check(Number.isSafeInteger(c.budgetMon) && Number(c.budgetMon)>=1 && Number(c.budgetMon)<=1000000 && ["rank","equal"].includes(String(c.rule)) && typeof c.approved === "boolean");
  check(Array.isArray(c.order) && c.order.length>=1 && c.order.length<=5 && Array.isArray(c.order[0]));
  const count=c.order[0].length;
  check(count>=2 && count<=20);
  const order=c.order.map(row=>{
    check(Array.isArray(row) && row.length===count && new Set(row).size===count && row.every(n=>Number.isInteger(n)&&n>=0&&n<count));
    return [...row] as number[];
  });
  const claims=object(c.claims);check(Object.keys(claims).length<=order.length*count && (c.approved || Object.keys(claims).length===0));
  for(const [key,state] of Object.entries(claims)) {
    check(/^[0-4]:(?:[0-9]|1[0-9])$/.test(key) && ["claimed","paid"].includes(String(state)));
    const [round,athlete]=key.split(":").map(Number);check(round<order.length && athlete<count);
  }
  return {name:c.name,budgetMon:Number(c.budgetMon),order,rule:c.rule as "rank"|"equal",approved:c.approved,claims:{...claims} as TestProgrammeConfiguration["claims"]};
}
export function decodeSavedTestProgramme(value: unknown, chainId?: number, id?: string): SavedTestProgramme {
  const r=object(value,["id","chainId","revision","configuration","updatedAt"]);
  check(testProgrammeId(r.id) && (!id || r.id===id) && [10143,31337].includes(Number(r.chainId)) && typeof r.chainId === "number" && (!chainId || r.chainId===chainId));
  check(Number.isInteger(r.revision) && Number(r.revision)>=1 && Number(r.revision)<=2147483645);
  check(typeof r.updatedAt === "string" && Number.isFinite(Date.parse(r.updatedAt)) && new Date(r.updatedAt).toISOString()===r.updatedAt);
  return {id:r.id,chainId:r.chainId as 10143|31337,revision:Number(r.revision),configuration:decodeTestProgrammeConfiguration(r.configuration),updatedAt:r.updatedAt};
}

export function createTestProgramme(rounds: number, athletes: number) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5 || !Number.isInteger(athletes) || athletes < 2 || athletes > 20) throw new Error("invalid_test_size");
  return Array.from({ length: rounds }, (_, round) => Array.from({ length: athletes }, (_, rank) => (rank + round) % athletes));
}
export function calculateTestProgramme(budgetMon: number, order: number[][], rule: "equal" | "rank") {
  if (!Number.isSafeInteger(budgetMon) || budgetMon < 1 || budgetMon > 1000000 || !order.length || order.length > 5) throw new Error("invalid_test_budget");
  if (rule !== "rank" && rule !== "equal") throw new Error("invalid_test_rule");
  const count = order[0].length;
  if (count < 2 || count > 20 || order.some(row => row.length !== count || new Set(row).size !== count || row.some(id => !Number.isInteger(id) || id < 0 || id >= count))) throw new Error("invalid_test_results");
  const budget = BigInt(budgetMon) * 10n ** 18n;
  const roundBudgets = order.map((_, round) => budget / BigInt(order.length) + (BigInt(round) < budget % BigInt(order.length) ? 1n : 0n));
  const allocations = order.map((ranking, round) => {
    const weights = ranking.map((_, rank) => BigInt(rule === "equal" ? 1 : count - rank));
    const sum = weights.reduce((a,b)=>a+b,0n);
    const amounts = weights.map(weight => roundBudgets[round] * weight / sum);
    const remainder = roundBudgets[round] - amounts.reduce((a,b)=>a+b,0n);
    const byRemainder = weights.map((w,rank)=>({rank,remainder:roundBudgets[round]*w%sum})).sort((a,b)=>a.remainder>b.remainder?-1:a.remainder<b.remainder?1:a.rank-b.rank);
    for(let i=0;i<Number(remainder);i++) amounts[byRemainder[i].rank] += 1n;
    return ranking.map((athlete,rank)=>({athlete,round,rank:rank+1,amount:amounts[rank]}));
  });
  return {budget,roundBudgets,allocations,totals:Array.from({length:count},(_,athlete)=>allocations.flat().filter(row=>row.athlete===athlete).reduce((sum,row)=>sum+row.amount,0n))};
}
