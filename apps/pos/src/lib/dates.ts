/**
 * Formats a date in the client's time zone with their configured pattern (`yyyy`, `MM`, `dd`),
 * plus a 24-hour time. One locale, currency and time zone per client (NFR: localisation).
 */
export function formatDateTime(
  value: string | Date,
  { pattern, timeZone, withTime = true }: { pattern: string; timeZone: string; withTime?: boolean },
): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  )
  const date = pattern
    .replace('yyyy', parts.year ?? '')
    .replace('MM', parts.month ?? '')
    .replace('dd', parts.day ?? '')
  return withTime ? `${date} ${parts.hour}:${parts.minute}` : date
}
