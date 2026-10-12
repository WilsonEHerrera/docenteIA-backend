// A leading = + - @ makes spreadsheets evaluate the cell as a formula (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | null;

export function csvCell(value: CsvValue): string {
  let text = value === null ? '' : String(value);
  if (FORMULA_START.test(text) && Number.isNaN(Number(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: comma separated, CRLF line endings, every row terminated. */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
