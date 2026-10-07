import crypto from "crypto";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "./db";
import {
  spreadsheetImportChunks,
  spreadsheetImportSessions,
} from "../drizzle/schema";
import { processParsedSpreadsheetRows } from "./spreadsheetService";

export type SpreadsheetImportRow = Record<string, any>;

const MAX_CHUNKS = 2000;
const MAX_ROWS = 100_000;

export async function createSpreadsheetImportSession(input: {
  fileName: string;
  notes?: string;
  totalChunks: number;
  totalRows: number;
}): Promise<{ sessionId: string; totalChunks: number; totalRows: number }> {
  if (!Number.isInteger(input.totalChunks) || input.totalChunks < 1 || input.totalChunks > MAX_CHUNKS) {
    throw new Error("Quantidade de blocos inválida para a importação.");
  }
  if (!Number.isInteger(input.totalRows) || input.totalRows < 1 || input.totalRows > MAX_ROWS) {
    throw new Error("Quantidade de linhas inválida para a importação.");
  }

  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para iniciar importação.");

  const sessionId = crypto.randomUUID();
  await db.insert(spreadsheetImportSessions).values({
    sessionId,
    fileName: input.fileName.slice(0, 255),
    notes: input.notes?.slice(0, 2000),
    totalChunks: input.totalChunks,
    totalRows: input.totalRows,
    status: "recebendo",
    progressPct: 0,
  });

  return { sessionId, totalChunks: input.totalChunks, totalRows: input.totalRows };
}

/** Persiste a prévia externa antes do clique em Importar. */
export async function stageSpreadsheetImportRows(input: {
  fileName: string;
  notes?: string;
  rows: Record<string, any>[];
  chunkSize?: number;
}): Promise<{ sessionId: string; totalChunks: number; totalRows: number }> {
  const chunkSize = Math.max(50, Math.min(500, input.chunkSize || 250));
  const rowsByProject = new Map<string, Record<string, any>[]>();
  input.rows.forEach((row) => {
    const code = String(row.COD_PROJETO ?? "").trim() || "SEM_PROJETO";
    const projectRows = rowsByProject.get(code);
    if (projectRows) projectRows.push(row);
    else rowsByProject.set(code, [row]);
  });
  const projectGroups = Array.from(rowsByProject.values());
  const chunksRows: Record<string, any>[][] = [];
  let currentChunk: Record<string, any>[] = [];
  for (const projectRows of projectGroups) {
    if (currentChunk.length > 0 && currentChunk.length + projectRows.length > chunkSize) {
      chunksRows.push(currentChunk);
      currentChunk = [];
    }
    currentChunk.push(...projectRows);
  }
  if (currentChunk.length > 0) chunksRows.push(currentChunk);
  const totalChunks = Math.max(1, chunksRows.length);
  const session = await createSpreadsheetImportSession({
    fileName: input.fileName,
    notes: input.notes,
    totalChunks,
    totalRows: input.rows.length,
  });
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para salvar a prévia.");
  const chunks = chunksRows.map((rows, chunkIndex) => ({
    sessionId: session.sessionId,
    chunkIndex,
    rowCount: rows.length,
    // A View REV06 pode concentrar mais de 20 mil linhas em um projeto.
    // O projeto permanece inteiro no mesmo chunk para não quebrar a hierarquia PPSA;
    // os INSERTs são fracionados para não criar uma única query de dezenas de MB.
    rowsJson: JSON.stringify(rows),
  }));
  try {
    for (let offset = 0; offset < chunks.length; offset += 8) {
      await db.insert(spreadsheetImportChunks).values(chunks.slice(offset, offset + 8));
    }
  } catch (error) {
    await deleteSpreadsheetImportStaging(session.sessionId).catch(() => undefined);
    throw error;
  }
  return session;
}

