// UUID filters must remain small enough for the downstream PostgREST URL.
export const PUBLIC_READ_BATCH_SIZE = 20;
const MAX_CONCURRENT_BATCHES = 4;

/** Load independent public-read batches without a serial waterfall or unbounded fan-out. */
export async function readPublicBatches<Input, Row>(
  values: readonly Input[],
  readBatch: (batch: Input[]) => Promise<Row[]>,
): Promise<Row[]> {
  const count = Math.ceil(values.length / PUBLIC_READ_BATCH_SIZE);
  const results: Row[][] = new Array(count);
  let nextBatch = 0;
  let failed = false;

  async function worker() {
    while (!failed && nextBatch < count) {
      const index = nextBatch++;
      const start = index * PUBLIC_READ_BATCH_SIZE;
      try {
        results[index] = await readBatch(values.slice(start, start + PUBLIC_READ_BATCH_SIZE));
      } catch (error) {
        // Existing requests can settle, but do not start more work after failure.
        failed = true;
        throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(count, MAX_CONCURRENT_BATCHES) }, worker));
  return results.flat();
}
