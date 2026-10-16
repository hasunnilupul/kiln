/** One CSV column: a header and how to read the cell from a row. */
export interface CsvColumn<Row> {
  header: string
  value: (row: Row) => string | number | null | undefined
}

/**
 * RFC 4180 CSV with CRLF line ends (FR-73). Text cells that a spreadsheet would run as a formula
 * (starting with `=`, `+`, `-`, `@`, tab or CR) are prefixed with `'` to prevent CSV injection.
 * Numbers are written as-is.
 */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') return String(value)
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Minor units as a plain decimal for spreadsheets, e.g. 1250 with 2 digits → "12.50". */
export function decimal(minor: number, digits: number): string {
  if (digits === 0) return String(minor)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 10 ** digits)}.${String(abs % 10 ** digits).padStart(digits, '0')}`
}
