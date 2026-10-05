export async function collectPaginatedRows<T>(input: {
  loadPage: (from: number, to: number) => Promise<T[]>;
  pageSize?: number;
  maxPages?: number;
}) {
  const pageSize = input.pageSize ?? 200;
  const maxPages = input.maxPages ?? 100;
  const rows: T[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const pageRows = await input.loadPage(page * pageSize, (page + 1) * pageSize - 1);
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }

  throw new Error(`Public ranking pagination exceeded ${maxPages} pages`);
}

export function chunkRankingSourceIds<T>(values: T[], size = 100) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
