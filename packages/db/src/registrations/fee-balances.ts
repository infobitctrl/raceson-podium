import { createAdminSupabaseClient } from "../supabase.js";
import type { ServerEnv } from "../env.js";

type Quote = { total_cents: number; currency: string; state: string };
export function registrationFeeBalance(status: string, quote: Quote | undefined, collected: number) {
  const expectedCents = quote && ["pending", "confirmed"].includes(status) && ["active", "accepted"].includes(quote.state)
    ? quote.total_cents : 0;
  const collectedCents = Math.max(0, collected);
  return { expectedCents, collectedCents, outstandingCents: Math.max(0, expectedCents - collectedCents) };
}

/** Quote/ledger amounts only: the current category price never reprices a debt. */
export async function loadRegistrationFeeBalances(rows: Array<{ id: string; status: string; current_quote_id?: string | null }>, env: ServerEnv) {
  const client = createAdminSupabaseClient(env);
  const quoteIds = rows.flatMap(row => row.current_quote_id ? [row.current_quote_id] : []);
  const quotes = new Map<string, Quote>();
  const collected = new Map<string, number>();
  for (let offset = 0; offset < quoteIds.length; offset += 200) {
    const result = await client.from("registration_quotes").select("id,total_cents,currency,state").in("id", quoteIds.slice(offset, offset + 200));
    if (result.error) throw result.error;
    for (const quote of result.data ?? []) quotes.set(quote.id, quote);
  }
  for (let offset = 0; offset < rows.length; offset += 200) {
    const result = await client.from("financial_ledger_entries").select("registration_id,amount_cents,entry_type")
      .in("registration_id", rows.slice(offset, offset + 200).map(row => row.id))
      .in("entry_type", ["charge", "adjustment"]);
    if (result.error) throw result.error;
    for (const entry of result.data ?? []) collected.set(entry.registration_id, (collected.get(entry.registration_id) ?? 0) + entry.amount_cents);
  }
  return new Map(rows.map(row => {
    const quote = row.current_quote_id ? quotes.get(row.current_quote_id) : undefined;
    return [row.id, {
      quotedFeeCents: quote?.total_cents ?? null,
      outstandingCents: quote ? registrationFeeBalance(row.status, quote, collected.get(row.id) ?? 0).outstandingCents : null,
      feeCurrency: quote?.currency ?? null,
    }];
  }));
}
