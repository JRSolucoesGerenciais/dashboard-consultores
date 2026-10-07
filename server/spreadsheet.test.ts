import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import fs from "fs";
import path from "path";
import http from "http";
import express from "express";
import { registerApiImportRoutes } from "./apiImportHttp";
import { buildApiImportWorkbookBuffer, isFinalSqlRev02Rows, isFinalSqlRev03Rows, isSqlRev06ViewRows, isSqlRevAtualRows, missingSqlRevAtualColumns, resolveImportedApiActualHours, shouldPreserveImportedPpsaRows, validateSpreadsheetBuffer } from "./spreadsheetService";
import { parseSpreadsheetInBrowser } from "../client/src/lib/clientSpreadsheetParser";
import {
  appendSpreadsheetImportChunk,
  clearSpreadsheetImportSessionsForTests,
  createSpreadsheetImportSession,
  takeSpreadsheetImportSession,
} from "./spreadsheetImportStaging";

const spreadsheetFixturePath = path.join(process.cwd(), "test-fixtures", "ResumoGeraldosProjetos.xls");

function createMockContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-manager",
      name: "Bruno Marin",
      email: "bruno@cscompusoftware.com.br",
      loginMethod: "manus",
      role: "admin",
      profileRole: "gerente",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as any,
    res: {
      clearCookie: () => {},
    } as any,
  };
}

