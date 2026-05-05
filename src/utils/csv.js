export function csvEscape(value) {
  return `"${(value ?? "").toString().replace(/"/g, '""')}"`;
}

export function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export function normalizeHeader(value) {
  return value
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
}

export function downloadCSV(rows, headers, filename) {
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}
