import * as XLSX from "xlsx";

export interface ClientParsedSpreadsheet {
  valid: boolean;
  fileName: string;
  sheetName: string;
  availableSheets: string[];
  totalRows: number;
  uniqueProjects: number;
  detectedColumns: string[];
  missingCrucialColumns: string[];
  sampleProjects: Array<{ code: string; name: string; client: string; rows: number }>;
  message: string;
  // Registros normalizados prontos para envio ao backend em lotes leves
  rows: Array<Record<string, any>>;
}

const CRUCIAL_COLUMNS = [
  "COD_PROJETO",
  "NOME_PROJETO",
  "CLIENTE_NOME",
  "HORAS_TOTAL",
  "INICIO_PROGRAMADO",
  "TERMINO_PROGRAMADO",
  "NIVEL",
];

function normalizeHeader(val: unknown): string {
  return String(val ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

export async function parseSpreadsheetInBrowser(file: File): Promise<ClientParsedSpreadsheet> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const targetSheetName =
    sheetNames.find((s) => {
      const lower = s.toLowerCase();
      return lower.includes("select") && !lower.includes("statement") && !lower.includes("sql");
    }) ||
    sheetNames.find((s) => s.toLowerCase().includes("dual")) ||
    sheetNames.find((s) => !s.toLowerCase().includes("sql") && !s.toLowerCase().includes("statement")) ||
    sheetNames[0];

  const sheet = workbook.Sheets[targetSheetName];
  if (!sheet) {
    throw new Error(`A planilha não possui a aba de dados esperada (${targetSheetName}).`);
  }

  const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!matrix.length) {
    throw new Error(`A aba "${targetSheetName}" está vazia.`);
  }

  const rawHeaders = matrix[0] || [];
  const headers = rawHeaders.map(normalizeHeader);
  headers[0] = headers[0] || "ROW_NUM";

  const rows: Array<Record<string, any>> = matrix.slice(1).map((rowValues, idx) => {
    const rowObj: Record<string, any> = { ROW_NUM: idx + 1 };
    headers.forEach((h, hIdx) => {
      if (h) rowObj[h] = rowValues[hIdx];
    });
    return rowObj;
  });

  const detected = new Set(headers);
  const missing = CRUCIAL_COLUMNS.filter((c) => !detected.has(c));

  const byProject = new Map<string, { code: string; name: string; client: string; count: number }>();
  for (const r of rows) {
    const code = String(r.COD_PROJETO ?? "").trim();
    if (!code) continue;
    if (!byProject.has(code)) {
      byProject.set(code, {
        code,
        name: String(r.NOME_PROJETO ?? `Projeto #${code}`).trim(),
        client: String(r.CLIENTE_NOME ?? "Cliente não informado").trim(),
        count: 0,
      });
    }
    byProject.get(code)!.count += 1;
  }

  const sampleProjects = Array.from(byProject.values())
    .slice(0, 10)
    .map((p) => ({ code: p.code, name: p.name, client: p.client, rows: p.count }));

  const valid = missing.length === 0 && byProject.size > 0;
  const message = valid
    ? `Planilha válida: ${rows.length.toLocaleString("pt-BR")} registros encontrados para ${byProject.size} projetos únicos na aba "${targetSheetName}".`
    : `Estrutura incompleta. Faltam colunas essenciais: ${missing.join(", ")}`;

  return {
    valid,
    fileName: file.name,
    sheetName: targetSheetName,
    availableSheets: workbook.SheetNames,
    totalRows: rows.length,
    uniqueProjects: byProject.size,
    detectedColumns: headers.filter(Boolean),
    missingCrucialColumns: missing,
    sampleProjects,
    message,
    rows,
  };
}
