type CalendarDateValue = string | null | undefined;

function calendarTimestamp(value: CalendarDateValue) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function sortCalendarItemsLatestFirst<T>(
  items: readonly T[],
  getDate: (item: T) => CalendarDateValue,
) {
  return items
    .map((item, index) => ({
      item,
      index,
      timestamp: calendarTimestamp(getDate(item)),
    }))
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .map(({ item }) => item);
}