export async function appendSpreadsheetImportChunk(input: {
  sessionId: string;
  chunkIndex: number;
  rows: Record<string, any>[];
}): Promise<{ receivedChunks: number; totalChunks: number; receivedRows: number; totalRows: number; progressPct: number }> {
  if (!Number.isInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= MAX_CHUNKS) {
    throw new Error("Índice de bloco inválido para a importação.");
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("O bloco de importação não contém linhas.");
  }

  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para salvar bloco.");

  const sessionList = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, input.sessionId))
    .limit(1);

  const session = sessionList[0];
  if (!session || session.status !== "recebendo") {
    throw new Error("Sessão de importação expirada ou não encontrada. Selecione a planilha novamente.");
  }

  const existing = await db
    .select()
    .from(spreadsheetImportChunks)
    .where(eq(spreadsheetImportChunks.sessionId, input.sessionId));

  const alreadySaved = existing.find((c) => c.chunkIndex === input.chunkIndex);
  const rowsJson = JSON.stringify(input.rows);

  if (alreadySaved) {
    await db
      .update(spreadsheetImportChunks)
      .set({
        rowCount: input.rows.length,
        rowsJson,
      })
      .where(eq(spreadsheetImportChunks.id, alreadySaved.id));
  } else {
    await db.insert(spreadsheetImportChunks).values({
      sessionId: input.sessionId,
      chunkIndex: input.chunkIndex,
      rowCount: input.rows.length,
      rowsJson,
    });
  }

  const updatedChunks = await db
    .select({
      chunkIndex: spreadsheetImportChunks.chunkIndex,
      rowCount: spreadsheetImportChunks.rowCount,
    })
    .from(spreadsheetImportChunks)
    .where(eq(spreadsheetImportChunks.sessionId, input.sessionId));

  const receivedChunks = updatedChunks.length;
  const receivedRows = updatedChunks.reduce((acc, item) => acc + item.rowCount, 0);

  return {
    receivedChunks,
    totalChunks: session.totalChunks,
    receivedRows,
    totalRows: session.totalRows,
    progressPct: Math.min(99, Math.round((receivedRows / Math.max(1, session.totalRows)) * 100)),
  };
}

export async function startProcessingSpreadsheetImportSession(sessionId: string): Promise<{ status: string; progressPct: number }> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");

  const sessionList = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, sessionId))
    .limit(1);

  const session = sessionList[0];
  if (!session) throw new Error("Sessão de importação não encontrada.");
  if (session.status === "processando" || session.status === "concluida") {
    return { status: session.status, progressPct: session.progressPct };
  }

  await db
    .update(spreadsheetImportSessions)
    .set({ status: "processando", progressPct: 95 })
    .where(eq(spreadsheetImportSessions.sessionId, sessionId));

  // Executa o processamento em segundo plano sem travar a requisição HTTP do navegador
  setTimeout(async () => {
    try {
      const asyncDb = await getDb();
      if (!asyncDb) return;

      const chunks = await asyncDb
        .select()
        .from(spreadsheetImportChunks)
        .where(eq(spreadsheetImportChunks.sessionId, sessionId))
        .orderBy(asc(spreadsheetImportChunks.chunkIndex));

      const rows: Record<string, any>[] = [];
      for (const chunk of chunks) {
        rows.push(...JSON.parse(chunk.rowsJson));
      }

      const result = await processParsedSpreadsheetRows(session.fileName, rows, session.notes || undefined);

      await asyncDb
        .update(spreadsheetImportSessions)
        .set({
          status: "concluida",
          progressPct: 100,
          resultBatchId: result.batchId,
          projectsUpdated: result.projectsUpdated,
          activitiesImported: result.activitiesImported,
        })
        .where(eq(spreadsheetImportSessions.sessionId, sessionId));

      await asyncDb
        .delete(spreadsheetImportChunks)
        .where(eq(spreadsheetImportChunks.sessionId, sessionId));
    } catch (err) {
      console.error("[SpreadsheetImportAsync] Falha no processamento:", err);
      const asyncDb = await getDb();
      if (asyncDb) {
        await asyncDb
          .update(spreadsheetImportSessions)
          .set({
            status: "erro",
            errorMessage: err instanceof Error ? err.message : "Erro desconhecido na gravação dos projetos.",
          })
          .where(eq(spreadsheetImportSessions.sessionId, sessionId));
      }
    }
  }, 10);

  return { status: "processando", progressPct: 95 };
}

export async function getSpreadsheetImportSessionStatus(sessionId: string): Promise<{
  sessionId: string;
  status: "recebendo" | "processando" | "concluida" | "erro" | "expirada";
  progressPct: number;
  projectsUpdated: number;
  activitiesImported: number;
  resultBatchId?: number | null;
  errorMessage?: string | null;
}> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível.");

  const sessionList = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, sessionId))
    .limit(1);

  const session = sessionList[0];
  if (!session) throw new Error("Sessão não encontrada.");

  return {
    sessionId: session.sessionId,
    status: session.status,
    progressPct: session.progressPct,
    projectsUpdated: session.projectsUpdated,
    activitiesImported: session.activitiesImported,
    resultBatchId: session.resultBatchId,
    errorMessage: session.errorMessage,
  };
}

