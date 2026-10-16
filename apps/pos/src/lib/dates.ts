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

function wallClockParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>
  return parts
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, timeZone: string): number {
  const p = wallClockParts(instant, timeZone)
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** The UTC instant of midnight starting `day` (`yyyy-MM-dd`) in `timeZone`, DST-safe. */
export function startOfZonedDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  const guess = Date.UTC(year!, month! - 1, date!)
  const first = guess - zoneOffset(guess, timeZone)
  return new Date(guess - zoneOffset(first, timeZone))
}

/** The calendar day (`yyyy-MM-dd`) of `instant` in `timeZone`. */
export function zonedDay(instant: string | Date, timeZone: string): string {
  const p = wallClockParts(new Date(instant).getTime(), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Adds `days` to a `yyyy-MM-dd` calendar day. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, date! + days)).toISOString().slice(0, 10)
}
