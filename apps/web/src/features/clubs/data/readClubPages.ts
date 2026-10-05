/** A stable ORDER BY belongs on each query passed to this reader. */
export async function readClubPages<Row>(
  read: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
) {
  const rows: Row[] = [];
  const pageSize = 250;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await read(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