describe("Spreadsheet Upload & Processing API", () => {
  it("não preserva o plano antigo quando a API traz a SQL Rev02 autoritativa", () => {
    expect(shouldPreserveImportedPpsaRows({ isApiImport: true, isFinalSqlImport: true, hasOfficialPlannedWeeks: false })).toBe(false);
    expect(shouldPreserveImportedPpsaRows({ isApiImport: true, isFinalSqlImport: false, hasOfficialPlannedWeeks: false })).toBe(true);
    expect(shouldPreserveImportedPpsaRows({ isApiImport: true, isFinalSqlImport: false, hasOfficialPlannedWeeks: true })).toBe(false);
  });

  it("reconhece o contrato SQL Rev03 e transporta os indicadores oficiais da API", () => {
    expect(isFinalSqlRev02Rows([{
      HORAS_PLANEJADAS_MODULO: "6960:00",
      HORAS_PRODUTIVAS_REALIZADAS: "4391:06",
      HORAS_IMPRODUTIVAS_REALIZADAS: "2197:12",
      ESCOPO_PLANEJAMENTO: "CRONOGRAMA",
    }])).toBe(true);
    expect(isFinalSqlRev03Rows([{
      QTD_SEMANA_PLANEJADA: 2,
      HORAS_PLANEJADAS_MODULO: "6960:00",
      HORAS_PRODUTIVAS_REALIZADAS: "4391:06",
      HORAS_IMPRODUTIVAS_REALIZADAS: "2197:12",
      ESCOPO_PLANEJAMENTO: "CRONOGRAMA",
      BASE_TOTAL_HORA_DIAS_PROGRAMADOS: "6960:00",
    }])).toBe(true);

    const buffer = buildApiImportWorkbookBuffer({
      source: "CSAgenda SQL Rev03",
      projects: [{
        code: "REV03-122",
        name: "Projeto Rev03",
        client: "MAJAGUAS",
        activities: [{
          ppsaCode: "REV03-122.1",
          description: "Módulo oficial",
          level: 1,
          plannedHours: "5960:00",
          actualHours: "4391:06",
          plannedWeeks: 149,
          plannedModuleHours: "6960:00",
          productiveActualHours: "4391:06",
          unproductiveActualHours: "2197:12",
          planningScope: "CRONOGRAMA",
          cronogramId: 12201,
        }],
      }],
    });
    const result = validateSpreadsheetBuffer("CSAgenda_API_Rev03.xlsx", buffer);
    expect(result.valid).toBe(true);
    expect(result.detectedColumns).toContain("HORAS_PLANEJADAS_MODULO");
    expect(result.detectedColumns).toContain("HORAS_PRODUTIVAS_REALIZADAS");
    expect(result.detectedColumns).toContain("IDPROJETOCRONOGRAMA");
  });

  it("aceita a SQL anterior para que o sistema trate PPSA, cronograma e avulsos internamente", () => {
    expect(isFinalSqlRev02Rows([{
      COD_PROJETO: "122",
      CODPPSA: "1.0.0",
      NIVEL: 1,
      TOTAL_HORA_DIAS_PROGRAMADOS: "5960:00",
      HORAS_TOTAL: "4391:06",
      IDPROJETOCRONOGRAMA: 12201,
    }])).toBe(true);
    expect(isFinalSqlRev03Rows([{
      COD_PROJETO: "122",
      CODPPSA: "1.0.0",
      NIVEL: 1,
      TOTAL_HORA_DIAS_PROGRAMADOS: "5960:00",
      HORAS_TOTAL: "4391:06",
    }])).toBe(false);
  });

  it("reconhece a View REV06 como planejamento PPSA já corrigido", () => {
    const rev06Row = {
      COD_PROJETO: "122",
      CODPPSA: "1.0.0",
      NIVEL: 1,
      TOTAL_HORA_DIAS_PROGRAMADOS: "6960:00",
      HORAS_TOTAL: "4391:06",
      PERCENTUAL_HORAS_REALIZADA_ORIGINAL: 63.1,
      STATUS_ESTOURO_HORAS: "SALDO DE HORAS (36.90%)",
      DATA_TERMINO_REALIZADO_MODULO: null,
    };

    expect(isSqlRev06ViewRows([rev06Row])).toBe(true);
    expect(isFinalSqlRev02Rows([rev06Row])).toBe(false);
    expect(isFinalSqlRev03Rows([rev06Row])).toBe(false);
  });

  it("reconhece a SQL RevAtual sem exigir as colunas HTML opcionais", () => {
    const revAtualRow = {
      COD_PROJETO: "122",
      CODGESTAO: 1,
      CODMODULO: 14,
      IDPPSA: 104140,
      ID_PAI: 104100,
      CODPPSA: "4.14.1.0",
      NIVEL: 3,
      TOTAL_HORA_DIAS_PROGRAMADOS: "10:00",
      HORAS_TOTAL: "0:00",
      HORAS_REALIZADAS_MODULO: "227:12",
      QTD_SEMANA_PLANEJADA: 96,
      HORAS_MODULO_PLANEJADAS: "3840:00",
      POSSUI_CRONOGRAMA: "S",
      PERCENTUAL_CONCLUSAO: 0,
      PERCENTUAL_HORAS_REALIZADA_ORIGINAL: 0,
      STATUS_ESTOURO_HORAS: "SALDO DE HORAS (100,00%)",
      STATUS_ATIVIDADE: "EM ANDAMENTO",
      DATA_TERMINO_REALIZADO_MODULO: null,
    };

    expect(revAtualRow.STATUS_ATIVIDADE_HTML).toBeUndefined();
    expect(revAtualRow.STATUS_ESTOURO_HORAS_HTML).toBeUndefined();
    expect(revAtualRow.PERCENTUAL_CONCLUSAO_HTML).toBeUndefined();
    expect(missingSqlRevAtualColumns([revAtualRow])).toHaveLength(0);
    expect(isSqlRevAtualRows([revAtualRow])).toBe(true);
    expect(isSqlRev06ViewRows([revAtualRow])).toBe(false);
    expect(isFinalSqlRev02Rows([revAtualRow])).toBe(false);
  });

  it("usa HORAS_TOTAL da API no realizado mesmo quando chegam campos de produtividade", () => {
    expect(resolveImportedApiActualHours(10935.2, 4053.06, 12345.67)).toBe(10935.2);
    expect(resolveImportedApiActualHours(null, 4053.06, 12345.67)).toBe(4053.06);
    expect(resolveImportedApiActualHours(undefined, 0, 12345.67)).toBe(12345.67);
  });

  it("deve validar a estrutura da planilha de projetos com sucesso", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    const fileBuffer = fs.readFileSync(spreadsheetFixturePath);
    const fileBase64 = fileBuffer.toString("base64");

    const result = await caller.projects.validateSpreadsheet({
      fileName: "ResumoGeraldosProjetos.xlsx",
      fileBase64,
    });

    expect(result.valid).toBe(true);
    expect(result.totalRows).toBeGreaterThan(1000);
    expect(result.uniqueProjects).toBeGreaterThanOrEqual(100);
    expect(result.detectedColumns.length).toBeGreaterThan(10);
    expect(result.detectedColumns).toContain("TIPO_PROJETO_DESCRICAO");
  });

  it("deve rejeitar uma planilha com formato corrompido ou sem as colunas mínimas", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    // Buffer inválido
    const invalidBase64 = Buffer.from("conteudo,invalido\n1,2").toString("base64");

    const result = await caller.projects.validateSpreadsheet({
      fileName: "invalido.xlsx",
      fileBase64: invalidBase64,
    });

    expect(result.valid).toBe(false);
    expect(result.missingCrucialColumns.length).toBeGreaterThan(0);
  });

  it("deve converter o payload JSON da API para o contrato operacional de importação", () => {
    const buffer = buildApiImportWorkbookBuffer({
      source: "ERP CS",
      projects: [{
        code: "API-200",
        name: "Projeto recebido por API",
        client: "CLIENTE API",
        managerName: "Gestor API",
        isActive: true,
        activities: [{
          ppsaCode: "API-200.1.0.0",
          description: "Atividade recebida",
          level: 1,
          plannedStart: "2026-09-01",
          plannedEnd: "2026-09-30",
          plannedHours: 120,
          actualHours: 42.5,
          progressPct: 35,
        }],
      }],
    });
    const result = validateSpreadsheetBuffer("api-erp-cs.xlsx", buffer);

    expect(result.valid).toBe(true);
    expect(result.uniqueProjects).toBe(1);
    expect(result.totalRows).toBe(1);
    expect(result.sampleProjects[0]?.code).toBe("API-200");
  });

  it("deve validar XLSX localmente no navegador sem depender do endpoint HTTP", async () => {
    const buffer = buildApiImportWorkbookBuffer({
      source: "ERP CS",
      projects: [{
        code: "LOCAL-200",
        name: "Projeto validado localmente",
        client: "CLIENTE LOCAL",
        activities: [{
          ppsaCode: "LOCAL-200.1.0.0",
          description: "Atividade local",
          level: 1,
          plannedHours: 80,
          actualHours: 20,
          progressPct: 25,
        }],
      }],
    });

    const file = new File([buffer], "ResumoGeraldosProjetos.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await parseSpreadsheetInBrowser(file);

    expect(result.valid).toBe(true);
    expect(result.fileName).toBe("ResumoGeraldosProjetos.xlsx");
    expect(result.totalRows).toBe(1);
    expect(result.uniqueProjects).toBe(1);
    expect(result.sampleProjects[0]?.code).toBe("LOCAL-200");
    expect(result.rows).toHaveLength(1);
  });

  it("deve montar a planilha em blocos pequenos antes de finalizar a importação", async () => {
    await clearSpreadsheetImportSessionsForTests();
    const session = await createSpreadsheetImportSession({
      fileName: "ResumoGeraldosProjetos.xls",
      totalChunks: 2,
      totalRows: 3,
    });

    const firstChunk = await appendSpreadsheetImportChunk({
      sessionId: session.sessionId,
      chunkIndex: 0,
      rows: [{ COD_PROJETO: "1" }, { COD_PROJETO: "2" }],
    });
    expect(firstChunk.progressPct).toBe(67);

    // Reenvio do mesmo bloco é idempotente e não duplica linhas.
    const retryChunk = await appendSpreadsheetImportChunk({
      sessionId: session.sessionId,
      chunkIndex: 0,
      rows: [{ COD_PROJETO: "1" }, { COD_PROJETO: "2" }],
    });
    expect(retryChunk.receivedRows).toBe(2);

    const secondChunk = await appendSpreadsheetImportChunk({
      sessionId: session.sessionId,
      chunkIndex: 1,
      rows: [{ COD_PROJETO: "3" }],
    });
    expect(secondChunk.progressPct).toBe(99);

    const completed = await takeSpreadsheetImportSession(session.sessionId);
    expect(completed.fileName).toBe("ResumoGeraldosProjetos.xls");
    expect(completed.rows).toHaveLength(3);
    await clearSpreadsheetImportSessionsForTests();
  });

  it("deve validar planilha via rota HTTP aceitando multipart/form-data e binary raw", async () => {
    const app = express();
    const { registerSpreadsheetHttpRoutes } = await import("./spreadsheetHttp");
    registerSpreadsheetHttpRoutes(app);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    try {
      const fileBuffer = fs.readFileSync(spreadsheetFixturePath);

      // 1. Teste via Binary Raw
      const rawRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/api/spreadsheets/validate?fileName=ResumoGeraldosProjetos.xlsx",
          method: "POST",
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Length": fileBuffer.length,
          },
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => resolve({ status: res.statusCode || 500, body: JSON.parse(data) }));
        });
        req.on("error", reject);
        req.write(fileBuffer);
        req.end();
      });

      expect(rawRes.status).toBe(200);
      expect(rawRes.body.valid).toBe(true);
      expect(rawRes.body.totalRows).toBeGreaterThan(1000);

      // 2. Teste via Multipart/Form-data
      const boundary = "----WebKitFormBoundaryTestCSUpload2026";
      const pre = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ResumoGeraldosProjetos.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
      );
      const post = Buffer.from(`\r\n--${boundary}--\r\n`);
      const multipartBuffer = Buffer.concat([pre, fileBuffer, post]);

      const multipartRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port,
          path: "/api/spreadsheets/validate",
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": multipartBuffer.length,
          },
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => data += chunk);
          res.on("end", () => resolve({ status: res.statusCode || 500, body: JSON.parse(data) }));
        });
        req.on("error", reject);
        req.write(multipartBuffer);
        req.end();
      });

      expect(multipartRes.status).toBe(200);
      expect(multipartRes.body.valid).toBe(true);
      expect(multipartRes.body.fileName).toBe("ResumoGeraldosProjetos.xlsx");
      expect(multipartRes.body.uniqueProjects).toBeGreaterThanOrEqual(100);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);

  it("deve proteger a rota HTTP de importação por API com chave e validar payload", async () => {
    const app = express();
    app.use(express.json());
    registerApiImportRoutes(app);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const post = (headers: Record<string, string>, body: any): Promise<{ status: number; body: any }> => new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/api/integrations/project-import",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 500, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode || 500, body: data });
          }
        });
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    try {
      // 1. Sem chave configurada
      delete process.env.PROJECT_IMPORT_API_KEY;
      const resNoEnv = await post({}, { projects: [] });
      expect(resNoEnv.status).toBe(503);

      // 2. Chave configurada, mas não enviada
      process.env.PROJECT_IMPORT_API_KEY = "chave-secreta-cs";
      const resNoKey = await post({}, { projects: [] });
      expect(resNoKey.status).toBe(401);

      // 3. Chave enviada errada
      const resWrongKey = await post({ "x-api-key": "chave-errada" }, { projects: [] });
      expect(resWrongKey.status).toBe(401);

      // 4. Chave correta, mas payload incompleto
      const resBadPayload = await post({ Authorization: "Bearer chave-secreta-cs" }, { projects: [] });
      expect(resBadPayload.status).toBe(400);
      expect(resBadPayload.body.message).toContain("Informe pelo menos um projeto");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);
});
