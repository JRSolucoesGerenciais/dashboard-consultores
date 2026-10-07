import { describe, expect, it } from "vitest";
import { buildManagementModuleSummary, canonicalizePersistedPpsaRows, consolidatePpsaRows, isOutsideScopeRow, toPpsaInputRow } from "./ppsahours";
import { isFinalSqlRev02Rows } from "./spreadsheetService";

describe("Consolidação de horas por PPSA", () => {
  it("remove repetições do mesmo PPSA sem somar a mesma hora novamente", () => {
    const result = consolidatePpsaRows([
      { projectKey: "200", ppsaCode: "1.1.0.0", level: 2, topCode: 1, processCode: 1, plannedHours: 120, actualHours: "35:00", raw: { DESCRICAO: "Processo" } },
      { projectKey: "200", ppsaCode: "1.1.0.0", level: 2, topCode: 1, processCode: 1, plannedHours: 120, actualHours: "35:00", raw: { DESCRICAO: "Processo" } },
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].plannedHours).toBe(120);
    expect(result.rows[0].actualHours).toBe(35);
    expect(result.totalsByProject.get("200")?.duplicateRowsRemoved).toBe(1);
  });

  it("usa Nível 3 para corrigir Nível 2 e Nível 2 para corrigir Nível 1", () => {
    const result = consolidatePpsaRows([
      { projectKey: "122", ppsaCode: "1.0.0.0", level: 1, topCode: 1, processCode: 0, plannedHours: 999, actualHours: 40, raw: { DESCRICAO: "Macroestrutura" } },
      { projectKey: "122", ppsaCode: "1.1.0.0", level: 2, topCode: 1, processCode: 1, plannedHours: 999, actualHours: 20, raw: { DESCRICAO: "Processo" } },
      { projectKey: "122", ppsaCode: "1.1.1.0", level: 3, topCode: 1, processCode: 1, plannedHours: 60, actualHours: 10, raw: { DESCRICAO: "Atividade 1" } },
      { projectKey: "122", ppsaCode: "1.1.2.0", level: 3, topCode: 1, processCode: 1, plannedHours: 40, actualHours: 5, raw: { DESCRICAO: "Atividade 2" } },
      { projectKey: "122", ppsaCode: "2.0.0.0", level: 1, topCode: 2, processCode: 0, plannedHours: 80, actualHours: 8, raw: { DESCRICAO: "Macroestrutura sem filhos" } },
    ]);

    const level1 = result.rows.filter((row) => row.level === 1);
    expect(level1.map((row) => row.plannedHours)).toEqual([100, 80]);
    expect(result.rows.find((row) => row.ppsaCode === "1.1.0.0")?.plannedHours).toBe(100);
    expect(result.totalsByProject.get("122")).toMatchObject({ plannedHours: 180, actualHours: 48, selectedLevel: 1 });
  });

  it("usa o realizado do Nível 2 quando a API não devolve nenhum Nível 1", () => {
    const result = consolidatePpsaRows([
      { projectKey: "152", ppsaCode: "4.1.0.0", level: 2, topCode: 4, processCode: 1, plannedHours: 0, actualHours: "43:55", raw: { DESCRICAO: "Processo" } },
      { projectKey: "152", ppsaCode: "4.1.1.0", level: 3, topCode: 4, processCode: 1, plannedHours: 0, actualHours: "43:55", raw: { DESCRICAO: "Atividade" } },
    ], { applyHierarchyCorrection: false });

    expect(result.totalsByProject.get("152")).toMatchObject({ selectedLevel: 2, actualHours: 43.92 });
    expect(result.rows.some((row) => row.level === 1)).toBe(false);
  });

  it("preserva a hora explicitamente informada pelo PPSA quando a fonte traz o valor do nível", () => {
    const result = consolidatePpsaRows([
      { projectKey: "122", ppsaCode: "1.0.0.0", level: 1, topCode: 1, processCode: 0, plannedHours: 480, actualHours: 0, raw: { TOTAL_HORA_DIAS_PROGRAMADOS: "480:00" } },
      { projectKey: "122", ppsaCode: "1.1.0.0", level: 2, topCode: 1, processCode: 1, plannedHours: 120, actualHours: 0, raw: { TOTAL_HORA_DIAS_PROGRAMADOS: ":" } },
      { projectKey: "122", ppsaCode: "1.1.1.0", level: 3, topCode: 1, processCode: 1, plannedHours: 60, actualHours: 0, raw: { TOTAL_HORA_DIAS_PROGRAMADOS: "60:00" } },
    ]);

    expect(result.rows.find((row) => row.ppsaCode === "1.0.0.0")?.plannedHours).toBe(480);
    expect(result.totalsByProject.get("122")?.plannedHours).toBe(480);
  });

  it("mantém uma única leitura por código e nível no backend", () => {
    const rows = [
      { id: 1, projectId: 1, ppsaCode: "1.0.0.0", level: 1, sourceProjectCode: 1, sourceProcessCode: 0, plannedHours: "100.00", actualHours: "10.00", hoursOverrunStatus: null },
      { id: 2, projectId: 1, ppsaCode: "1.0.0.0", level: 1, sourceProjectCode: 1, sourceProcessCode: 0, plannedHours: "100.00", actualHours: "10.00", hoursOverrunStatus: null },
    ];

    const canonical = canonicalizePersistedPpsaRows(rows);
    expect(canonical).toHaveLength(1);
    expect(canonical[0].plannedHours).toBe("100.00");
    expect(canonical[0].actualHours).toBe("10.00");
  });

  it("agrega múltiplos PPSAs Nível 1 do mesmo Gestão/Módulo somando as horas", () => {
    const rows = [
      {
        ppsaCode: "2.0.0.0",
        level: 1,
        managementCode: 30,
        managementName: "Escritório de Projetos (30)",
        moduleName: "Implantação (1)",
        plannedHours: 9250,
        actualHours: 0,
        plannedDays: 925,
        plannedWeeks: 185,
        plannedStart: "2024-04-22",
        plannedEnd: "2027-06-30",
        status: "em_andamento",
      },
      {
        ppsaCode: "3.0.0.0",
        level: 1,
        managementCode: 30,
        managementName: "Escritório de Projetos (30)",
        moduleName: "Implantação (1)",
        plannedHours: 9240,
        actualHours: 22.5,
        plannedDays: 924,
        plannedWeeks: 184.8,
        plannedStart: "2024-04-22",
        plannedEnd: "2027-06-30",
        status: "concluido",
      },
      {
        ppsaCode: "6.0.0.0",
        level: 1,
        managementCode: 6,
        managementName: "Financeira (6)",
        moduleName: "Contas a Pagar (3)",
        plannedHours: 37520,
        actualHours: 179.12,
        plannedDays: 3752,
        plannedWeeks: 750.4,
        plannedStart: "2025-04-14",
        plannedEnd: "2027-01-31",
        status: "concluido",
      },
    ];

    const summary = buildManagementModuleSummary(rows);
    expect(summary).toHaveLength(2);

    const implantacao = summary.find((item) => item.moduleName === "Implantação (1)");
    expect(implantacao).toBeDefined();
    expect(implantacao?.ppsaCount).toBe(2);
    expect(implantacao?.ppsaCodes).toEqual(["2.0.0.0", "3.0.0.0"]);
    expect(implantacao?.plannedHours).toBe(18490);
    expect(implantacao?.actualHours).toBe(22.5);
    expect(implantacao?.balanceHours).toBe(18467.5);
    expect(implantacao?.plannedWeeks).toBe(369.8);

    const financeiro = summary.find((item) => item.moduleName === "Contas a Pagar (3)");
    expect(financeiro).toBeDefined();
    expect(financeiro?.ppsaCount).toBe(1);
    expect(financeiro?.plannedHours).toBe(37520);
    expect(financeiro?.actualHours).toBe(179.12);

    const totalPlanned = summary.reduce((sum, item) => sum + item.plannedHours, 0);
    expect(totalPlanned).toBe(56010);
  });

  it("isola grupos que possuem o mesmo nome de módulo mas gestões diferentes", () => {
    const rows = [
      {
        ppsaCode: "5.0.0.0",
        level: 1,
        managementCode: 3,
        managementName: "Material (3)",
        moduleName: "Informações Gerais (1)",
        plannedHours: 6450,
        actualHours: 538.83,
        status: "concluido",
      },
      {
        ppsaCode: "7.0.0.0",
        level: 1,
        managementCode: 8,
        managementName: "Comercial (8)",
        moduleName: "Informações Gerais (1)",
        plannedHours: 25010,
        actualHours: 383.63,
        status: "concluido",
      },
    ];

    const summary = buildManagementModuleSummary(rows);
    expect(summary).toHaveLength(2);
    expect(summary[0].managementName).toBe("Material (3)");
    expect(summary[0].plannedHours).toBe(6450);
    expect(summary[1].managementName).toBe("Comercial (8)");
    expect(summary[1].plannedHours).toBe(25010);
  });

  it("mantém Gestão/Módulo separado por nível PPSA sem somar a hierarquia", () => {
    const rows = [1, 2, 3, 4].map((level) => ({
      ppsaCode: `1.2.3.${level}`,
      level,
      managementCode: 1,
      managementName: "Recursos Humanos (1)",
      moduleName: "Treinamento (1)",
      plannedHours: 100,
      actualHours: level * 10,
      status: "em_andamento",
    }));

    const summary = buildManagementModuleSummary(rows, null, { preserveLevels: true });
    expect(summary).toHaveLength(4);
    expect(summary.map((item) => item.level)).toEqual([1, 2, 3, 4]);
    expect(summary.map((item) => item.plannedHours)).toEqual([100, 100, 100, 100]);
    expect(summary.reduce((sum, item) => sum + item.plannedHours, 0)).toBe(400);
  });

  it("reconhece a SQL final Rev02", () => {
    expect(isFinalSqlRev02Rows([{ DATA_TERMINO_REALIZADO_MODULO: null, TOTAL_HORA_DIAS_PROGRAMADOS: "6960:00" }])).toBe(true);
    expect(isFinalSqlRev02Rows([{ TOTAL_HORA_DIAS_PROGRAMADOS: "142950:00" }])).toBe(false);
  });

  it("não transforma planejamento de PROJETOMODULO fora do escopo em PPSA Nível 1", () => {
    const outsideScope = {
      COD_PROJETO: "200",
      CODGESTAO: 4,
      CODMODULO: 12,
      HORAS_PLANEJADAS_MODULO: "3840:00",
      QTD_SEMANA_PLANEJADA: 96,
      TOTAL_HORA_DIAS_PROGRAMADOS: "3840:00",
      HORAS_TOTAL: "0:00",
    };

    expect(isOutsideScopeRow(outsideScope)).toBe(true);
    expect(toPpsaInputRow("200", outsideScope, 0)).toMatchObject({
      level: 0,
      ppsaCode: "FORA_ESCOPO_4_12",
      plannedHours: "3840:00",
    });
    expect(toPpsaInputRow("200", {
      COD_PROJETO: "200",
      IDPPSA: "",
      CODPPSA: "",
      HORAS_TOTAL: "18:00",
      TOTAL_HORA_DIAS_PROGRAMADOS: "0:00",
    }, 1)).toMatchObject({
      level: 0,
      actualHours: "18:00",
    });
  });

  it("não duplica o realizado quando a API repete o total do módulo em vários Nível 1", () => {
    const result = consolidatePpsaRows([
      { projectKey: "122", ppsaCode: "2.0.0.0", level: 1, topCode: 2, processCode: 0, plannedHours: 240, actualHours: "22:30", raw: { CODGESTAO: 30, CODMODULO: 1 } },
      { projectKey: "122", ppsaCode: "3.0.0.0", level: 1, topCode: 3, processCode: 0, plannedHours: 240, actualHours: "22:30", raw: { CODGESTAO: 30, CODMODULO: 1 } },
    ], { applyHierarchyCorrection: false });

    expect(result.totalsByProject.get("122")).toMatchObject({ plannedHours: 480, actualHours: 22.5, selectedLevel: 1 });

    const summary = buildManagementModuleSummary([
      { ppsaCode: "2.0.0.0", level: 1, managementCode: 30, managementName: "Gestão 30", moduleName: "Módulo 1", plannedHours: 240, actualHours: 22.5 },
      { ppsaCode: "3.0.0.0", level: 1, managementCode: 30, managementName: "Gestão 30", moduleName: "Módulo 1", plannedHours: 240, actualHours: 22.5 },
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0].plannedHours).toBe(480);
    expect(summary[0].actualHours).toBe(22.5);
  });
});
