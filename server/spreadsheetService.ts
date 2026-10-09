import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { getDb } from "./db";
import { projectActivities, projectImportBatches, projects } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { storagePut } from "./storage";
import { consolidatePpsaRows, toPpsaInputRow } from "./ppsahours";

export interface ParsedOperationalRecord {
  rowNum: number;
  codProjeto: string;
  nomeProjeto?: string;
  clienteNome?: string;
  responsavelCliente?: string;
  emailResponsavelCliente?: string;
  gestorLogon?: string;
  fase?: string;
  tipoProjeto?: string;
  projetoEncerrado?: string;
  projetoDataInicio?: string;
  idppsa?: string;
  codppsa?: string;
  descricao?: string;
  processo?: string;
  subprocesso?: string;
  atividade?: string;
  codmodulo?: string;
  nivel?: number;
  recurso?: string;
  local?: string;
  inicioProgramado?: string;
  terminoProgramado?: string;
  inicioRealizado?: string;
  fimRealizado?: string;
  totalHoraDiasProgramados?: string;
  horasTotal?: string;
  percentualConclusao?: number;
}

export interface SpreadsheetValidationResult {
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
}

export interface SpreadsheetImportExecutionResult extends SpreadsheetValidationResult {
  batchId: number;
  storageKey?: string;
  storageUrl?: string;
  projectsUpdated: number;
  activitiesImported: number;
  masterCatalogPreservedCount: number;
}

export interface SpreadsheetImportOptions {
  /** Limita a carga a um grupo de códigos; usado pelo worker retomável da API. */
  projectCodes?: Set<string>;
  /** Linhas já normalizadas da API; evita serializar dezenas de milhares de registros em XLSX. */
  parsedRows?: {
    targetSheetName: string;
    rows: Array<Record<string, any>>;
    headers: string[];
  };
  /** Mantém a classificação da prévia quando um lote isolado omite colunas nulas da API. */
  sourceContract?: "REV_ATUAL" | "REV06" | "REV03" | "REV02";
  /** Não apaga/recria toda a atividade em cada lote incremental. */
  preserveExistingActivities?: boolean;
  /** O histórico único é criado somente quando o último lote terminar. */
  skipBatchHistory?: boolean;
}

export function shouldPreserveImportedPpsaRows(input: {
  isApiImport: boolean;
  isFinalSqlImport: boolean;
  hasOfficialPlannedWeeks: boolean;
}): boolean {
  return input.isApiImport && !input.isFinalSqlImport && !input.hasOfficialPlannedWeeks;
}

export type SpreadsheetImportProgress = (progressPct: number, message: string) => void | Promise<void>;

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

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  const raw = String(val).replace("%", "").trim();
  const clean = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const num = parseFloat(clean);
  return Number.isNaN(num) ? null : num;
}

function parseHoursValue(val: unknown): number {
  if (!val) return 0;
  if (typeof val === "number") return val;
  const str = String(val).trim();
  if (!str || str === ":" || str === "-") return 0;
  if (str.includes(":")) {
    const [h, m] = str.split(":");
    const hours = parseFloat(h) || 0;
    const minutes = parseFloat(m) || 0;
    return Math.round((hours + minutes / 60) * 100) / 100;
  }
  const clean = str.includes(",") ? str.replace(/\./g, "").replace(",", ".") : str;
  const num = parseFloat(clean);
  return Number.isNaN(num) ? 0 : num;
}

function firstApiValue(record: Record<string, any>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = record[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== ":") return value;
  }
  return null;
}

function apiActivityPlannedHours(record: Record<string, any>): number {
  return parseHoursValue(firstApiValue(record, [
    "HORAS_ATIVIDADE_PLANEJADAS_DECIMAL",
    "HORAS_ATIVIDADE_PLANEJADAS",
    "HORAS_PLANEJADAS_ATIVIDADE_DECIMAL",
    "HORAS_PLANEJADAS_ATIVIDADE",
    "TOTAL_HORA_DIAS_PROGRAMADOS",
  ]));
}

function apiActivityActualHours(record: Record<string, any>): number {
  return parseHoursValue(firstApiValue(record, [
    "HORAS_REALIZADAS_ATIVIDADE_DECIMAL",
    "HORAS_REALIZADAS_ATIVIDADE",
    "HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL",
    "HORAS_TOTAL",
  ]));
}

function apiModulePlannedHours(record: Record<string, any>): number {
  return parseHoursValue(firstApiValue(record, [
    "HORAS_MODULO_PLANEJADAS_DECIMAL",
    "HORAS_MODULO_PLANEJADAS",
  ]));
}

function apiModuleActualHours(record: Record<string, any>): { value: number; provided: boolean } {
  const raw = firstApiValue(record, ["HORAS_REALIZADAS_MODULO_DECIMAL", "HORAS_REALIZADAS_MODULO"]);
  return { value: parseHoursValue(raw), provided: raw !== null };
}

/**
 * O realizado gerencial do projeto sempre representa HORAS_TOTAL da API.
 * Campos de produtividade, quando existirem, são indicadores separados e
 * nunca podem substituir o total de horas realizadas.
 */
export function resolveImportedApiActualHours(
  canonicalActualHours: number | null | undefined,
  level1ActualHours: number,
  allRowsActualHours: number,
): number {
  if (canonicalActualHours !== null && canonicalActualHours !== undefined && Number.isFinite(canonicalActualHours)) {
    return Number(canonicalActualHours.toFixed(2));
  }
  return Number((level1ActualHours > 0 ? level1ActualHours : allRowsActualHours).toFixed(2));
}

function parseOptionalInt(val: unknown): number | null {
  const num = parseNumber(val);
  return num === null ? null : Math.round(num);
}