export async function readSpreadsheetImportSession(sessionId: string): Promise<{
  session: typeof spreadsheetImportSessions.$inferSelect;
  rows: Record<string, any>[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para ler a prévia.");
  const [session] = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, sessionId))
    .limit(1);
  if (!session) throw new Error("Sessão de prévia não encontrada ou expirada.");
  const chunks = await db
    .select()
    .from(spreadsheetImportChunks)
    .where(eq(spreadsheetImportChunks.sessionId, sessionId))
    .orderBy(asc(spreadsheetImportChunks.chunkIndex));
  const rows: Record<string, any>[] = [];
  for (const chunk of chunks) {
    const parsed = JSON.parse(chunk.rowsJson);
    if (Array.isArray(parsed)) rows.push(...parsed);
  }
  if (rows.length !== session.totalRows) {
    throw new Error(`Prévia incompleta: ${rows.length} de ${session.totalRows} registros persistidos.`);
  }
  return { session, rows };
}

export async function getSpreadsheetImportSessionMetadata(sessionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para consultar a prévia.");
  const [session] = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, sessionId))
    .limit(1);
  if (!session) throw new Error("Sessão de prévia não encontrada ou expirada.");
  return session;
}

export async function readSpreadsheetImportChunkRange(sessionId: string, startIndex: number, count: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para ler o lote da prévia.");
  const chunks = await db
    .select()
    .from(spreadsheetImportChunks)
    .where(and(
      eq(spreadsheetImportChunks.sessionId, sessionId),
      gte(spreadsheetImportChunks.chunkIndex, startIndex),
      lt(spreadsheetImportChunks.chunkIndex, startIndex + count),
    ))
    .orderBy(asc(spreadsheetImportChunks.chunkIndex));
  const rows: Record<string, any>[] = [];
  for (const chunk of chunks) {
    const parsed = JSON.parse(chunk.rowsJson);
    if (Array.isArray(parsed)) rows.push(...parsed);
  }
  return { chunks, rows };
}

export async function deleteSpreadsheetImportStaging(sessionId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(spreadsheetImportChunks).where(eq(spreadsheetImportChunks.sessionId, sessionId));
  await db.delete(spreadsheetImportSessions).where(eq(spreadsheetImportSessions.sessionId, sessionId));
}

export async function takeSpreadsheetImportSession(sessionId: string): Promise<{
  fileName: string;
  notes?: string;
  rows: Record<string, any>[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados não disponível para concluir importação.");

  const sessionList = await db
    .select()
    .from(spreadsheetImportSessions)
    .where(eq(spreadsheetImportSessions.sessionId, sessionId))
    .limit(1);

  const session = sessionList[0];
  if (!session) throw new Error("Sessão de importação expirada ou não encontrada. Selecione a planilha novamente.");

  const chunks = await db
    .select()
    .from(spreadsheetImportChunks)
    .where(eq(spreadsheetImportChunks.sessionId, sessionId))
    .orderBy(asc(spreadsheetImportChunks.chunkIndex));

  if (chunks.length !== session.totalChunks) {
    throw new Error(`Importação incompleta: ${chunks.length} de ${session.totalChunks} blocos recebidos.`);
  }

  const rows: Record<string, any>[] = [];
  for (let index = 0; index < session.totalChunks; index += 1) {
    const chunk = chunks.find((c) => c.chunkIndex === index);
    if (!chunk) throw new Error(`Bloco ${index + 1} de ${session.totalChunks} ausente na montagem.`);
    try {
      const parsedRows = JSON.parse(chunk.rowsJson);
      rows.push(...parsedRows);
    } catch {
      throw new Error(`Falha ao deserializar o bloco ${index + 1} da planilha.`);
    }
  }

  if (rows.length !== session.totalRows) {
    throw new Error(`Quantidade de linhas inconsistente: recebidas ${rows.length}, esperadas ${session.totalRows}.`);
  }

  await db
    .update(spreadsheetImportSessions)
    .set({ status: "concluida", progressPct: 100 })
    .where(eq(spreadsheetImportSessions.sessionId, sessionId));

  await db
    .delete(spreadsheetImportChunks)
    .where(eq(spreadsheetImportChunks.sessionId, sessionId));

  return {
    fileName: session.fileName,
    notes: session.notes || undefined,
    rows,
  };
}

export async function clearSpreadsheetImportSessionsForTests() {
  const db = await getDb();
  if (!db) return;
  await db.delete(spreadsheetImportChunks);
  await db.delete(spreadsheetImportSessions);
}
