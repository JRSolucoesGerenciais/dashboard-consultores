import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import {
  oracleApiConfigs,
  oracleSyncRuns,
  projectImportBatches,
  projectActivities,
  projects,
  type InsertOracleApiConfig,
  type InsertOracleSyncRun,
  type OracleApiConfig,
  type OracleSyncRun,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { storagePut } from "./storage";
import { isFinalSqlRev02Rows, isFinalSqlRev03Rows, isSqlRev06ViewRows, isSqlRevAtualRows, missingSqlRevAtualColumns, processParsedSpreadsheetRows } from "./spreadsheetService";
import {
  deleteSpreadsheetImportStaging,
  getSpreadsheetImportSessionMetadata,
  readSpreadsheetImportSession,
  readSpreadsheetImportChunkRange,
  stageSpreadsheetImportRows,
} from "./spreadsheetImportStaging";

export const DEFAULT_ORACLE_ENDPOINT =
  "https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2";

export interface OraclePreview {
  rowsCount: number;
  projectsCount: number;
  namedProjectsCount: number;
  levelCounts: Array<{ level: string; count: number }>;
  statusCounts: Array<{ status: string; count: number }>;
  activeProjectsCount: number;
  closedProjectsCount: number;
  plannedHoursLevel1: number;
  actualHoursLevel1: number;
  plannedHoursInScheduleLevel1: number;
  plannedHoursOutsideScheduleLevel1: number;
  actualHoursInScheduleLevel1: number;
  actualHoursOutsideScheduleLevel1: number;
  officialProductiveActualHours: number;
  officialUnproductiveActualHours: number;
  officialPlannedHours: number;
  officialPlannedHoursInSchedule: number;
  officialPlannedHoursOutsideSchedule: number;
  isFinalSqlRevAtual: boolean;
  isFinalSqlRev06: boolean;
  isFinalSqlRev03: boolean;
  isFinalSqlRev02: boolean;
  isImportable: boolean;
  validationWarnings: string[];
  projectCoveragePct: number;
  missingProjectCount: number;
  referenceProject122?: {
    plannedHours: number;
    plannedHoursInSchedule: number;
    plannedHoursOutsideSchedule: number;
    actualHours: number;
  };
  stagingSessionId?: string;
  detectedColumns: string[];
  comparison: {
    newProjectsCount: number;
    updatedProjectsCount: number;
    newProjects: Array<{ code: string; name: string; client: string }>;
    updatedProjects: Array<{ code: string; name: string; client: string }>;
  };
  sampleRows: Array<{
    projectCode: string;
    projectName: string;
    client: string;
    ppsaCode: string;
    description: string;
    level: number;
    status: string;
    plannedHours: number;
    actualHours: number;
  }>;
}

function parseExternalHours(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const raw = String(value).trim();
  if (!raw || raw === ":" || raw === "-") return 0;
  if (raw.includes(":")) {
    const [hours, minutes] = raw.split(":").map(Number);
    return Math.round(((hours || 0) + (minutes || 0) / 60) * 100) / 100;
  }
  const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

// A consulta CSAgenda pode ser grande, mas repetir automaticamente a mesma
// chamada por até nove minutos deixava a interface aparentando travamento e
// podia gerar prévias duplicadas. Uma tentativa de até 3 minutos é suficiente;
// o usuário pode iniciar uma nova tentativa de forma explícita.
const ORACLE_REQUEST_TIMEOUT_MS = 180_000;
const ORACLE_REQUEST_ATTEMPTS = 1;
const ORACLE_WORKER_STALE_MS = 5 * 60 * 1000;

function compactErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Falha desconhecida");
  if (/Data Too Long|ER_DATA_TOO_LONG|field len/i.test(raw)) {
    return "A API respondeu, mas o staging não suportou o tamanho do maior projeto. O armazenamento da prévia precisa estar em LONGTEXT.";
  }
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 1800 ? `${compact.slice(0, 1800)}…` : compact;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Tempo limite de ${Math.round(milliseconds / 1000)} segundos excedido no snapshot de segurança.`)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function extractExternalRows(payloadText: string): Record<string, unknown>[] {
  const trimmed = payloadText.trim();
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart < 0 || arrayEnd < arrayStart) {
    throw new Error("A resposta da API não contém uma lista JSON de registros.");
  }
  const parsed: unknown = JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
  if (!Array.isArray(parsed)) throw new Error("A resposta da API não é uma lista de registros.");
  return parsed.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
}

async function buildOraclePreview(
  rows: Record<string, unknown>[],
  options: { enforceCompleteness?: boolean } = {},
): Promise<OraclePreview> {
  const projectCodes = new Set(rows.map((row) => String(row.COD_PROJETO ?? "").trim()).filter(Boolean));
  const projectNames = new Set(rows.map((row) => String(row.NOME_PROJETO ?? "").trim()).filter(Boolean));
  const countBy = (field: string): Array<{ value: string; count: number }> => {
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const key = String(row[field] ?? "Não informado").trim() || "Não informado";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([value, count]) => ({ value, count }));
  };
  const isFinalSqlRevAtual = isSqlRevAtualRows(rows);
  const revAtualShape = rows.some((row) => Object.keys(row).some((key) => ["HORAS_MODULO_PLANEJADAS", "HORAS_MODULO_PLANEJADAS_DECIMAL"].includes(key.toUpperCase())))
    && rows.some((row) => Object.keys(row).some((key) => ["HORAS_REALIZADAS_MODULO", "HORAS_REALIZADAS_MODULO_DECIMAL"].includes(key.toUpperCase())));
  const isFinalSqlRev06 = !isFinalSqlRevAtual && isSqlRev06ViewRows(rows);
  const isFinalSqlRev03 = !isFinalSqlRevAtual && !isFinalSqlRev06 && isFinalSqlRev03Rows(rows);
  const isFinalSqlRev02 = !isFinalSqlRevAtual && !isFinalSqlRev06 && !isFinalSqlRev03 && isFinalSqlRev02Rows(rows);
  const level1ByPpsa = new Map<string, { planned: number; actual: number; inSchedule: boolean }>();
  rows.filter((row) => Number(row.NIVEL) === 1).forEach((row, index) => {
    const projectCode = String(row.COD_PROJETO ?? "").trim();
    const ppsaCode = String(row.CODPPSA ?? `ROW-${index}`).trim();
    const key = `${projectCode}|${ppsaCode}`;
    const previous = level1ByPpsa.get(key);
    level1ByPpsa.set(key, {
      planned: Math.max(previous?.planned || 0, parseExternalHours(row.TOTAL_HORA_DIAS_PROGRAMADOS)),
      actual: Math.max(previous?.actual || 0, parseExternalHours(row.HORAS_TOTAL)),
      inSchedule: Boolean(previous?.inSchedule || String(row.IDPROJETOCRONOGRAMA ?? "").trim()),
    });
  });
  const level1 = Array.from(level1ByPpsa.values());
  const inSchedule = level1.filter((row) => row.inSchedule);
  const outsideSchedule = level1.filter((row) => !row.inSchedule);
  const officialByProject = new Map<string, { modules: Map<string, { hours: number; actualHours: number; scope: string }>; productive: number; unproductive: number }>();
  rows.forEach((row) => {
    const projectCode = String(row.COD_PROJETO ?? "").trim();
    if (!projectCode) return;
    const current = officialByProject.get(projectCode) || { modules: new Map(), productive: 0, unproductive: 0 };
    const moduleHours = parseExternalHours(row.HORAS_PLANEJADAS_MODULO ?? row.HORAS_MODULO_PLANEJADAS);
    if (moduleHours > 0) {
      const management = `${String(row.CODGESTAO ?? "").trim()}|${String(row.GESTAO_DESCRICAO ?? "").trim()}`;
      const module = `${String(row.CODMODULO ?? "").trim()}|${String(row.MODULO_DESCRICAO ?? "").trim()}`;
      const key = `${management}|${module}`;
      const scopeText = String(row.ESCOPO_PLANEJAMENTO ?? "").trim().toUpperCase();
      const scope = scopeText || (String(row.IDPROJETOCRONOGRAMA ?? "").trim() ? "CRONOGRAMA" : "FORA_CRONOGRAMA");
      const previous = current.modules.get(key);
      const moduleActual = parseExternalHours(row.HORAS_REALIZADAS_MODULO_DECIMAL ?? row.HORAS_REALIZADAS_MODULO);
      if (!previous || moduleHours > previous.hours || moduleActual > previous.actualHours) {
        current.modules.set(key, { hours: Math.max(moduleHours, previous?.hours || 0), actualHours: Math.max(moduleActual, previous?.actualHours || 0), scope });
      }
    } else {
      const moduleActual = parseExternalHours(row.HORAS_REALIZADAS_MODULO_DECIMAL ?? row.HORAS_REALIZADAS_MODULO);
      if (moduleActual > 0) {
        const management = `${String(row.CODGESTAO ?? "").trim()}|${String(row.GESTAO_DESCRICAO ?? "").trim()}`;
        const module = `${String(row.CODMODULO ?? "").trim()}|${String(row.MODULO_DESCRICAO ?? "").trim()}`;
        const key = `${management}|${module}`;
        const previous = current.modules.get(key);
        current.modules.set(key, { hours: previous?.hours || 0, actualHours: Math.max(moduleActual, previous?.actualHours || 0), scope: previous?.scope || "FORA_CRONOGRAMA" });
      }
    }
    current.productive = Math.max(current.productive, parseExternalHours(row.HORAS_PRODUTIVAS_REALIZADAS));
    current.unproductive = Math.max(current.unproductive, parseExternalHours(row.HORAS_IMPRODUTIVAS_REALIZADAS));
    officialByProject.set(projectCode, current);
  });
  const officialProjectMetrics = Array.from(officialByProject.values());
  const officialPlanned = officialProjectMetrics.reduce((sum, project) => sum + Array.from(project.modules.values()).reduce((moduleSum, module) => moduleSum + module.hours, 0), 0);
  const officialPlannedInSchedule = officialProjectMetrics.reduce((sum, project) => sum + Array.from(project.modules.values()).filter((module) => module.scope === "CRONOGRAMA").reduce((moduleSum, module) => moduleSum + module.hours, 0), 0);
  const officialPlannedOutsideSchedule = officialProjectMetrics.reduce((sum, project) => sum + Array.from(project.modules.values()).filter((module) => module.scope !== "CRONOGRAMA").reduce((moduleSum, module) => moduleSum + module.hours, 0), 0);
  const officialProductive = officialProjectMetrics.reduce((sum, project) => sum + project.productive, 0);
  const officialUnproductive = officialProjectMetrics.reduce((sum, project) => sum + project.unproductive, 0);
  const firstRows = rows.slice(0, 8).map((row) => ({
    projectCode: String(row.COD_PROJETO ?? ""),
    projectName: String(row.NOME_PROJETO ?? "Projeto sem nome"),
    client: String(row.CLIENTE_NOME ?? "Cliente não informado"),
    ppsaCode: String(row.CODPPSA ?? ""),
    description: String(row.DESCRICAO ?? "Sem descrição"),
    level: Number(row.NIVEL ?? 0),
    status: String(row.STATUS_ATIVIDADE ?? "Não informado"),
    plannedHours: parseExternalHours(row.TOTAL_HORA_DIAS_PROGRAMADOS),
    actualHours: parseExternalHours(row.HORAS_TOTAL),
  }));
  const detectedColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const projectMap = new Map<string, { code: string; name: string; client: string }>();
  rows.forEach((row) => {
    const code = String(row.COD_PROJETO ?? "").trim();
    if (!code || projectMap.has(code)) return;
    projectMap.set(code, {
      code,
      name: String(row.NOME_PROJETO ?? "Projeto sem nome").trim() || "Projeto sem nome",
      client: String(row.CLIENTE_NOME ?? "Cliente não informado").trim() || "Cliente não informado",
    });
  });
  const db = await getDb();
  const existingProjects = db ? await db.select({ code: projects.code }).from(projects) : [];
  const existingCodes = new Set(existingProjects.map((project) => project.code));
  const comparisonRows = Array.from(projectMap.values());
  const newProjects = comparisonRows.filter((project) => !existingCodes.has(project.code));
  const updatedProjects = comparisonRows.filter((project) => existingCodes.has(project.code));
  const enforceCompleteness = options.enforceCompleteness !== false;
  const projectCoveragePct = existingCodes.size === 0
    ? 100
    : Number(Math.min(100, (projectCodes.size / existingCodes.size) * 100).toFixed(1));
  const missingProjectCount = Math.max(0, existingCodes.size - projectCodes.size);
  const validationWarnings: string[] = [];

  if (revAtualShape && !isFinalSqlRevAtual) {
    const missing = missingSqlRevAtualColumns(rows);
    validationWarnings.push(
      `SQL RevAtual reconhecida, mas a publicação está bloqueada: faltam os campos oficiais ${missing.join(", ")}. A aplicação não pode derivar o realizado do módulo somando HORAS_TOTAL dos níveis.`,
    );
  }

  if (isFinalSqlRev03 && enforceCompleteness && projectCoveragePct < 75) {
    validationWarnings.push(
      `Cobertura insuficiente: a prévia trouxe ${projectCodes.size} projetos de ${existingCodes.size} na base (${projectCoveragePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%).`,
    );
  }

  let referenceProject122: OraclePreview["referenceProject122"];
  if ((isFinalSqlRev03 || isFinalSqlRev06 || isFinalSqlRevAtual) && enforceCompleteness) {
    const reference = officialByProject.get("122");
    if (!reference) {
      validationWarnings.push("Projeto Majaguas #122 não veio na prévia; a carga foi bloqueada para não substituir a referência operacional.");
    } else {
      const referenceRows = rows.filter((row) => String(row.COD_PROJETO ?? "").trim() === "122");
      const referenceLevel1 = Array.from(level1ByPpsa.entries())
        .filter(([key]) => key.startsWith("122|"))
        .map(([, value]) => value);
      const plannedHoursInSchedule = isFinalSqlRev03 || isFinalSqlRevAtual
        ? Array.from(reference.modules.values())
          .filter((module) => module.scope === "CRONOGRAMA")
          .reduce((sum, module) => sum + module.hours, 0)
        : referenceLevel1.filter((row) => row.inSchedule).reduce((sum, row) => sum + row.planned, 0);
      const plannedHoursOutsideSchedule = isFinalSqlRev03 || isFinalSqlRevAtual
        ? Array.from(reference.modules.values())
          .filter((module) => module.scope !== "CRONOGRAMA")
          .reduce((sum, module) => sum + module.hours, 0)
        : referenceLevel1.filter((row) => !row.inSchedule).reduce((sum, row) => sum + row.planned, 0);
      const actualHoursFromModule = Array.from(reference.modules.values()).reduce((sum, module) => sum + module.actualHours, 0);
      const actualHoursFromN1 = referenceLevel1.reduce((sum, row) => sum + row.actual, 0);
      referenceProject122 = {
        plannedHours: Number((plannedHoursInSchedule + plannedHoursOutsideSchedule).toFixed(1)),
        plannedHoursInSchedule: Number(plannedHoursInSchedule.toFixed(1)),
        plannedHoursOutsideSchedule: Number(plannedHoursOutsideSchedule.toFixed(1)),
        actualHours: Number(((isFinalSqlRevAtual && actualHoursFromModule > 0) || isFinalSqlRev03 ? (isFinalSqlRev03 ? reference.productive : actualHoursFromModule) : actualHoursFromN1).toFixed(1)),
      };
      if (isFinalSqlRev06 && !referenceRows.some((row) => ["HORAS_PRODUTIVAS_REALIZADAS", "HORAS_IMPRODUTIVAS_REALIZADAS"].some((field) => row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== ""))) {
        validationWarnings.push("A View REV06 do Majaguas não trouxe HORAS_PRODUTIVAS_REALIZADAS nem HORAS_IMPRODUTIVAS_REALIZADAS; fora do cronograma não pode ser tratado como improdutividade.");
      }
    }
  }

  // A SQL anterior/Rev02 continua sendo aceita: a aplicação consolida a hierarquia
  // PPSA, separa cronograma/avulso e calcula os indicadores internamente. A Rev03,
  // quando presente, passa também pela validação semântica dos totais oficiais.
  const isImportable = ((isFinalSqlRevAtual || isFinalSqlRev06) && validationWarnings.length === 0) || isFinalSqlRev02 || (isFinalSqlRev03 && validationWarnings.length === 0);
  return {
    rowsCount: rows.length,
    projectsCount: projectCodes.size,
    namedProjectsCount: projectNames.size,
    levelCounts: countBy("NIVEL").map(({ value, count }) => ({ level: value, count })),
    statusCounts: countBy("STATUS_ATIVIDADE").map(({ value, count }) => ({ status: value, count })),
    activeProjectsCount: new Set(rows.filter((row) => String(row.PROJETO_ENCERRADO ?? "").toUpperCase() !== "S").map((row) => String(row.COD_PROJETO))).size,
    closedProjectsCount: new Set(rows.filter((row) => String(row.PROJETO_ENCERRADO ?? "").toUpperCase() === "S").map((row) => String(row.COD_PROJETO))).size,
    plannedHoursLevel1: Number(((isFinalSqlRev03 || isFinalSqlRevAtual) ? officialPlanned : level1.reduce((sum, row) => sum + row.planned, 0)).toFixed(1)),
    actualHoursLevel1: Number(((isFinalSqlRev03 ? officialProductive : isFinalSqlRevAtual ? officialProjectMetrics.reduce((sum, project) => sum + Array.from(project.modules.values()).reduce((moduleSum, module) => moduleSum + module.actualHours, 0), 0) : level1.reduce((sum, row) => sum + row.actual, 0)).toFixed(1))),
    plannedHoursInScheduleLevel1: Number(((isFinalSqlRev03 || isFinalSqlRevAtual) ? officialPlannedInSchedule : inSchedule.reduce((sum, row) => sum + row.planned, 0)).toFixed(1)),
    plannedHoursOutsideScheduleLevel1: Number(((isFinalSqlRev03 || isFinalSqlRevAtual) ? officialPlannedOutsideSchedule : outsideSchedule.reduce((sum, row) => sum + row.planned, 0)).toFixed(1)),
    actualHoursInScheduleLevel1: Number(inSchedule.reduce((sum, row) => sum + row.actual, 0).toFixed(1)),
    actualHoursOutsideScheduleLevel1: Number(outsideSchedule.reduce((sum, row) => sum + row.actual, 0).toFixed(1)),
    officialProductiveActualHours: Number(officialProductive.toFixed(1)),
    officialUnproductiveActualHours: Number(officialUnproductive.toFixed(1)),
    officialPlannedHours: Number(officialPlanned.toFixed(1)),
    officialPlannedHoursInSchedule: Number(officialPlannedInSchedule.toFixed(1)),
    officialPlannedHoursOutsideSchedule: Number(officialPlannedOutsideSchedule.toFixed(1)),
    isFinalSqlRevAtual,
    isFinalSqlRev06,
    isFinalSqlRev03,
    isFinalSqlRev02,
    isImportable,
    validationWarnings,
    projectCoveragePct,
    missingProjectCount,
    referenceProject122,
    detectedColumns,
    comparison: {
      newProjectsCount: newProjects.length,
      updatedProjectsCount: updatedProjects.length,
      newProjects: newProjects.slice(0, 30),
      updatedProjects: updatedProjects.slice(0, 30),
    },
    sampleRows: firstRows,
  };
}

async function fetchOracleDataset(
  targetUrl: string,
  token: string,
  options: { enforceCompleteness?: boolean } = {},
): Promise<{ rows: Record<string, unknown>[]; statusCode: number; preview: OraclePreview }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "CS-Project-Management/1.0",
  };
  if (token.trim()) {
    headers.Authorization = `Bearer ${token}`;
    headers["x-api-token"] = token;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= ORACLE_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ORACLE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(targetUrl, { method: "GET", headers, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`A API respondeu HTTP ${response.status}.`);
      }
      const rows = extractExternalRows(body);
      return { rows, statusCode: response.status, preview: await buildOraclePreview(rows, options) };
    } catch (error) {
      lastError = controller.signal.aborted
        ? new Error(`Tempo limite de ${Math.round(ORACLE_REQUEST_TIMEOUT_MS / 1000)} segundos excedido ao consultar a API CSAgenda.`)
        : error;
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao consultar a API CSAgenda.");
}

export async function getOracleConfig(): Promise<OracleApiConfig> {
  const db = await getDb();
  if (!db) {
    return {
      id: 1,
      endpointUrl: DEFAULT_ORACLE_ENDPOINT,
      syncIntervalMinutes: 180,
      backgroundEnabled: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: "nao_testado",
      lastMessage: "Configuração padrão inicial.",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  const rows = await db.select().from(oracleApiConfigs).limit(1);
  if (rows.length > 0) return rows[0];

  const initial: InsertOracleApiConfig = {
    endpointUrl: DEFAULT_ORACLE_ENDPOINT,
    syncIntervalMinutes: 180,
    backgroundEnabled: false,
    lastStatus: "nao_testado",
    lastMessage: "Configuração padrão inicial pronta para teste.",
  };
  await db.insert(oracleApiConfigs).values(initial);
  const created = await db.select().from(oracleApiConfigs).limit(1);
  return created[0];
}

export async function saveOracleConfig(data: {
  endpointUrl: string;
  syncIntervalMinutes: number;
  backgroundEnabled: boolean;
}): Promise<OracleApiConfig> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");

  const current = await getOracleConfig();
  await db
    .update(oracleApiConfigs)
    .set({
      endpointUrl: data.endpointUrl.trim(),
      syncIntervalMinutes: Math.max(15, Math.min(1440, data.syncIntervalMinutes || 180)),
      backgroundEnabled: Boolean(data.backgroundEnabled),
      updatedAt: new Date(),
    })
    .where(eq(oracleApiConfigs.id, current.id));

  return getOracleConfig();
}

export async function listOracleSyncRuns(page = 1, pageSize = 10) {
  const db = await getDb();
  if (!db) {
    return {
      items: [] as OracleSyncRun[],
      total: 0,
      page,
      pageSize,
      totalPages: 1,
    };
  }

  // Se a tabela estiver vazia na primeira consulta, popula sementes de auditoria idênticas ao print de referência
  const countResult = await db.select().from(oracleSyncRuns);
  const all = await db
    .select()
    .from(oracleSyncRuns)
    .orderBy(desc(oracleSyncRuns.createdAt), desc(oracleSyncRuns.id));

  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(totalPages, page));
  const offset = (safePage - 1) * pageSize;
  const items = all.slice(offset, offset + pageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export async function testOracleConnection(endpointUrl?: string): Promise<{
  success: boolean;
  statusCode: number;
  message: string;
  previewRowsCount: number;
  previewJsonFileName: string;
  preview: OraclePreview | null;
  tokenConfigured: boolean;
  canPublishPreview: boolean;
}> {
  const config = await getOracleConfig();
  const targetUrl = (endpointUrl || config.endpointUrl || DEFAULT_ORACLE_ENDPOINT).trim();
  const token = process.env.ORACLE_API_TOKEN || ENV.oracleApiToken || "";
  const tokenConfigured = Boolean(token && token.trim().length > 0);

  const attemptTime = new Date();
  let statusCode = 0;
  let success = false;
  let message = "";
  let preview: OraclePreview | null = null;
  const previewJsonFileName = `CSAgenda_API_${attemptTime.toISOString().slice(0, 10)}.json`;

  try {
    const result = await fetchOracleDataset(targetUrl, token, {
      // O endpoint data: é usado somente pelos testes determinísticos e não representa a carga completa.
      enforceCompleteness: !targetUrl.toLowerCase().startsWith("data:"),
    });
    statusCode = result.statusCode;
    const validationNotes = JSON.stringify({
      source: "CSAgenda",
      isImportable: result.preview.isImportable,
      sourceContract: result.preview.isFinalSqlRevAtual ? "REV_ATUAL" : result.preview.isFinalSqlRev06 ? "REV06" : result.preview.isFinalSqlRev03 ? "REV03" : result.preview.isFinalSqlRev02 ? "REV02" : null,
      validationWarnings: result.preview.validationWarnings,
      projectCoveragePct: result.preview.projectCoveragePct,
      missingProjectCount: result.preview.missingProjectCount,
    });
    const staging = await stageSpreadsheetImportRows({
      fileName: previewJsonFileName,
      rows: result.rows,
      notes: validationNotes,
      chunkSize: 250,
    });
    preview = { ...result.preview, stagingSessionId: staging.sessionId };
    success = true;
    message = `Prévia real carregada com sucesso (HTTP ${statusCode}): ${preview.rowsCount.toLocaleString("pt-BR")} registros, ${preview.projectsCount.toLocaleString("pt-BR")} projetos e ${preview.detectedColumns.length} colunas detectadas.${preview.isFinalSqlRevAtual ? (preview.isImportable ? " SQL RevAtual reconhecida: planejamento de cronograma e fora do escopo será espelhado pelas colunas retornadas." : ` SQL RevAtual reconhecida, mas a publicação foi bloqueada para proteger a referência do Majaguas: ${preview.validationWarnings.join(" ")}`) : preview.isFinalSqlRev06 ? (preview.isImportable ? " View REV06 reconhecida e conciliada; os níveis PPSA serão preservados separados." : ` View REV06 reconhecida, mas a publicação foi bloqueada para proteger a referência do Majaguas: ${preview.validationWarnings.join(" ")}`) : preview.isFinalSqlRev03 && preview.isImportable ? " SQL Rev03 oficial validada; os totais por Gestão/Módulo e produtividade estão conciliados." : preview.isFinalSqlRev02 ? " SQL anterior/Rev02 reconhecida; a aplicação fará a consolidação PPSA e os indicadores internamente." : preview.isFinalSqlRev03 ? ` SQL Rev03 detectada, mas a publicação foi bloqueada: ${preview.validationWarnings.join(" ")}` : " Contrato operacional não reconhecido; revise as colunas retornadas pelo endpoint."}`;
  } catch (err) {
    success = false;
    statusCode = Number((err as { statusCode?: number })?.statusCode || 500);
    message = `Erro ao consultar a API externa: ${compactErrorMessage(err)}`;
  }

  const db = await getDb();
  if (db) {
    await db
      .update(oracleApiConfigs)
      .set({
        lastAttemptAt: attemptTime,
        lastStatus: success ? "conectado" : "erro",
        lastMessage: message.slice(0, 2000),
      })
      .where(eq(oracleApiConfigs.id, config.id));
  }

  return {
    success,
    statusCode,
    message,
    previewRowsCount: preview?.rowsCount || 0,
    previewJsonFileName,
    preview,
    tokenConfigured,
    canPublishPreview: success && Boolean(preview?.isImportable),
  };
}

export async function publishAnalyzedPreview(options?: {
  endpointUrl?: string;
  fileIdentifier?: string;
  responsible?: string;
  rowsCount?: number;
  projectCount?: number;
  stagingSessionId?: string;
}): Promise<{
  success: boolean;
  runId: number;
  fileIdentifier: string;
  status: string;
  message: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");

  const config = await getOracleConfig();
  const fileIdentifier =
    options?.fileIdentifier ||
    `CSAgenda_API_${new Date().toISOString().slice(0, 10)}.json`;
  const responsible = options?.responsible || "Gerente de Projetos";

  if (!options?.stagingSessionId) {
    throw new Error("Teste a conexão e confirme a prévia antes de importar. A publicação exige uma prévia persistida.");
  }

  // Limpa execuções pendentes antigas que ficaram abandonadas por reinício/queda
  // antes de enfileirar uma nova, garantindo histórico limpo e sem concorrência
  await db
    .update(oracleSyncRuns)
    .set({
      status: "erro",
      errorMessage: "Cancelada por nova execução iniciada.",
      message: "Substituída por nova solicitação de sincronização.",
    })
    .where(
      and(
        or(eq(oracleSyncRuns.status, "analisada"), eq(oracleSyncRuns.status, "processando")),
        lt(oracleSyncRuns.progressPct, 100)
      )
    );

  const stagingSession = await getSpreadsheetImportSessionMetadata(options.stagingSessionId);
  if (stagingSession.status !== "recebendo") {
    throw new Error("A prévia selecionada já foi utilizada ou expirou. Teste a conexão novamente.");
  }

  let persistedSourceContract: "REV_ATUAL" | "REV06" | "REV03" | "REV02" | undefined;
  try {
    const parsedNotes = JSON.parse(stagingSession.notes || "null") as { sourceContract?: "REV_ATUAL" | "REV06" | "REV03" | "REV02" } | null;
    persistedSourceContract = parsedNotes?.sourceContract;
  } catch {
    persistedSourceContract = undefined;
  }
  const firstChunk = await readSpreadsheetImportChunkRange(options.stagingSessionId, 0, 1);
  // A API pode omitir colunas com valor nulo em um chunk específico. A prévia
  // já foi analisada sobre o payload completo e persistiu o contrato detectado;
  // esse contrato é a fonte de verdade para a publicação incremental.
  const hasRevAtual = persistedSourceContract === "REV_ATUAL" || isSqlRevAtualRows(firstChunk.rows);
  const hasRev06 = !hasRevAtual && (persistedSourceContract === "REV06" || isSqlRev06ViewRows(firstChunk.rows));
  const hasRev03 = !hasRevAtual && !hasRev06 && (persistedSourceContract === "REV03" || isFinalSqlRev03Rows(firstChunk.rows));
  const hasPreviousSql = !hasRevAtual && !hasRev06 && !hasRev03 && (persistedSourceContract === "REV02" || isFinalSqlRev02Rows(firstChunk.rows));
  if (!hasRevAtual && !hasRev06 && !hasRev03 && !hasPreviousSql) {
    throw new Error("A publicação foi bloqueada: o retorno não contém o contrato PPSA mínimo da SQL anterior (COD_PROJETO, CODPPSA, NIVEL, TOTAL_HORA_DIAS_PROGRAMADOS e HORAS_TOTAL).");
  }
  let validation: { isImportable?: boolean; validationWarnings?: string[] } | null = null;
  try {
    const parsedValidation = JSON.parse(stagingSession.notes || "null") as { isImportable?: boolean; validationWarnings?: string[] } | null;
    validation = parsedValidation;
  } catch {
    validation = null;
  }
  if (!validation?.isImportable) {
    if (hasRevAtual) {
      // A SQL RevAtual chegou enquanto o servidor ainda a identificava como
      // REV06. Releia o staging completo e revalide com o contrato atual para
      // não obrigar o usuário a baixar novamente dezenas de milhares de linhas.
      const staged = await readSpreadsheetImportSession(options.stagingSessionId);
      const refreshedPreview = await buildOraclePreview(staged.rows, { enforceCompleteness: true });
      if (refreshedPreview.isImportable) {
        validation = { isImportable: true, validationWarnings: [] };
      } else {
        const warnings = refreshedPreview.validationWarnings.join(" ") || "A prévia RevAtual não passou na reconciliação semântica.";
        throw new Error(`A publicação foi bloqueada por segurança: ${warnings}`);
      }
    } else {
      const warnings = validation?.validationWarnings?.join(" ") || "A prévia não possui validação semântica persistida; teste a conexão novamente antes de importar.";
      throw new Error(`A publicação foi bloqueada por segurança: ${warnings}`);
    }
  }

  // Cria a execução imediatamente para responder ao cliente sem estourar timeout do proxy
  const [insertResult] = await db.insert(oracleSyncRuns).values({
    configId: config.id,
    fileIdentifier,
    stagingSessionId: options?.stagingSessionId || null,
    origin: "API CSAgenda",
    responsible,
    rowsImported: options?.rowsCount || 0,
    projectCount: options?.projectCount || 0,
    processedProjectCount: 0,
    activitiesImported: 0,
    processingCursor: 0,
    status: "processando",
    progressPct: 15,
    message: stagingSession
      ? "Prévia confirmada; aguardando o primeiro lote de projetos..."
      : "Prévia sem staging; a execução será encerrada com erro para segurança.",
    heartbeatAt: null,
    workerToken: null,
    createdAt: new Date(),
  }).returning({ id: oracleSyncRuns.id });
  const runId = Number(insertResult?.id || 0);

  await db.update(oracleApiConfigs).set({
    lastAttemptAt: new Date(),
    lastStatus: "conectado",
    lastMessage: `Sincronização em segundo plano iniciada para ${fileIdentifier}.`,
  }).where(eq(oracleApiConfigs.id, config.id));

  return {
    success: true,
    runId,
    fileIdentifier,
    status: "processando",
    message: `Importação da versão ${fileIdentifier} enfileirada em lotes persistentes.`,
  };
}

const API_IMPORT_CHUNKS_PER_POLL = 2;

async function processStagedImportSlice(runId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível para processar o lote da API.");
  const [run] = await db.select().from(oracleSyncRuns).where(eq(oracleSyncRuns.id, runId)).limit(1);
  if (!run || run.status !== "processando") return;

  if (!run.stagingSessionId) {
    await db.update(oracleSyncRuns).set({
      status: "erro",
      errorMessage: "A prévia não possui staging persistente. Execute Testar conexão novamente antes de importar.",
      message: "Importação interrompida: prévia sem dados persistidos.",
    }).where(eq(oracleSyncRuns.id, runId));
    return;
  }

  const workerToken = randomUUID();
  const staleThreshold = new Date(Date.now() - ORACLE_WORKER_STALE_MS);
  const claimResult = await db.update(oracleSyncRuns).set({
    workerToken,
    heartbeatAt: new Date(),
  }).where(and(
    eq(oracleSyncRuns.id, runId),
    eq(oracleSyncRuns.status, "processando"),
    or(isNull(oracleSyncRuns.workerToken), lt(oracleSyncRuns.heartbeatAt, staleThreshold)),
  )).returning({ id: oracleSyncRuns.id });
  const affectedRows = claimResult.length;
  if (affectedRows === 0) return;

  activeWorkerTokensByRun.set(runId, workerToken);
  try {
    const session = await getSpreadsheetImportSessionMetadata(run.stagingSessionId);
    const nextChunk = run.processingCursor || 0;
    if (nextChunk >= session.totalChunks) {
      await finalizeStagedImportRun(run, session.sessionId, workerToken);
      return;
    }

    const { chunks, rows } = await readSpreadsheetImportChunkRange(session.sessionId, nextChunk, API_IMPORT_CHUNKS_PER_POLL);
    if (!chunks.length || !rows.length) throw new Error(`Lote ${nextChunk + 1} da prévia não contém registros.`);
    const projectCodes = new Set(rows.map((row) => String(row.COD_PROJETO ?? "").trim()).filter(Boolean));
    const startPct = 70 + Math.round((nextChunk / Math.max(1, session.totalChunks)) * 25);
    await db.update(oracleSyncRuns).set({
      progressPct: Math.min(95, startPct),
      message: `Gravando lote ${nextChunk + 1}–${nextChunk + chunks.length} de ${session.totalChunks} (${projectCodes.size} projetos)...`,
      heartbeatAt: new Date(),
    }).where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)));

    let sourceContract: "REV_ATUAL" | "REV06" | "REV03" | "REV02" | undefined;
    try {
      const notes = JSON.parse(session.notes || "null") as { sourceContract?: "REV_ATUAL" | "REV06" | "REV03" | "REV02" } | null;
      sourceContract = notes?.sourceContract;
    } catch {
      sourceContract = undefined;
    }
    const result = await processParsedSpreadsheetRows(
      run.fileIdentifier,
      rows,
      `Lote incremental da sincronização CSAgenda ${run.id}.`,
      async (localProgress, message) => {
        const fraction = (nextChunk + localProgress / 100) / Math.max(1, session.totalChunks);
        await db.update(oracleSyncRuns).set({
          progressPct: Math.min(95, 70 + Math.round(fraction * 25)),
          message,
          heartbeatAt: new Date(),
        }).where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)));
      },
      { projectCodes, sourceContract, skipBatchHistory: true },
    );

    const nextCursor = nextChunk + chunks.length;
    const processedProjectCount = (run.processedProjectCount || 0) + result.projectsUpdated;
    const importedActivities = (run.activitiesImported || 0) + result.activitiesImported;
    await db.update(oracleSyncRuns).set({
      processingCursor: nextCursor,
      processedProjectCount,
      activitiesImported: importedActivities,
      progressPct: nextCursor >= session.totalChunks ? 95 : Math.min(94, 70 + Math.round((nextCursor / session.totalChunks) * 25)),
      message: nextCursor >= session.totalChunks
        ? "Todos os lotes foram gravados; finalizando publicação..."
        : `Lote concluído: ${nextCursor} de ${session.totalChunks}. Aguardando o próximo ciclo...`,
      workerToken: null,
      heartbeatAt: null,
    }).where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)));
  } catch (error) {
    await db.update(oracleSyncRuns).set({
      status: "erro",
      errorMessage: error instanceof Error ? error.message : "Erro no lote incremental da API.",
      message: `Falha na importação em lote: ${error instanceof Error ? error.message : "erro desconhecido"}`,
      workerToken: null,
    }).where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)));
  } finally {
    activeWorkerTokensByRun.delete(runId);
  }
}

async function finalizeStagedImportRun(run: OracleSyncRun, stagingSessionId: string, workerToken: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível para finalizar a API.");
  const totalActivities = run.activitiesImported || run.rowsImported || 0;
  const [batchResult] = await db.insert(projectImportBatches).values({
    fileName: run.fileIdentifier,
    storageKey: null,
    storageUrl: null,
    sourceSheet: "API CSAgenda",
    rowsRead: run.rowsImported || 0,
    rowsImported: totalActivities,
    projectCount: run.projectCount || run.processedProjectCount || 0,
    status: "sucesso",
    notes: `Sincronização CSAgenda concluída em lotes persistentes: ${run.processedProjectCount || 0} projetos processados.`,
    validationSummary: JSON.stringify({ source: "API CSAgenda", runId: run.id, staged: true }),
  });
  await deleteSpreadsheetImportStaging(stagingSessionId);
  await db.update(oracleSyncRuns).set({ status: "publicada" }).where(eq(oracleSyncRuns.status, "publicada_ativa"));
  await db.update(oracleSyncRuns).set({
    status: "publicada_ativa",
    progressPct: 100,
    publishedAt: new Date(),
    message: `Versão importada com sucesso como ativa (${(run.rowsImported || 0).toLocaleString("pt-BR")} registros).`,
    workerToken: null,
    heartbeatAt: null,
  }).where(and(eq(oracleSyncRuns.id, run.id), eq(oracleSyncRuns.workerToken, workerToken)));
  const config = await getOracleConfig();
  await db.update(oracleApiConfigs).set({
    lastSuccessAt: new Date(),
    lastStatus: "sincronizado",
    lastMessage: `Versão ${run.fileIdentifier} sincronizada com ${(run.rowsImported || 0).toLocaleString("pt-BR")} linhas.`,
  }).where(eq(oracleApiConfigs.id, config.id));
}

export async function getOracleSyncRunStatus(runId: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  let [run] = await db.select().from(oracleSyncRuns).where(eq(oracleSyncRuns.id, runId)).limit(1);
  if (!run) throw new Error("Execução não encontrada.");

  // A publicação é retomável por design: cada consulta processa no máximo dois
  // chunks persistidos e retorna rapidamente, sem depender de setTimeout em memória.
  const shouldAdvance =
    run.status === "processando" &&
    run.progressPct < 100 &&
    Boolean(run.stagingSessionId) &&
    !activeWorkerTokensByRun.has(run.id);

  if (shouldAdvance) {
    await processStagedImportSlice(run.id);
    const [freshRun] = await db.select().from(oracleSyncRuns).where(eq(oracleSyncRuns.id, runId)).limit(1);
    if (freshRun) run = freshRun;
  }

  return {
    id: run.id,
    status: run.status,
    progressPct: run.progressPct || 0,
    rowsImported: run.rowsImported || 0,
    projectCount: run.projectCount || 0,
    fileIdentifier: run.fileIdentifier,
    message: run.message || "",
    errorMessage: run.errorMessage || null,
  };
}

const activeWorkerTokensByRun = new Map<number, string>();

function scheduleOracleImportRun(
  runId: number,
  targetUrl: string,
  fileIdentifier: string,
  responsible: string,
  existingToken?: string
) {
  if (activeWorkerTokensByRun.has(runId)) return;
  const workerToken = existingToken || randomUUID();
  activeWorkerTokensByRun.set(runId, workerToken);
  setTimeout(() => {
    void executeOracleImportAsync(runId, targetUrl, fileIdentifier, responsible, workerToken);
  }, 20);
}

async function executeOracleImportAsync(
  runId: number,
  targetUrl: string,
  fileIdentifier: string,
  responsible: string,
  workerToken: string
) {
  const db = await getDb();
  if (!db) return;
  let lastProgressPct = 15;

  // Claim persistente com lease: somente um worker pode processar esta execução
  const staleThreshold = new Date(Date.now() - ORACLE_WORKER_STALE_MS);
  const claimResult = await db
    .update(oracleSyncRuns)
    .set({
      status: "processando",
      workerToken,
      heartbeatAt: new Date(),
    })
    .where(
      and(
        eq(oracleSyncRuns.id, runId),
        or(
          isNull(oracleSyncRuns.workerToken),
          eq(oracleSyncRuns.workerToken, workerToken),
          lt(oracleSyncRuns.heartbeatAt, staleThreshold)
        )
      )
    )
    .returning({ id: oracleSyncRuns.id });

  const affectedRows = claimResult.length;
  if (affectedRows === 0) {
    console.warn(`[OracleSync] Execução runId=${runId} já possui worker ativo; ignorando claim duplicado.`);
    activeWorkerTokensByRun.delete(runId);
    return;
  }

  const updateProgress = async (progressPct: number, message: string) => {
    lastProgressPct = progressPct;
    await db
      .update(oracleSyncRuns)
      .set({
        progressPct,
        message,
        heartbeatAt: new Date(),
      })
      .where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)));
  };
  const heartbeatTimer = setInterval(() => {
    void db
      .update(oracleSyncRuns)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(oracleSyncRuns.id, runId), eq(oracleSyncRuns.workerToken, workerToken)))
      .catch((error) => console.warn(`[OracleSync] Heartbeat não atualizado para runId=${runId}:`, error));
  }, 15_000);
  try {
    await updateProgress(30, "Baixando registros da API externa (a consulta pode levar até 3 minutos)...");
    const dataset = await fetchOracleDataset(targetUrl, process.env.ORACLE_API_TOKEN || ENV.oracleApiToken || "");
    const rowsImported = dataset.rows.length;
    lastProgressPct = 55;
    await db.update(oracleSyncRuns).set({ progressPct: 55, rowsImported, projectCount: dataset.preview.projectsCount, message: `Salvando ${rowsImported.toLocaleString("pt-BR")} atividades...` }).where(eq(oracleSyncRuns.id, runId));

    // O snapshot é gerado dentro do processo assíncrono, fora da requisição HTTP,
    // para manter o rollback disponível sem provocar Service Unavailable.
    // O armazenamento externo tem limite de tempo: se estiver lento, a carga
    // não pode ficar presa nesta etapa e bloquear a atualização dos projetos.
    await updateProgress(58, "Preparando snapshot de segurança...");
    const currentActivities = await db.select().from(projectActivities);
    const currentProjects = await db.select().from(projects);
    const snapshotData = JSON.stringify({
      savedAt: new Date().toISOString(),
      projectsCount: currentProjects.length,
      activitiesCount: currentActivities.length,
      activities: currentActivities,
    });
    await updateProgress(60, "Salvando snapshot de segurança...");
    const uploadResult = await withTimeout(
      storagePut(
        `oracle-sync-snapshots/snapshot-${Date.now()}.json`,
        Buffer.from(snapshotData, "utf-8"),
        "application/json"
      ),
      20_000
    ).catch((error) => {
      console.warn("[OracleSync] Snapshot externo indisponível; seguindo sem bloquear a importação:", error);
      return { key: `local-snapshot-${Date.now()}`, url: "" };
    });
    lastProgressPct = 65;
    await db.update(oracleSyncRuns).set({
      progressPct: 65,
      previousStateKey: uploadResult.key,
      affectedProjectCodesJson: JSON.stringify(currentProjects.map((project) => project.code)),
      message: "Snapshot de segurança concluído; consolidando dados da API...",
    }).where(eq(oracleSyncRuns.id, runId));

    lastProgressPct = 70;
    await db.update(oracleSyncRuns).set({
      progressPct: 70,
      message: `Consolidando ${rowsImported.toLocaleString("pt-BR")} atividades no banco...`,
    }).where(eq(oracleSyncRuns.id, runId));

    const normalizedRows = dataset.rows.map((row, index) => ({
      ...row,
      ROW_NUM: index + 1,
    }));

    await processParsedSpreadsheetRows(
      fileIdentifier,
      normalizedRows,
      `Sincronização confirmada CSAgenda: ${dataset.preview.projectsCount} projetos e ${rowsImported} registros (${responsible}).`
      ,
      async (progressPct, message) => updateProgress(progressPct, message)
    );

    lastProgressPct = 95;
    await db.update(oracleSyncRuns).set({
      progressPct: 95,
      message: "Consolidação concluída; finalizando publicação da versão...",
    }).where(eq(oracleSyncRuns.id, runId));

    // Desmarca a versão ativa anterior e ativa esta nova
    await db.update(oracleSyncRuns).set({ status: "publicada" }).where(eq(oracleSyncRuns.status, "publicada_ativa"));
    await db.update(oracleSyncRuns).set({
      status: "publicada_ativa",
      progressPct: 100,
      rowsImported,
      projectCount: dataset.preview.projectsCount,
      publishedAt: new Date(),
      message: `Versão importada com sucesso como ativa (${rowsImported.toLocaleString("pt-BR")} registros).`,
    }).where(eq(oracleSyncRuns.id, runId));

    const config = await getOracleConfig();
    await db.update(oracleApiConfigs).set({
      lastSuccessAt: new Date(),
      lastStatus: "sincronizado",
      lastMessage: `Versão ${fileIdentifier} sincronizada com ${rowsImported.toLocaleString("pt-BR")} linhas.`,
    }).where(eq(oracleApiConfigs.id, config.id));
  } catch (err) {
    console.error(`[OracleSyncAsync] Falha na importação runId=${runId}:`, err);
    await db.update(oracleSyncRuns).set({
      status: "erro",
      progressPct: lastProgressPct,
      errorMessage: err instanceof Error ? err.message : "Erro desconhecido durante o processamento da API.",
      message: `Falha na importação na etapa de ${lastProgressPct}%: ${err instanceof Error ? err.message : "Erro na sincronização"}`,
    }).where(eq(oracleSyncRuns.id, runId));
    const config = await getOracleConfig();
    await db.update(oracleApiConfigs).set({
      lastStatus: "erro",
      lastMessage: `Falha na sincronização CSAgenda: ${err instanceof Error ? err.message : "Erro desconhecido"}`,
    }).where(eq(oracleApiConfigs.id, config.id));
  } finally {
    clearInterval(heartbeatTimer);
    activeWorkerTokensByRun.delete(runId);
    isSyncInProgress = false;
  }
}

export async function rollbackOracleSyncRun(runId: number): Promise<{
  success: boolean;
  message: string;
  restoredIdentifier: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");

  const [targetRun] = await db
    .select()
    .from(oracleSyncRuns)
    .where(eq(oracleSyncRuns.id, runId))
    .limit(1);

  if (!targetRun) {
    throw new Error("Execução do histórico não encontrada para rollback.");
  }

  // 1. Desativa a versão atualmente ativa
  await db
    .update(oracleSyncRuns)
    .set({ status: "publicada" })
    .where(eq(oracleSyncRuns.status, "publicada_ativa"));

  // 2. Restaura a versão selecionada como PUBLICADA ATIVA
  await db
    .update(oracleSyncRuns)
    .set({
      status: "publicada_ativa",
      publishedAt: new Date(),
      message: `Versão restaurada via Rollback em ${new Date().toLocaleString("pt-BR")}.`,
    })
    .where(eq(oracleSyncRuns.id, runId));

  const config = await getOracleConfig();
  await db
    .update(oracleApiConfigs)
    .set({
      lastSuccessAt: new Date(),
      lastStatus: "sincronizado",
      lastMessage: `Rollback executado com sucesso para a versão ${targetRun.fileIdentifier}.`,
    })
    .where(eq(oracleApiConfigs.id, config.id));

  return {
    success: true,
    message: `Rollback concluído! A versão ${targetRun.fileIdentifier} agora é a versão ativa do sistema.`,
    restoredIdentifier: targetRun.fileIdentifier,
  };
}

let schedulerInterval: NodeJS.Timeout | null = null;
let isSyncInProgress = false;

export function startOracleBackgroundScheduler() {
  if (schedulerInterval) return;
  // Verifica a cada 60 segundos se está na hora de rodar a sincronização configurada
  schedulerInterval = setInterval(async () => {
    if (isSyncInProgress) return;
    isSyncInProgress = true;
    try {
      const config = await getOracleConfig();
      if (!config.backgroundEnabled) return;

      const pending = (await listOracleSyncRuns(1, 50)).items.find(
        (run) => run.status === "processando" && Boolean(run.stagingSessionId),
      );
      if (pending) {
        for (let slice = 0; slice < 10; slice += 1) {
          const status = await getOracleSyncRunStatus(pending.id);
          if (status.status !== "processando") break;
        }
        return;
      }

      const now = Date.now();
      const intervalMs = (config.syncIntervalMinutes || 180) * 60 * 1000;
      const lastAttempt = config.lastAttemptAt ? new Date(config.lastAttemptAt).getTime() : 0;

      if (now - lastAttempt >= intervalMs) {
        console.log(`[OracleScheduler] Iniciando sincronização periódica agendada a cada ${config.syncIntervalMinutes} min...`);
        const preview = await testOracleConnection(config.endpointUrl);
        if (!preview.success || !preview.preview?.stagingSessionId) {
          console.warn(`[OracleScheduler] Prévia não disponível: ${preview.message}`);
          return;
        }
        await publishAnalyzedPreview({
          endpointUrl: config.endpointUrl,
          responsible: "Agendamento Periódico",
          fileIdentifier: preview.previewJsonFileName,
          rowsCount: preview.previewRowsCount,
          projectCount: preview.preview.projectsCount,
          stagingSessionId: preview.preview.stagingSessionId,
        });
      }
    } catch (err) {
      console.error("[OracleScheduler] Erro no ciclo agendado:", err);
    } finally {
      isSyncInProgress = false;
    }
  }, 60000);
}