function parseDateValue(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str || str === "Sem data" || str === "-" || str === ":") return null;
  if (str.includes("GMT") || str.includes("00:00:00")) {
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  if (str.includes("T")) return str.split("T")[0];
  if (str.includes("/")) {
    const parts = str.split("/");
    if (parts.length === 3) {
      const day = parts[0].padStart(2, "0");
      const month = parts[1].padStart(2, "0");
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`.slice(0, 10);
    }
  }
  return str.slice(0, 10);
}

function formatAccountManager(val?: string): string {
  if (!val) return "Não informado";
  const map: Record<string, string> = {
    CSJAILTONRODRIGUES: "Jailton Rodrigues",
    CSBRUNOMARIN: "Bruno Marin",
    CSMARCOSNASCIMENTO: "Marco Nascimento",
    CSMARCOSMANIOTO: "Marcos Manioto",
    CSDIRCEUBRAMBILA: "Dirceu Brambila",
    CSPAULO: "Paulo Ribeiro",
    CSSAMIRASOUZA: "Samira Souza",
    CSGIVALDOARRUDA: "Givaldo Arruda",
    CSCARLOSLOPES: "Carlos Lopes",
    CSEDSON: "Edson Silva",
    CSLUCASFERREIRA: "Lucas Ferreira",
    CSGUSTAVO: "Gustavo Oliveira",
    CSCARLOSSOUZA: "Carlos Souza",
  };
  return map[val.toUpperCase()] || val;
}

export function parseWorkbookBuffer(buffer: Buffer): {
  workbook: XLSX.WorkBook;
  targetSheetName: string;
  rows: any[];
  headers: string[];
} {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  // Preferimos a aba com dados tabulares ("Select select", "Select dual", etc.) e ignoramos abas SQL/documentação
  const targetSheetName =
    sheetNames.find((s) => {
      const lower = s.toLowerCase();
      return lower.includes("select") && !lower.includes("statement") && !lower.includes("sql");
    }) ||
    sheetNames.find((s) => s.toLowerCase().includes("dual")) ||
    sheetNames.find((s) => !s.toLowerCase().includes("sql") && !s.toLowerCase().includes("statement")) ||
    sheetNames[0];

  const sheet = workbook.Sheets[targetSheetName];
  const matrix: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!matrix.length) {
    throw new Error(`A aba ${targetSheetName} está vazia.`);
  }

  const rawHeaders = matrix[0] || [];
  const headers = rawHeaders.map(normalizeHeader);
  headers[0] = headers[0] || "ROW_NUM";

  const rows = matrix.slice(1).map((rowValues, idx) => {
    const rowObj: Record<string, any> = { ROW_NUM: idx + 1 };
    headers.forEach((h, hIdx) => {
      if (h) rowObj[h] = rowValues[hIdx];
    });
    return rowObj;
  });

  return { workbook, targetSheetName, rows, headers };
}

/**
 * A SQL Cronograma Rev03 é o contrato autoritativo para os indicadores
 * gerenciais. Ela precisa trazer, na mesma resposta, o planejamento por
 * Gestão/Módulo e as duas naturezas de apontamento. Sem essas colunas a
 * aplicação só consegue fazer um diagnóstico PPSA, não reproduzir o valor
 * exibido no sistema CSAgenda.
 */
export function isFinalSqlRev03Rows(rows: Array<Record<string, any>>): boolean {
  const requiredColumns = [
    "QTD_SEMANA_PLANEJADA",
    "HORAS_PLANEJADAS_MODULO",
    "HORAS_PRODUTIVAS_REALIZADAS",
    "HORAS_IMPRODUTIVAS_REALIZADAS",
    "ESCOPO_PLANEJAMENTO",
    "BASE_TOTAL_HORA_DIAS_PROGRAMADOS",
  ];
  return rows.some((row) => {
    const columns = new Set(Object.keys(row).map((key) => key.toUpperCase()));
    return requiredColumns.every((column) => columns.has(column));
  });
}

/**
 * A SQL RevAtual mantém as colunas operacionais e adiciona planejamento de
 * PROJETOMODULO fora do escopo, além de status e totalizadores calculados.
 *
 * As colunas de apresentação `STATUS_ATIVIDADE_HTML`,
 * `STATUS_ESTOURO_HORAS_HTML` e `PERCENTUAL_CONCLUSAO_HTML` são opcionais:
 * podem existir em snapshots antigos ou não ser projetadas pela API atual.
 * O contrato de importação usa somente os campos estruturais sem o sufixo
 * `_HTML`, portanto a ausência delas não invalida a prévia nem a publicação.
 */
export function isSqlRevAtualRows(rows: Array<Record<string, any>>): boolean {
  return rows.length > 0 && missingSqlRevAtualColumns(rows).length === 0;
}

const REV_ATUAL_COLUMN_GROUPS: string[][] = [
  ["COD_PROJETO"],
  ["CODGESTAO"],
  ["CODMODULO"],
  ["IDPPSA", "CODPPSA"],
  ["ID_PAI_PPSA", "ID_PAI", "NIVELPAI"],
  ["NIVEL"],
  ["QTD_SEMANA_PLANEJADA"],
  ["HORAS_MODULO_PLANEJADAS_DECIMAL", "HORAS_MODULO_PLANEJADAS"],
  ["HORAS_ATIVIDADE_PLANEJADAS_DECIMAL", "HORAS_ATIVIDADE_PLANEJADAS", "HORAS_PLANEJADAS_ATIVIDADE_DECIMAL", "HORAS_PLANEJADAS_ATIVIDADE", "TOTAL_HORA_DIAS_PROGRAMADOS"],
  ["HORAS_REALIZADAS_ATIVIDADE_DECIMAL", "HORAS_REALIZADAS_ATIVIDADE", "HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL", "HORAS_TOTAL"],
  ["HORAS_REALIZADAS_MODULO_DECIMAL", "HORAS_REALIZADAS_MODULO"],
  ["POSSUI_CRONOGRAMA", "IDPROJETOCRONOGRAMA"],
  ["PERCENTUAL_CONCLUSAO"],
  ["STATUS_ATIVIDADE"],
];

function hasAnyColumn(columns: Set<string>, alternatives: string[]): boolean {
  return alternatives.some((column) => columns.has(column));
}

export function missingSqlRevAtualColumns(rows: Array<Record<string, any>>): string[] {
  const columns = new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.toUpperCase())));
  return REV_ATUAL_COLUMN_GROUPS
    .filter((alternatives) => !hasAnyColumn(columns, alternatives))
    .map((alternatives) => alternatives[0]);
}

function looksLikeSqlRevAtual(rows: Array<Record<string, any>>): boolean {
  const columns = new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.toUpperCase())));
  return columns.has("HORAS_MODULO_PLANEJADAS") || columns.has("HORAS_MODULO_PLANEJADAS_DECIMAL") || columns.has("QTD_SEMANA_PLANEJADA");
}

/**
 * A View REV06 anterior entrega planejamento PPSA corrigido, mas não as
 * colunas específicas da SQL RevAtual.
 */
export function isSqlRev06ViewRows(rows: Array<Record<string, any>>): boolean {
  const requiredColumns = [
    "COD_PROJETO",
    "CODPPSA",
    "NIVEL",
    "TOTAL_HORA_DIAS_PROGRAMADOS",
    "HORAS_TOTAL",
    "PERCENTUAL_HORAS_REALIZADA_ORIGINAL",
    "STATUS_ESTOURO_HORAS",
    "DATA_TERMINO_REALIZADO_MODULO",
  ];
  return !isSqlRevAtualRows(rows) && rows.length > 0 && rows.some((row) => {
    const columns = new Set(Object.keys(row).map((key) => key.toUpperCase()));
    return requiredColumns.every((column) => columns.has(column));
  });
}

/** Mantido para compatibilidade com testes e integrações legadas. */
export function isFinalSqlRev02Rows(rows: Array<Record<string, any>>): boolean {
  if (isSqlRevAtualRows(rows) || isSqlRev06ViewRows(rows) || looksLikeSqlRevAtual(rows)) return false;
  return rows.some((row) =>
    Object.keys(row).some((key) => {
      const normalized = key.toUpperCase();
      return normalized === "DATA_TERMINO_REALIZADO_MODULO"
        || normalized === "BASE_TOTAL_HORA_DIAS_PROGRAMADOS"
        || normalized === "HORAS_PLANEJADAS_MODULO"
        || normalized === "HORAS_PRODUTIVAS_REALIZADAS";
    }),
  ) || rows.some((row) => {
    const columns = new Set(Object.keys(row).map((key) => key.toUpperCase()));
    return ["COD_PROJETO", "CODPPSA", "NIVEL", "TOTAL_HORA_DIAS_PROGRAMADOS", "HORAS_TOTAL"]
      .every((column) => columns.has(column));
  });
}

function validateSpreadsheetRows(
  fileName: string,
  input: { targetSheetName: string; rows: Array<Record<string, any>>; headers: string[]; availableSheets?: string[] },
): SpreadsheetValidationResult {
  const { targetSheetName, rows, headers } = input;
  const isApiSource = fileName.includes("CSAgenda_API") || fileName.includes("api_endpoint") || targetSheetName.includes("API");
  const detected = new Set(headers);
  const missing = CRUCIAL_COLUMNS.filter((c) => {
    if (isApiSource && (c === "INICIO_PROGRAMADO" || c === "TERMINO_PROGRAMADO")) {
      return false;
    }
    return !detected.has(c);
  });

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
    fileName,
    sheetName: targetSheetName,
    availableSheets: input.availableSheets || [targetSheetName],
    totalRows: rows.length,
    uniqueProjects: byProject.size,
    detectedColumns: headers.filter(Boolean),
    missingCrucialColumns: missing,
    sampleProjects,
    message,
  };
}

export function validateSpreadsheetBuffer(
  fileName: string,
  buffer: Buffer
): SpreadsheetValidationResult {
  const { workbook, targetSheetName, rows, headers } = parseWorkbookBuffer(buffer);
  return validateSpreadsheetRows(fileName, {
    targetSheetName,
    rows,
    headers,
    availableSheets: workbook.SheetNames,
  });
}

export interface ApiImportActivity {
  ppsaCode: string;
  ppsaId?: number | string | null;
  parentPpsaId?: number | string | null;
  description: string;
  process?: string;
  subprocess?: string;
  activity?: string;
  managementCode?: number | string;
  managementName?: string;
  moduleCode?: string;
  moduleName?: string;
  level?: number;
  resource?: string;
  location?: string;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  plannedHours?: number | string;
  actualHours?: number | string;
  plannedActivityHours?: number | string;
  actualActivityHours?: number | string;
  progressPct?: number | string;
  plannedWeeks?: number | string;
  plannedModuleHours?: number | string;
  moduleActualHours?: number | string;
  productiveActualHours?: number | string;
  unproductiveActualHours?: number | string;
  planningScope?: string;
  cronogramId?: number | string;
}

export interface ApiImportProject {
  code: string;
  name: string;
  client: string;
  managerName?: string;
  managerEmail?: string;
  sponsor?: string;
  projectType?: string;
  projectTypeDescription?: string;
  isActive?: boolean;
  phase?: string;
  startDate?: string;
  plannedEndDate?: string;
  finalDate?: string;
  activities: ApiImportActivity[];
}

export interface ApiImportPayload {
  source?: string;
  notes?: string;
  projects: ApiImportProject[];
}

export function buildApiImportWorkbookBuffer(payload: ApiImportPayload): Buffer {
  const rows = payload.projects.flatMap((project) => project.activities.map((activity, index) => ({
    COD_PROJETO: project.code,
    NOME_PROJETO: project.name,
    CLIENTE_NOME: project.client,
    RESPONSAVEL_CLIENTE: project.managerName || "Não informado",
    EMAIL_RESPONSAVEL_CLIENTE: project.managerEmail || "",
    GESTOR_LOGON: project.sponsor || "",
    FASE: project.phase || "",
    TIPO_PROJETO: project.projectType || "",
    TIPO_PROJETO_DESCRICAO: project.projectTypeDescription || project.projectType || "",
    PROJETO_ENCERRADO: project.isActive === false ? "S" : "N",
    PROJETO_DATA_INICIO: project.startDate || "",
    PROJETO_DATA_TERMINO: project.plannedEndDate || project.finalDate || "",
    DATA_FINALIZACAO_PROJETO: project.finalDate || "",
    CODPPSA: activity.ppsaCode || `${project.code}.${index + 1}`,
    IDPPSA: activity.ppsaId ?? "",
    ID_PAI: activity.parentPpsaId ?? "",
    DESCRICAO: activity.description,
    PROCESSO: activity.process || "Processo Geral",
    SUBPROCESSO: activity.subprocess || "Geral",
    ATIVIDADE: activity.activity || activity.description,
    CODGESTAO: activity.managementCode || "",
    GESTAO_DESCRICAO: activity.managementName || "",
    CODMODULO: activity.moduleCode || "",
    MODULO_DESCRICAO: activity.moduleName || "",
    NIVEL: activity.level ?? 1,
    RECURSO: activity.resource || "",
    LOCAL: activity.location || "Presencial",
    INICIO_PROGRAMADO: activity.plannedStart || project.startDate || "",
    TERMINO_PROGRAMADO: activity.plannedEnd || project.plannedEndDate || project.finalDate || "",
    INICIO_REALIZADO: activity.actualStart || "",
    FIM_REALIZADO: activity.actualEnd || "",
    TOTAL_HORA_DIAS_PROGRAMADOS: activity.plannedActivityHours ?? activity.plannedHours ?? 0,
    HORAS_TOTAL: activity.actualActivityHours ?? activity.actualHours ?? 0,
    PERCENTUAL_CONCLUSAO: activity.progressPct ?? 0,
    QTD_SEMANA_PLANEJADA: activity.plannedWeeks ?? "",
    HORAS_PLANEJADAS_MODULO: activity.plannedModuleHours ?? "",
    HORAS_MODULO_PLANEJADAS: activity.plannedModuleHours ?? "",
    HORAS_REALIZADAS_MODULO: activity.moduleActualHours ?? "",
    HORAS_PRODUTIVAS_REALIZADAS: activity.productiveActualHours ?? "",
    HORAS_IMPRODUTIVAS_REALIZADAS: activity.unproductiveActualHours ?? "",
    ESCOPO_PLANEJAMENTO: activity.planningScope ?? "",
    IDPROJETOCRONOGRAMA: activity.cronogramId ?? "",
    ROW_NUM: index + 1,
  })));
  if (!rows.length) throw new Error("A API deve enviar pelo menos uma atividade operacional.");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "API_IMPORT");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export async function processAndImportSpreadsheet(
  fileName: string,
  buffer: Buffer,
  notes?: string,
  onProgress?: SpreadsheetImportProgress,
  options?: SpreadsheetImportOptions
): Promise<SpreadsheetImportExecutionResult> {
  const parsed = options?.parsedRows
    ? {
        targetSheetName: options.parsedRows.targetSheetName,
        rows: options.parsedRows.rows,
        headers: options.parsedRows.headers,
        availableSheets: [options.parsedRows.targetSheetName],
      }
    : (() => {
        const parsedWorkbook = parseWorkbookBuffer(buffer);
        return {
          targetSheetName: parsedWorkbook.targetSheetName,
          rows: parsedWorkbook.rows,
          headers: parsedWorkbook.headers,
          availableSheets: parsedWorkbook.workbook.SheetNames,
        };
      })();
  const validation = validateSpreadsheetRows(fileName, parsed);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Conexão com o banco de dados não disponível.");
  }

  // 1. Salvar arquivo no armazenamento gerenciado S3 para histórico e auditoria.
  // A API CSAgenda já possui snapshot de segurança próprio; não repetimos o
  // upload do XLSX gerado, pois esse upload pode deixar a execução aguardando
  // indefinidamente em gateways/proxies externos.
  let storageResult: { key: string; url: string } | undefined;
  const isApiImport = /^CSAgenda_API_/i.test(fileName);
  try {
    const extension = path.extname(fileName) || ".xls";
    const baseName = path.basename(fileName, extension);
    const storageKey = `planilhas-projetos/${baseName}${extension}`;
    if (!isApiImport) {
      storageResult = await storagePut(
        storageKey,
        buffer,
        fileName.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.ms-excel"
      );
    }
  } catch (storageErr) {
    console.warn("[Storage] Falha ao persistir em S3 (seguindo com carga no banco):", storageErr);
  }

  const targetSheetName = parsed.targetSheetName;
  const allRows = parsed.rows;
  const rows = options?.projectCodes
    ? allRows.filter((row) => options.projectCodes!.has(String(row.COD_PROJETO ?? "").trim()))
    : allRows;
  const isFinalSqlRevAtualImport = options?.sourceContract === "REV_ATUAL" || (options?.sourceContract == null && isSqlRevAtualRows(allRows));
  const isFinalSqlRev06Import = !isFinalSqlRevAtualImport && (options?.sourceContract === "REV06" || (options?.sourceContract == null && isSqlRev06ViewRows(allRows)));
  const isFinalSqlRev03Import = !isFinalSqlRevAtualImport && !isFinalSqlRev06Import && (options?.sourceContract === "REV03" || (options?.sourceContract == null && isFinalSqlRev03Rows(allRows)));
  const isFinalSqlRev02Import = !isFinalSqlRevAtualImport && !isFinalSqlRev06Import && !isFinalSqlRev03Import && (options?.sourceContract === "REV02" || (options?.sourceContract == null && isFinalSqlRev02Rows(allRows)));
  const isFinalSqlImport = isFinalSqlRevAtualImport || isFinalSqlRev06Import || isFinalSqlRev03Import || isFinalSqlRev02Import;
  if (options?.projectCodes && rows.length === 0) {
    throw new Error("Nenhum registro encontrado para o lote de projetos solicitado.");
  }
  await onProgress?.(71, `Planilha interpretada: ${rows.length.toLocaleString("pt-BR")} registros para consolidar...`);

  // 2. Agrupar registros operacionais por projeto e consolidar a hierarquia PPSA.
  // A API pode repetir o mesmo PPSA por joins de cronograma; essas repetições
  // não representam novas horas e não podem entrar novamente nos totalizadores.
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const code = String(r.COD_PROJETO ?? "").trim();
    if (!code) continue;
    const projectRows = grouped.get(code);
    if (projectRows) projectRows.push(r);
    else grouped.set(code, [r]);
  }

  const canonicalGrouped = new Map<string, any[]>();
  const ppsaTotals = new Map<string, ReturnType<typeof consolidatePpsaRows>["totalsByProject"] extends Map<string, infer T> ? T : never>();
  let duplicateRowsRemoved = 0;
  for (const [code, recs] of Array.from(grouped.entries())) {
    const consolidated = consolidatePpsaRows(
      recs.map((row: any, index: number) => toPpsaInputRow(code, row, index)),
      { applyHierarchyCorrection: !isFinalSqlImport },
    );
    const canonicalRecords = isFinalSqlImport
      ? recs.map((record) => ({ ...record }))
      : consolidated.rows.map((item) => {
        const planned = item.plannedHours;
        const actual = item.actualHours;
        const hoursPct = planned > 0 ? Number(((actual / planned) * 100).toFixed(2)) : null;
        const overrun = hoursPct === null
          ? ""
          : hoursPct > 100
            ? `ESTOURO DE HORAS (${hoursPct.toFixed(2)}%)`
            : hoursPct === 100
              ? "REALIZADO CONFERE COM O PLANEJADO (100%)"
              : `SALDO DE HORAS (${(100 - hoursPct).toFixed(2)}%)`;
        return {
          ...item.raw,
          CODPPSA: item.ppsaCode,
          NIVEL: item.level,
          TOTAL_HORA_DIAS_PROGRAMADOS: planned,
          __PPSA_HAS_SOURCE_PLANNED_HOURS: parseHoursValue(item.raw.TOTAL_HORA_DIAS_PROGRAMADOS) > 0,
          __PPSA_SOURCE_FINAL_SQL: isFinalSqlImport,
          HORAS_TOTAL: actual,
          PERCENTUAL_HORAS_REALIZADA_ORIGINAL: hoursPct,
          STATUS_ESTOURO_HORAS: overrun,
          __PPSA_SOURCE_ROWS: item.sourceRows,
        };
      });
    canonicalGrouped.set(code, canonicalRecords);
    const totals = consolidated.totalsByProject.get(code);
    if (totals) ppsaTotals.set(code, totals);
    duplicateRowsRemoved += totals?.duplicateRowsRemoved || 0;
  }
  grouped.clear();
  canonicalGrouped.forEach((records, code) => grouped.set(code, records));

  // 3. Consultar somente os projetos do lote. Ler todas as atividades da base
  // a cada chunk tornava uma sincronização de 300+ projetos desnecessariamente lenta.
  const requestedProjectCodes = options?.projectCodes ? Array.from(options.projectCodes) : [];
  const currentProjects = requestedProjectCodes.length > 0
    ? await db.select().from(projects).where(inArray(projects.code, requestedProjectCodes))
    : await db.select().from(projects);
  const currentProjectIds = currentProjects.map((project) => project.id);
  const currentActivities = isApiImport && currentProjectIds.length > 0
    ? await db.select().from(projectActivities).where(inArray(projectActivities.projectId, currentProjectIds))
    : [];
  const currentByCode = new Map(currentProjects.map((p) => [p.code, p]));
  const projectIdsByCode = new Map(currentProjects.map((p) => [p.code, p.id]));
  const currentActivitiesByProject = new Map<number, typeof currentActivities>();
  currentActivities.forEach((activity) => {
    const projectRows = currentActivitiesByProject.get(activity.projectId);
    if (projectRows) projectRows.push(activity);
    else currentActivitiesByProject.set(activity.projectId, [activity]);
  });

  let projectsUpdated = 0;

  const groupedEntries = Array.from(grouped.entries());
  for (let projectIndex = 0; projectIndex < groupedEntries.length; projectIndex += 1) {
    const [code, recs] = groupedEntries[projectIndex];
    const existing = currentByCode.get(code);
    const hasOfficialPlannedWeeks = recs.some((record) => parseNumber(record.QTD_SEMANA_PLANEJADA) != null);
    const preserveExistingPpsaRows = shouldPreserveImportedPpsaRows({ isApiImport, isFinalSqlImport, hasOfficialPlannedWeeks });
    const incomingPpsaKeys = new Set(recs.map((record) => `${String(record.CODPPSA || "")}|${parseOptionalInt(record.NIVEL) ?? 0}`));
    const existingRowsForProject = existing ? currentActivities.filter((activity) => activity.projectId === existing.id) : [];
    const preservedMissingRows = preserveExistingPpsaRows
      ? existingRowsForProject.filter((activity) => !incomingPpsaKeys.has(`${activity.ppsaCode}|${activity.level}`))
      : [];
    const firstVal = (field: string) => {
      for (const item of recs) {
        const val = item[field];
        if (val !== undefined && val !== null && String(val).trim() !== "" && String(val).trim() !== ":") {
          return String(val).trim();
        }
      }
      return null;
    };

    const level1 = recs.filter((r) => Number(r.NIVEL ?? 0) === 1);
    const calcHours = (items: any[]) =>
      items.reduce((acc, r) => acc + apiActivityActualHours(r), 0);
    const calcPlanHours = (items: any[]) =>
      items.reduce((acc, r) => acc + apiActivityPlannedHours(r), 0);

    const officialModulePlans = new Map<string, { hours: number; scope: string }>();
    const officialModuleActuals = new Map<string, number>();
    let hasOfficialModuleActual = false;
    for (const record of recs) {
      const modulePlan = apiModulePlannedHours(record);
      if (modulePlan <= 0) continue;
      const managementKey = `${String(record.CODGESTAO ?? "").trim()}|${String(record.GESTAO_DESCRICAO ?? "").trim()}`;
      const moduleKey = `${String(record.CODMODULO ?? "").trim()}|${String(record.MODULO_DESCRICAO ?? "").trim()}`;
      const key = `${managementKey}|${moduleKey}`;
      const scope = String(record.ESCOPO_PLANEJAMENTO || record.TIPO_REGISTRO || (record.IDPROJETOCRONOGRAMA != null ? "CRONOGRAMA" : "FORA_ESCOPO")).trim().toUpperCase();
      const current = officialModulePlans.get(key);
      if (!current || modulePlan > current.hours) officialModulePlans.set(key, { hours: modulePlan, scope });
      const moduleActual = apiModuleActualHours(record);
      if (moduleActual.provided) {
        hasOfficialModuleActual = true;
        officialModuleActuals.set(key, Math.max(officialModuleActuals.get(key) || 0, moduleActual.value));
      }
    }
    // Um módulo sem planejamento ainda pode ter apontamentos; o realizado
    // oficial deve ser preservado mesmo quando a capacidade é zero.
    for (const record of recs) {
      const moduleActual = apiModuleActualHours(record);
      if (!moduleActual.provided) continue;
      hasOfficialModuleActual = true;
      const key = `${String(record.CODGESTAO ?? "").trim()}|${String(record.GESTAO_DESCRICAO ?? "").trim()}|${String(record.CODMODULO ?? "").trim()}|${String(record.MODULO_DESCRICAO ?? "").trim()}`;
      officialModuleActuals.set(key, Math.max(officialModuleActuals.get(key) || 0, moduleActual.value));
    }
    const officialModulePlanHours = Array.from(officialModulePlans.values()).reduce((sum, item) => sum + item.hours, 0);
    const officialSchedulePlanHours = Array.from(officialModulePlans.values())
      .filter((item) => item.scope === "CRONOGRAMA")
      .reduce((sum, item) => sum + item.hours, 0);
    const officialOutsidePlanHours = Array.from(officialModulePlans.values())
      .filter((item) => item.scope !== "CRONOGRAMA")
      .reduce((sum, item) => sum + item.hours, 0);

    const ppsaTotal = ppsaTotals.get(code);
    const explicitProductivityFields = recs.some((record) =>
      ["HORAS_PRODUTIVAS_REALIZADAS", "HORAS_IMPRODUTIVAS_REALIZADAS"]
        .some((field) => record[field] !== undefined && record[field] !== null && String(record[field]).trim() !== ""),
    );
    const explicitProd = parseHoursValue(firstVal("HORAS_PRODUTIVAS_REALIZADAS"));
    const explicitImprod = parseHoursValue(firstVal("HORAS_IMPRODUTIVAS_REALIZADAS"));
    const hasProductivityMetrics = explicitProductivityFields;
    const officialModuleActualHours = Array.from(officialModuleActuals.values()).reduce((sum, hours) => sum + hours, 0);
    const sourceActualHours = hasOfficialModuleActual
      ? Number(officialModuleActualHours.toFixed(2))
      : resolveImportedApiActualHours(
        ppsaTotal?.actualHours,
        level1.length ? calcHours(level1) : 0,
        calcHours(recs),
      );
    const preservedLevel = existingRowsForProject.some((activity) => activity.level === 1) ? 1 : null;
    const preservedActualHours = preservedLevel
      ? preservedMissingRows.filter((activity) => activity.level === preservedLevel).reduce((sum, activity) => sum + parseHoursValue(activity.actualHours), 0)
      : 0;
    const actualHours = Number((sourceActualHours + (isApiImport ? 0 : preservedActualHours)).toFixed(2));
    const sourcePlannedHours = officialModulePlanHours > 0
      ? officialModulePlanHours
      : ppsaTotal?.plannedHours ?? (level1.length ? calcPlanHours(level1) : calcPlanHours(recs));

    const leafRecords = recs.filter((r) => Number(r.NIVEL ?? 0) > 1);
    const completionNumbers = (leafRecords.length ? leafRecords : recs)
      .map((r) => parseNumber(r.PERCENTUAL_CONCLUSAO))
      .filter((n): n is number => n !== null);
    const avgCompletion = completionNumbers.length
      ? Math.round((completionNumbers.reduce((a, b) => a + b, 0) / completionNumbers.length) * 100) / 100
      : 0;

    const pStarts = recs.map((r) => parseDateValue(r.INICIO_PROGRAMADO)).filter(Boolean) as string[];
    const pEnds = recs.map((r) => parseDateValue(r.TERMINO_PROGRAMADO)).filter(Boolean) as string[];
    const aStarts = recs.map((r) => parseDateValue(r.INICIO_REALIZADO)).filter(Boolean) as string[];
    const aEnds = recs.map((r) => parseDateValue(r.FIM_REALIZADO)).filter(Boolean) as string[];

    const startDate =
      parseDateValue(firstVal("PROJETO_DATA_INICIO")) ||
      (pStarts.length ? pStarts.sort()[0] : aStarts.length ? aStarts.sort()[0] : "Sem data");
    const actualStartDate = aStarts.length ? aStarts.sort()[0] : "Sem data";
    const actualEndDate = aEnds.length ? aEnds.sort().reverse()[0] : "Sem data";
    const plannedEndDate =
      parseDateValue(firstVal("PROJETO_DATA_TERMINO")) ||
      (pEnds.length ? pEnds.sort().reverse()[0] : "Sem data");
    const finalDate = parseDateValue(firstVal("DATA_FINALIZACAO_PROJETO")) || "Sem data";
    const projectedEndDate = aEnds.length ? aEnds.sort().reverse()[0] : plannedEndDate;

    const sourceName = firstVal("NOME_PROJETO");
    const sourceClient = firstVal("CLIENTE_NOME");
    const sourceManager = firstVal("RESPONSAVEL_CLIENTE");
    const sourceManagerCode = parseOptionalInt(firstVal("GESTOR_CONTA"));
    const sourceEmail = firstVal("EMAIL_RESPONSAVEL_CLIENTE");
    const sourceSponsor = formatAccountManager(firstVal("GESTOR_LOGON") || undefined);
    const sourcePhase = firstVal("FASE");
    const sourceTypeCode = firstVal("TIPO_PROJETO");
    const sourceTypeDescription = firstVal("TIPO_PROJETO_DESCRICAO");
    const sourceClosed = firstVal("PROJETO_ENCERRADO");
    const segmentId = parseOptionalInt(firstVal("ID_SEGMENTO"));
    const scopeDate = parseDateValue(firstVal("DATA_ESCOPO"));

    const isActive = !["S", "SIM", "1", "TRUE"].includes(String(sourceClosed || "").trim().toUpperCase());
    const projectType = sourceTypeDescription ||
      (sourceTypeCode === "1"
        ? "Migração CS 4.0"
        : sourceTypeCode === "2" || sourceTypeCode === "6"
        ? "Implantação Nova"
        : sourceTypeCode === "3" || sourceTypeCode === "5"
        ? "Melhoria / Evolutivo"
        : sourceTypeCode
        ? `Tipo ${sourceTypeCode}`
        : "Não informado");

    const modules = new Set(recs.map((r) => String(r.CODMODULO ?? "").trim()).filter(Boolean));
    const consultants = new Set(recs.map((r) => String(r.RECURSO ?? "").trim()).filter(Boolean));

    const level1Recs = recs.filter((r) => Number(r.NIVEL ?? 0) === 1);
    const level1Base = level1Recs.length ? level1Recs : recs;
    const plannedInScheduleCalc = officialModulePlanHours > 0
      ? Number(officialSchedulePlanHours.toFixed(2))
      : Number(level1Base.filter((r) => r.IDPROJETOCRONOGRAMA != null).reduce((acc, r) => acc + apiActivityPlannedHours(r), 0).toFixed(2));
    const plannedOutsideScheduleCalc = officialModulePlanHours > 0
      ? Number(officialOutsidePlanHours.toFixed(2))
      : Number(level1Base.filter((r) => r.IDPROJETOCRONOGRAMA == null).reduce((acc, r) => acc + apiActivityPlannedHours(r), 0).toFixed(2));
    const productiveActualHours = hasProductivityMetrics
      ? explicitProd
      : null;
    const unproductiveActualHours = hasProductivityMetrics
      ? explicitImprod
      : null;
    const hoursMetricsSource = isFinalSqlRevAtualImport
      ? "SQL_REV_ATUAL_PROGRAMADO_AJUSTADO"
      : isFinalSqlRev06Import
        ? "SQL_REV06_VIEW_PLANEJAMENTO"
        : isFinalSqlRev03Import
          ? "SQL_REV03_AUTORITATIVA"
          : isFinalSqlRev02Import
            ? "SQL_REV02_TRATADA_NO_SISTEMA"
            : "PPSA_NIVEL1_CONSOLIDADO";

    const plannedHours = Number(sourcePlannedHours.toFixed(2));

    const baselineHours =
      !isFinalSqlImport && existing && Number(existing.baselineHours) > 0 ? Number(existing.baselineHours) : plannedHours;

    if (existing) {
      await db
        .update(projects)
        .set({
          name: sourceName || existing.name,
          client: sourceClient || existing.client,
          managerName: sourceManager || existing.managerName,
          managerCode: sourceManagerCode ?? existing.managerCode,
          managerEmail: sourceEmail || existing.managerEmail,
          sponsor: sourceSponsor || existing.sponsor,
          projectType,
          projectTypeDescription: sourceTypeDescription || existing.projectTypeDescription,
          isActive,
          sourcePhaseCode: sourcePhase || existing.sourcePhaseCode,
          segmentId: segmentId ?? existing.segmentId,
          scopeDate: scopeDate || existing.scopeDate,
          closedFlag: sourceClosed ? String(sourceClosed).slice(0, 8) : existing.closedFlag,
          startDate,
          plannedEndDate,
          actualStartDate,
          actualEndDate,
          finalDate,
          projectedEndDate,
          baselineHours: baselineHours.toFixed(2),
          plannedHours: plannedHours.toFixed(2),
          actualHours: actualHours.toFixed(2),
          plannedHoursInSchedule: plannedInScheduleCalc.toFixed(2),
          plannedHoursOutsideSchedule: plannedOutsideScheduleCalc.toFixed(2),
          productiveActualHours: productiveActualHours == null ? null : productiveActualHours.toFixed(2),
          unproductiveActualHours: unproductiveActualHours == null ? null : unproductiveActualHours.toFixed(2),
          hoursMetricsSource,
          completionPct: avgCompletion.toFixed(2),
          totalModules: modules.size,
          totalActivities: recs.length + preservedMissingRows.length,
          activeConsultants: consultants.size || 1,
          summary: `Atualizado via importação em ${new Date().toLocaleDateString("pt-BR")}. API com ${recs.length} registros e ${actualHours.toFixed(1)}h no totalizador HORAS_TOTAL.`,
        })
        .where(eq(projects.id, existing.id));
      projectsUpdated++;
    } else {
      const [insertedProject] = await db.insert(projects).values({
        code,
        name: sourceName || `Projeto CS #${code}`,
        client: sourceClient || "Cliente não informado",
        managerName: sourceManager || "Não informado",
        managerCode: sourceManagerCode,
        managerEmail: sourceEmail,
        sponsor: sourceSponsor,
        projectType,
        projectTypeDescription: sourceTypeDescription,
        isActive,
        sourcePhaseCode: sourcePhase,
        segmentId,
        scopeDate,
        closedFlag: sourceClosed ? String(sourceClosed).slice(0, 8) : null,
        status: "sem_classificacao",
        ragSource: "nao_disponivel",
        indicatorQuality: plannedHours > 0 ? "parcial" : "nao_disponivel",
        stage: sourcePhase ? `Fase ${sourcePhase}` : "Execução",
        startDate,
        plannedEndDate,
        actualStartDate,
        actualEndDate,
        finalDate,
        projectedEndDate,
        baselineHours: baselineHours.toFixed(2),
        plannedHours: plannedHours.toFixed(2),
        actualHours: actualHours.toFixed(2),
        plannedHoursInSchedule: plannedInScheduleCalc.toFixed(2),
        plannedHoursOutsideSchedule: plannedOutsideScheduleCalc.toFixed(2),
        productiveActualHours: productiveActualHours == null ? null : productiveActualHours.toFixed(2),
        unproductiveActualHours: unproductiveActualHours == null ? null : unproductiveActualHours.toFixed(2),
        hoursMetricsSource,
        completionPct: avgCompletion.toFixed(2),
        spi: "1.00",
        cpi: "1.00",
        totalModules: modules.size,
        totalActivities: recs.length + preservedMissingRows.length,
        activeConsultants: consultants.size || 1,
        summary: `Importado diretamente pelo painel web via ${fileName}.`,
      }).returning({ id: projects.id });
      projectIdsByCode.set(code, Number(insertedProject.id));
      projectsUpdated++;
    }

    if (projectIndex === 0 || projectIndex === groupedEntries.length - 1 || projectIndex % 10 === 0) {
      const progress = 72 + Math.round(((projectIndex + 1) / Math.max(1, groupedEntries.length)) * 10);
      await onProgress?.(progress, `Consolidando projeto ${projectIndex + 1} de ${groupedEntries.length}...`);
    }
  }

  // 4. Substituir o cronograma apenas dos projetos presentes no arquivo.
  // Projetos do catálogo mestre sem linhas operacionais continuam preservados.
  const affectedProjectIds = Array.from(grouped.keys())
    .map((code) => projectIdsByCode.get(code))
    .filter((id): id is number => Boolean(id));

  if (affectedProjectIds.length > 0) {
    await db.delete(projectActivities).where(inArray(projectActivities.projectId, affectedProjectIds));
  }

  const activityRows = Array.from(grouped.entries()).flatMap(([code, recs]) => {
    const projectId = projectIdsByCode.get(code);
    if (!projectId) return [];

    const preserveExistingPpsaRows = shouldPreserveImportedPpsaRows({
      isApiImport,
      isFinalSqlImport,
      hasOfficialPlannedWeeks: recs.some((record) => parseNumber(record.QTD_SEMANA_PLANEJADA) != null),
    });
    const incomingPpsaKeys = new Set(recs.map((record) => `${String(record.CODPPSA || "")}|${parseOptionalInt(record.NIVEL) ?? 0}`));
    const existingRowsToPreserve = preserveExistingPpsaRows
      ? (currentActivitiesByProject.get(projectId) || []).filter((activity) => !incomingPpsaKeys.has(`${activity.ppsaCode}|${activity.level}`))
      : [];

    const importedRows = recs.map((rec, index) => {
      const completion = parseNumber(rec.PERCENTUAL_CONCLUSAO) ?? 0;
      const actualHours = apiActivityActualHours(rec);
      const level = parseOptionalInt(rec.NIVEL) ?? 0;
      const existingActivity = preserveExistingPpsaRows
        ? (currentActivitiesByProject.get(projectId) || []).find((activity) => activity.ppsaCode === String(rec.CODPPSA || "") && activity.level === level)
        : undefined;
      const plannedHours = !isApiImport && existingActivity
        ? parseHoursValue(existingActivity.plannedHours)
        : apiActivityPlannedHours(rec);
      const rawSourceStatus = String(rec.STATUS_ATIVIDADE || "").trim().toUpperCase();
      const sourceStatusMap: Record<string, "concluido" | "em_andamento" | "nao_iniciado" | "atrasado"> = {
        CONCLUIDA: "concluido",
        "CONCLUÍDA": "concluido",
        "EM ANDAMENTO": "em_andamento",
        "NAO INICIADO": "nao_iniciado",
        "NÃO INICIADO": "nao_iniciado",
        ATRASADA: "atrasado",
      };
      const status = sourceStatusMap[rawSourceStatus] || (
        completion >= 100
          ? "concluido"
          : completion > 0 || actualHours > 0
          ? "em_andamento"
          : "nao_iniciado"
      );
      const projectCode = parseOptionalInt(rec.PROJETO);
      const processCode = parseOptionalInt(rec.PROCESSO);
      const subprocessCode = parseOptionalInt(rec.SUBPROCESSO);
      const activityCode = parseOptionalInt(rec.ATIVIDADE);
      const moduleCode = String(rec.CODMODULO ?? "").trim();
      const moduleDesc = String(rec.MODULO_DESCRICAO ?? "").trim();
      const managementDesc = String(rec.GESTAO_DESCRICAO ?? "").trim();
      const managementCode = parseOptionalInt(rec.CODGESTAO);
      const levelChild = rec.NIVELFILHO ? String(rec.NIVELFILHO).slice(0, 80) : null;
      const levelParent = (rec.ID_PAI_PPSA ?? rec.ID_PAI ?? rec.NIVELPAI) ? String(rec.ID_PAI_PPSA ?? rec.ID_PAI ?? rec.NIVELPAI).slice(0, 80) : null;
      const parentPpsaId = parseOptionalInt(rec.ID_PAI_PPSA ?? rec.ID_PAI);
      const ppsa = String(rec.CODPPSA || `SEM_PPSA_ROW-${index + 1}`).slice(0, 80);
      const atomicActualHours = parseHoursValue(firstApiValue(rec, ["HORAS_REALIZADAS_ATOMICAS_DECIMAL", "HORAS_REALIZADAS_ATOMICAS"]));
      const consolidatedActualHours = parseHoursValue(firstApiValue(rec, ["HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL", "HORAS_TOTAL"]));
      const activityPlannedHours = parseHoursValue(firstApiValue(rec, ["HORAS_ATIVIDADE_PLANEJADAS_DECIMAL", "HORAS_ATIVIDADE_PLANEJADAS", "HORAS_PLANEJADAS_ATIVIDADE_DECIMAL", "HORAS_PLANEJADAS_ATIVIDADE", "TOTAL_HORA_DIAS_PROGRAMADOS"]));
      const moduleSummaryPlan = parseHoursValue(firstApiValue(rec, ["RESUMO_MODULO_HORAS_PLANEJADAS_DECIMAL", "RESUMO_MODULO_HORAS_PLANEJADAS", "HORAS_MODULO_PLANEJADAS_DECIMAL", "HORAS_MODULO_PLANEJADAS"]));
      const moduleSummaryActual = parseHoursValue(firstApiValue(rec, ["RESUMO_MODULO_HORAS_REALIZADAS_DECIMAL", "RESUMO_MODULO_HORAS_REALIZADAS", "HORAS_REALIZADAS_MODULO_DECIMAL", "HORAS_REALIZADAS_MODULO"]));
      const moduleSummaryPct = parseNumber(firstApiValue(rec, ["RESUMO_MODULO_PERCENTUAL_REALIZADO", "RESUMO_MODULO_PERCENTUAL"]));
      const mgmtSummaryPlan = parseHoursValue(firstApiValue(rec, ["RESUMO_GESTAO_HORAS_PLANEJADAS_DECIMAL", "RESUMO_GESTAO_HORAS_PLANEJADAS"]));
      const mgmtSummaryActual = parseHoursValue(firstApiValue(rec, ["RESUMO_GESTAO_HORAS_REALIZADAS_DECIMAL", "RESUMO_GESTAO_HORAS_REALIZADAS"]));
      const mgmtSummaryPct = parseNumber(firstApiValue(rec, ["RESUMO_GESTAO_PERCENTUAL_REALIZADO", "RESUMO_GESTAO_PERCENTUAL"]));

      return {
        projectId,
        ppsaCode: ppsa || `ROW-${index + 1}`,
        description: String(rec.DESCRICAO || "Sem descrição").slice(0, 255),
        process: String(rec.PROCESSO ?? "Processo Geral").slice(0, 120),
        subprocess: String(rec.SUBPROCESSO ?? "Geral").slice(0, 120),
        activity: String(rec.ATIVIDADE ?? "Atividade Base").slice(0, 120),
        managementName: managementDesc ? `${managementDesc}${managementCode ? ` (${managementCode})` : ""}`.slice(0, 120) : (managementCode ? `Gestão ${managementCode}` : "Gestão Geral"),
        moduleName: moduleDesc ? `${moduleDesc}${moduleCode ? ` (${moduleCode})` : ""}`.slice(0, 80) : (moduleCode ? `Módulo ${moduleCode}`.slice(0, 80) : "Módulo Geral"),
        plannedStart: parseDateValue(rec.INICIO_PROGRAMADO) || "Sem data",
        plannedEnd: parseDateValue(rec.TERMINO_PROGRAMADO) || "Sem data",
        actualStart: parseDateValue(rec.INICIO_REALIZADO),
        actualEnd: parseDateValue(rec.FIM_REALIZADO),
        plannedHours: plannedHours.toFixed(2),
        actualHours: actualHours.toFixed(2),
        plannedActivityHours: activityPlannedHours.toFixed(2),
        actualAtomicHours: atomicActualHours.toFixed(2),
        actualConsolidatedHours: consolidatedActualHours.toFixed(2),
        progressPct: completion.toFixed(2),
        resource: rec.RECURSO ? String(rec.RECURSO).slice(0, 120) : null,
        location: rec.LOCAL ? String(rec.LOCAL).slice(0, 40) : "Presencial",
        level,
        status,
        sourceRowNumber: parseOptionalInt(rec.ROW_NUM),
        sourceCronogramId: parseOptionalInt(rec.IDPROJETOCRONOGRAMA),
        sourcePpsaId: parseOptionalInt(rec.IDPPSA ?? rec.CODPPSA),
        managementCode,
        sourceProjectCode: projectCode,
        sourceProcessCode: processCode,
        sourceSubprocessCode: subprocessCode,
        sourceActivityCode: activityCode,
        levelChild,
        levelParent,
        plannedDays: parseNumber(rec.DIFF_DIAS_PROGRAMADA)?.toFixed(2) || null,
        plannedWeeks: parseNumber(rec.QTD_SEMANA_PLANEJADA)?.toFixed(2) || null,
        plannedModuleHours: apiModulePlannedHours(rec).toFixed(2),
        moduleActualHours: apiModuleActualHours(rec).provided ? apiModuleActualHours(rec).value.toFixed(2) : null,
        moduleSummaryPlannedHours: moduleSummaryPlan > 0 ? moduleSummaryPlan.toFixed(2) : null,
        moduleSummaryActualHours: moduleSummaryActual > 0 ? moduleSummaryActual.toFixed(2) : null,
        moduleSummaryCompletionPct: moduleSummaryPct != null ? moduleSummaryPct.toFixed(2) : null,
        managementSummaryPlannedHours: mgmtSummaryPlan > 0 ? mgmtSummaryPlan.toFixed(2) : null,
        managementSummaryActualHours: mgmtSummaryActual > 0 ? mgmtSummaryActual.toFixed(2) : null,
        managementSummaryCompletionPct: mgmtSummaryPct != null ? mgmtSummaryPct.toFixed(2) : null,
        utilizationPct: parseNumber(rec.UTILIZACAO_PERC)?.toFixed(6) || null,
        utilizationPctLevel: parseNumber(rec.UTILIZACAO_PERC_NIVEL)?.toFixed(6) || null,
        totalUtilizationLevel: parseNumber(rec.TOTAL_UTILIZACAO_NIVEL)?.toFixed(6) || null,
        plannedHoursText: existingActivity?.plannedHoursText || String(rec.TOTAL_HORA_DIAS_PROGRAMADOS || "").slice(0, 32),
        elapsedSchedulePct: parseNumber(rec.PERCENTUAL_DIAS_REALIZADO)?.toFixed(2) || null,
        hoursCompletionPct: parseNumber(rec.PERCENTUAL_HORAS_REALIZADA_ORIGINAL ?? rec.PERCENTUAL_HORAS_REALIZADA)?.toFixed(2) || null,
        hoursOverrunStatus: rec.STATUS_ESTOURO_HORAS ? String(rec.STATUS_ESTOURO_HORAS).slice(0, 160) : null,
        sourceStatus: rec.STATUS_ATIVIDADE ? String(rec.STATUS_ATIVIDADE).slice(0, 40) : null,
        sourceRecordType: rec.TIPO_REGISTRO ? String(rec.TIPO_REGISTRO).slice(0, 30) : null,
        parentPpsaId,
        moduleActualEndDate: parseDateValue(rec.DATA_TERMINO_REALIZADO_MODULO),
        standardDuration: rec.TEMPOPADRAO ? String(rec.TEMPOPADRAO).slice(0, 32) : null,
        plannedMorningStart: rec.HORA_INICIO_MANHA ? String(rec.HORA_INICIO_MANHA).slice(0, 8) : null,
        plannedMorningEnd: rec.HORA_TERMINO_MANHA ? String(rec.HORA_TERMINO_MANHA).slice(0, 8) : null,
        plannedAfternoonStart: rec.HORA_INICIO_TARDE ? String(rec.HORA_INICIO_TARDE).slice(0, 8) : null,
        plannedAfternoonEnd: rec.HORA_TERMINO_TARDE ? String(rec.HORA_TERMINO_TARDE).slice(0, 8) : null,
        sourceFileName: fileName,
        sourceSheet: isFinalSqlRevAtualImport
          ? `${targetSheetName} - SQL REV ATUAL PROGRAMADO AJUSTADO`
          : isFinalSqlRev06Import
            ? `${targetSheetName} - SQL VIEW REV06`
            : isFinalSqlRev03Import
              ? `${targetSheetName} - SQL FINAL Rev03`
              : isFinalSqlRev02Import
                ? `${targetSheetName} - SQL ANTERIOR TRATADA NO SISTEMA`
                : targetSheetName,
        importedAt: new Date(),
      };
    });

      const preservedRows = existingRowsToPreserve.map((activity) => {
      const { id: _id, ...row } = activity;
      return {
        ...row,
        sourceFileName: fileName,
        sourceSheet: isFinalSqlRevAtualImport
          ? `${targetSheetName} - SQL REV ATUAL PROGRAMADO AJUSTADO`
          : isFinalSqlRev06Import
            ? `${targetSheetName} - SQL VIEW REV06`
            : isFinalSqlRev03Import
              ? `${targetSheetName} - SQL FINAL Rev03`
              : isFinalSqlRev02Import
                ? `${targetSheetName} - SQL ANTERIOR TRATADA NO SISTEMA`
                : targetSheetName,
        importedAt: new Date(),
      };
    });

    return [...importedRows, ...preservedRows];
  });

  const activityBatchSize = 500;
  for (let index = 0; index < activityRows.length; index += activityBatchSize) {
    await db.insert(projectActivities).values(activityRows.slice(index, index + activityBatchSize));
    const insertedRows = Math.min(index + activityBatchSize, activityRows.length);
    const progress = 83 + Math.round((insertedRows / Math.max(1, activityRows.length)) * 14);
    await onProgress?.(progress, `Gravando atividades: ${insertedRows.toLocaleString("pt-BR")} de ${activityRows.length.toLocaleString("pt-BR")}...`);
  }

  // 5. Gravar registro no histórico de auditoria
  const [batchResult] = options?.skipBatchHistory
    ? [{ id: 0 }]
    : await db.insert(projectImportBatches).values({
        fileName,
        storageKey: storageResult?.key || null,
        storageUrl: storageResult?.url || null,
        sourceSheet: targetSheetName,
        rowsRead: rows.length,
        rowsImported: activityRows.length,
        projectCount: grouped.size,
        status: "sucesso",
        notes: notes || `Carga processada com sucesso: ${grouped.size} projetos, ${activityRows.length} PPSA únicos e ${duplicateRowsRemoved} linhas repetidas removidas.`,
        validationSummary: JSON.stringify({
          detectedColumns: validation.detectedColumns.length,
          sampleProjects: validation.sampleProjects,
        }),
      }).returning({ id: projectImportBatches.id });

  return {
    ...validation,
    batchId: batchResult?.id || 0,
    storageKey: storageResult?.key,
    storageUrl: storageResult?.url,
    projectsUpdated,
    activitiesImported: activityRows.length,
    masterCatalogPreservedCount: currentProjects.length,
  };
}

export async function processParsedSpreadsheetRows(
  fileName: string,
  rows: Array<Record<string, any>>,
  notes?: string,
  onProgress?: SpreadsheetImportProgress,
  options?: SpreadsheetImportOptions
): Promise<SpreadsheetImportExecutionResult> {
  if (/^CSAgenda_API_/i.test(fileName)) {
    const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    return processAndImportSpreadsheet(
      fileName,
      Buffer.alloc(0),
      notes,
      onProgress,
      {
        ...options,
        parsedRows: {
          targetSheetName: "API_IMPORT",
          rows,
          headers,
        },
      },
    );
  }
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Select dual");
  const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return await processAndImportSpreadsheet(fileName, buffer, notes, onProgress, options);
}
