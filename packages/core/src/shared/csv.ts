/** RFC 4180 CSV parsing and serialisation (quotes, escaped quotes, CRLF, BOM). */

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

/** Parses a CSV with a header row into records keyed by header. */
export function parseCsvRecords(input: string): { headers: string[]; records: Array<Record<string, string>> } {
  const [header, ...rows] = parseCsv(input);
  const headers = (header ?? []).map((cell) => cell.trim());
  return {
    headers,
    records: rows.map((row) => Object.fromEntries(headers.map((name, index) => [name, (row[index] ?? "").trim()]))),
  };
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection; plain numbers like "+91 98…" or "-12" stay intact.
  const numeric = /^[+-]?[\d\s().-]+$/.test(text);
  if (/^[=@\t\r]/.test(text) || (/^[+-]/.test(text) && !numeric)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers.map(escapeCell).join(","), ...rows.map((row) => row.map(escapeCell).join(","))].join("\r\n");
}
