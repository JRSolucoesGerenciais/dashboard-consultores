import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { oracleSyncRuns, projects, projectActivities } from "../drizzle/schema";

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

describe("CS Compusoftware - Gestão de Projetos API (Base Final)", () => {
  it("deve listar a base operacional e os projetos cadastrais sem atividades", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();

    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThanOrEqual(317);

    const project200 = projects.find((p) => p.code === "200");
    expect(project200).toBeDefined();
    expect(project200?.name).toBe("Implantação ERP - GRUPO SÃO LUIZ - USL");
    expect(project200?.client).toBe("USL");

    const project224 = projects.find((p) => p.code === "224");
    expect(project224?.name).toBe("Migração 4.0 - Polpa Norte");
    expect(project224?.client).toBe("POLPANORTE");
    expect(project224?.managerName).toBe("Bruno Santos");

    const project324 = projects.find((p) => p.code === "324");
    expect(project324).toBeDefined();
    expect(project324?.name).toBe("Migração 4.0 - Agropastoril");
    expect(project324?.client).toBe("AGROPASTORIL");
    expect(project324?.totalActivities).toBe(5);
    expect(project324?.plannedHours).toBe("0.00");
    // A API CSAgenda é uma fonte viva; o total pode variar conforme novos apontamentos.
    expect(Number(project324?.actualHours)).toBeGreaterThan(0);
    expect(Number(project324?.completionPct)).toBeGreaterThanOrEqual(0);
    expect(Number(project324?.completionPct)).toBeLessThanOrEqual(100);

    const project57 = projects.find((p) => p.code === "57");
    expect(project57?.finalDate).toBe("2024-12-31");

    const agropastorilProjects = projects.filter((p) => p.client === "AGROPASTORIL");
    expect(agropastorilProjects.length).toBeGreaterThanOrEqual(2);
    expect(agropastorilProjects.map((p) => p.code)).toEqual(expect.arrayContaining(["57", "324"]));
    expect(agropastorilProjects.find((p) => p.code === "324")?.isActive).toBe(true);

    const activeManagers = new Set(projects.filter((p) => p.isActive).map((p) => p.sponsor));
    expect(activeManagers.has("Paulo Ribeiro")).toBe(true);
    expect(activeManagers.has("Paulo Maluizi")).toBe(false);
  });

  it("deve carregar indicadores PMBOK do projeto selecionado sem fixar código ou nome", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const catalogProject = projects.find((item) => item.code === "324");
    expect(catalogProject).toBeDefined();
    const project = await caller.projects.getById({ id: catalogProject!.id });

    expect(project.project.code).toBe("324");
    expect(project.project.name).toBe("Migração 4.0 - Agropastoril");
    expect(project.project.baselineHours).toBeDefined();
    expect(project.project.spi).toBeDefined();
    expect(project.project.cpi).toBeDefined();
    expect(project.activities[0]?.managementName).toBeDefined();
    expect(project.activities[0]?.moduleName).toBeDefined();
    expect(project.activities[0]?.levelChild).toBeDefined();
  });

  it("deve retornar o ranking comparativo de horas apontadas por projeto", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const comparison = await caller.projects.getHoursComparison();

    expect(Array.isArray(comparison)).toBe(true);
    expect(comparison.length).toBeGreaterThanOrEqual(10);
    expect(comparison.some((project) => project.code === "200")).toBe(true);
    expect(comparison.find((project) => project.code === "200")?.actual_hours).toBeGreaterThan(0);
    expect(comparison.every((project, index) => index === 0 || project.actual_hours <= comparison[index - 1]!.actual_hours)).toBe(true);
  });

  it("deve gerar semanas sequenciais do projeto no mês solicitado", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const visual = await caller.projects.getVisualControl({ projectId: 1, month: "2026-09" });
    const periods = visual.selected?.periods || [];

    expect(periods.length).toBeGreaterThanOrEqual(4);
    expect(periods.every((period) => period.weekNumber > 0)).toBe(true);
    expect(periods.every((period, index) => index === 0 || period.weekNumber === periods[index - 1]!.weekNumber + 1)).toBe(true);
    expect(periods[0]?.startDate).toMatch(/-08-3[01]$/);
    expect(periods.every((period) => {
      const start = new Date(`${period.startDate}T00:00:00`);
      const end = new Date(`${period.endDate}T00:00:00`);
      return start.getDay() === 1 && end.getDay() === 0;
    })).toBe(true);
  });

  it("deve calcular horas planejadas e realizadas acumuladas até o período informado", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    const summary = await caller.projects.getHoursSummary({
      projectIds: [project!.id],
      periodEnd: "2026-09-20",
    });
    expect(summary.totalPlannedHours).toBeGreaterThanOrEqual(0);
    expect(summary.totalActualHours).toBeGreaterThanOrEqual(0);
    expect(summary.plannedHoursToDate).toBeGreaterThanOrEqual(0);
    expect(summary.actualHoursToDate).toBeGreaterThanOrEqual(0);
    expect(summary.plannedHoursToDate).toBeLessThanOrEqual(summary.totalPlannedHours + 0.1);
    expect(summary.actualHoursToDate).toBeLessThanOrEqual(summary.totalActualHours + 0.1);
    expect(summary.periodEnd).toBe("2026-09-20");
  });

  it("deve retornar pontos acumulados de Curva S para o projeto selecionado", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    const curve = await caller.projects.getSCurve({ projectId: project!.id });
    expect(curve.projectId).toBe(project!.id);
    expect(curve.points.length).toBeGreaterThan(0);
    expect(curve.points.every((point) => point.plannedHours >= 0 && point.actualHours >= 0)).toBe(true);
    expect(curve.points.every((point) => point.plannedPct >= 0 && point.plannedPct <= 100 && point.actualPct >= 0 && point.actualPct <= 100)).toBe(true);
    expect(curve.modules.length).toBeGreaterThan(0);
  });

  it("deve filtrar Curva S por módulo específico e salvar/comparar snapshot mensal", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    // 1. Curva com módulo específico
    const initialCurve = await caller.projects.getSCurve({ projectId: project!.id });
    const sampleModule = initialCurve.modules[0] || "todos";
    const moduleCurve = await caller.projects.getSCurve({ projectId: project!.id, moduleName: sampleModule });
    expect(moduleCurve.moduleName).toBe(sampleModule);
    expect(moduleCurve.points.length).toBeGreaterThan(0);

    // 2. Salvar snapshot mensal como Linha de Base
    const snapshotResult = await caller.projects.saveSCurveSnapshot({
      projectId: project!.id,
      snapshotMonth: "2026-09",
      moduleName: sampleModule,
      snapshotName: `Linha de Base Teste — Setembro (${sampleModule})`,
      isBaseline: true,
    });
    expect(snapshotResult.success).toBe(true);
    expect(snapshotResult.isBaseline).toBe(true);

    // 3. Consultar a curva com o snapshot para comparação
    const curveWithSnapshot = await caller.projects.getSCurve({ projectId: project!.id, moduleName: sampleModule });
    expect(curveWithSnapshot.snapshots.length).toBeGreaterThan(0);
    expect(curveWithSnapshot.comparison).toBeDefined();
    expect(curveWithSnapshot.points.some((p) => p.baselinePlannedHours !== null)).toBe(true);
  }, 15000);

  it("deve retornar oito semanas de tendência com avanço programado e realizado", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    const history = await caller.projects.getProgressHistory({ projectIds: [project!.id] });
    expect(history).toHaveLength(8);
    expect(history.every((row) => row.label && row.startDate && row.endDate)).toBe(true);
    expect(history.every((row) => row.programado >= 0 && row.programado <= 100)).toBe(true);
    expect(history.every((row) => row.realizado === null || (row.realizado >= 0 && row.realizado <= 100))).toBe(true);
    expect(history.every((row) => row.fonteRealizado === "checkin_semanal" || row.fonteRealizado === "sem_base_temporal")).toBe(true);
  });

  it("deve refletir os campos de horas da API do Majaguas sem override interno", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "122");
    expect(project).toBeDefined();
    expect(Number(project!.plannedHours)).toBeCloseTo(6960, 1);
    expect(project!.productiveActualHours).toBeNull();
    expect(project!.unproductiveActualHours).toBeNull();
    expect(Number(project!.actualHours)).toBeGreaterThan(0);

    const history = await caller.projects.getProgressHistory({ projectIds: [project!.id] });
    const latest = history.at(-1);
    expect(latest?.realizado === null || (latest!.realizado >= 0 && latest!.realizado <= 100)).toBe(true);
  }, 15000);

  it("deve retornar somente alertas do escopo informado", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    const alerts = await caller.projects.getUpcomingAlerts({ projectIds: [project!.id] });
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts.every((alert) => alert.projectId === project!.id)).toBe(true);
    expect(alerts.every((alert) => alert.businessDaysRemaining >= 0 && alert.businessDaysRemaining <= 7)).toBe(true);
  });

  it("deve registrar check-in com anexo e salvar no histórico", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const projects = await caller.projects.list();
    const project = projects.find((item) => item.code === "200");
    expect(project).toBeDefined();

    const sampleBase64 = Buffer.from("Conteúdo de teste para anexo de ata").toString("base64");
    const result = await caller.projects.addWeeklyUpdate({
      projectId: project!.id,
      weekReference: "Semana 39 / 2026 (Validação Anexo)",
      authorName: "Consultor Técnico CS",
      authorRole: "Gerente de Projetos",
      ragStatus: "verde",
      physicalProgressPct: "80.0",
      spiValue: "1.00",
      cpiValue: "1.00",
      hoursConsumedWeek: "0.00",
      whatOccurred: "Realizada homologação das ordens de serviço.",
      nextSteps: "Iniciar treinamento com usuários finais.",
      criticalAttention: "Sem impedimentos.",
      clientDecisionsNeeded: "Homologação de entrega formal.",
      attachments: [
        {
          fileName: "ata-reuniao-alinhamento.pdf",
          fileBase64: sampleBase64,
          contentType: "application/pdf",
        },
      ],
    });
    expect(result.success).toBe(true);

    const updates = await caller.projects.getProjectWeeklyUpdates({ projectId: project!.id });
    const latest = updates.find((u) => u.weekReference === "Semana 39 / 2026 (Validação Anexo)");
    expect(latest).toBeDefined();
    expect((latest as any).attachments.length).toBeGreaterThanOrEqual(1);
    expect((latest as any).attachments[0].fileName).toBe("ata-reuniao-alinhamento.pdf");
    expect((latest as any).attachments[0].storageUrl).toContain("/manus-storage/");
  });

  it("deve gerenciar configuração da API CSAgenda, testar prévia real e executar rollback do histórico", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);

    // 1. Obter configuração padrão
    const config = await caller.projects.getOracleConfig();
    expect(config).toBeDefined();
    expect(config.endpointUrl).toBeDefined();
    expect(config.syncIntervalMinutes).toBeGreaterThan(0);

    // 2. Salvar nova configuração
    const updated = await caller.projects.saveOracleConfig({
      endpointUrl: "https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2",
      syncIntervalMinutes: 120,
      backgroundEnabled: true,
    });
    expect(updated.syncIntervalMinutes).toBe(120);
    expect(updated.backgroundEnabled).toBe(true);

    // 3. Testar parser/preview com um envelope JSON local determinístico
    const localPreviewRows = encodeURIComponent(JSON.stringify([
      { COD_PROJETO: "9991", NOME_PROJETO: "Projeto de teste", CLIENTE_NOME: "CS", CODPPSA: "1.0.0", DESCRICAO: "Atividade", NIVEL: 1, STATUS_ATIVIDADE: "EM ANDAMENTO", TOTAL_HORA_DIAS_PROGRAMADOS: "100,0", HORAS_TOTAL: "40,0", INICIO_PROGRAMADO: "2026-09-01", TERMINO_PROGRAMADO: "2026-09-30", QTD_SEMANA_PLANEJADA: 2, HORAS_PLANEJADAS_MODULO: "80:00", HORAS_PRODUTIVAS_REALIZADAS: "40:00", HORAS_IMPRODUTIVAS_REALIZADAS: "10:00", ESCOPO_PLANEJAMENTO: "CRONOGRAMA", BASE_TOTAL_HORA_DIAS_PROGRAMADOS: "100:00" },
      { COD_PROJETO: "9991", NOME_PROJETO: "Projeto de teste", CLIENTE_NOME: "CS", CODPPSA: "1.1.0", DESCRICAO: "Subatividade", NIVEL: 2, STATUS_ATIVIDADE: "CONCLUIDA", TOTAL_HORA_DIAS_PROGRAMADOS: "20,0", HORAS_TOTAL: "20,0", INICIO_PROGRAMADO: "2026-09-01", TERMINO_PROGRAMADO: "2026-09-15", QTD_SEMANA_PLANEJADA: 2, HORAS_PLANEJADAS_MODULO: "80:00", HORAS_PRODUTIVAS_REALIZADAS: "40:00", HORAS_IMPRODUTIVAS_REALIZADAS: "10:00", ESCOPO_PLANEJAMENTO: "CRONOGRAMA", BASE_TOTAL_HORA_DIAS_PROGRAMADOS: "20:00" },
    ]));
    const testResult = await caller.projects.testOracleConnection({
      endpointUrl: `data:application/json,${localPreviewRows}`,
    });
    expect(testResult.success).toBe(true);
    expect(testResult.previewRowsCount).toBe(2);
    expect(testResult.preview?.projectsCount).toBe(1);
    expect(testResult.preview?.detectedColumns).toContain("CODPPSA");
    expect(testResult.preview?.detectedColumns).toContain("HORAS_TOTAL");
    expect(testResult.previewJsonFileName).toContain("CSAgenda_API_");
    expect(testResult.preview?.stagingSessionId).toBeDefined();
    expect(testResult.preview?.comparison).toBeDefined();
    expect(typeof testResult.preview?.comparison?.newProjectsCount).toBe("number");
    expect(typeof testResult.preview?.comparison?.updatedProjectsCount).toBe("number");

    // 4. Validar processamento incremental com staging persistido sem timeout longo
    const publishResult = await caller.projects.publishOraclePreview({
      endpointUrl: "http://127.0.0.1:1/csagenda-test-invalid",
      fileIdentifier: "CSAgenda_API_TESTE_INVALIDO.json",
      responsible: "Test Runner",
      rowsCount: 0,
      stagingSessionId: testResult.preview?.stagingSessionId,
    });
    expect(publishResult.success).toBe(true);
    expect(publishResult.runId).toBeGreaterThan(0);
    expect(publishResult.status).toBe("processando");

    // 5. Consultar status avançando o lote incremental até o fim
    const statusResult = await caller.projects.getOracleSyncRunStatus({ runId: publishResult.runId });
    expect(statusResult.id).toBe(publishResult.runId);
    expect(statusResult.fileIdentifier).toBe("CSAgenda_API_TESTE_INVALIDO.json");
    expect(["processando", "publicada_ativa"]).toContain(statusResult.status);

    // 6. Listar histórico de sincronizações com paginação
    const history = await caller.projects.listOracleSyncRuns({ page: 1, pageSize: 10 });
    expect(Array.isArray(history.items)).toBe(true);
    expect(history.total).toBeGreaterThanOrEqual(0);

    // Limpa a execução criada pelo teste para não poluir o histórico do usuário
    const db = await getDb();
    if (db) {
      await db.delete(oracleSyncRuns).where(eq(oracleSyncRuns.id, publishResult.runId));
      const p9991 = await db.select().from(projects).where(eq(projects.code, "9991"));
      if (p9991.length > 0) {
        await db.delete(projectActivities).where(eq(projectActivities.projectId, p9991[0].id));
        await db.delete(projects).where(eq(projects.code, "9991"));
      }
    }
    await caller.projects.saveOracleConfig({
      endpointUrl: "https://www.cscompusoftware.com.br/cssuporte/segurancanovo/csagenda/csagenda_consultores?consulta=2",
      syncIntervalMinutes: 120,
      backgroundEnabled: false,
    });
  }, 60000);
});
