import { describe, expect, it } from "vitest";
import { diffDailySnapshots, type ModuleSnap, type ProjectSnap } from "@shared/dailyDiff";

const project = (over: Partial<ProjectSnap> = {}): ProjectSnap => ({
  projectId: 1, projectCode: "122", projectName: "Projeto A", client: "Cliente",
  status: "verde", plannedHours: 100, actualHours: 40, completionPct: 40, totalActivities: 10, ...over,
});
const mod = (over: Partial<ModuleSnap> = {}): ModuleSnap => ({
  projectId: 1, managementName: "Gestão 30", moduleName: "Implantação", plannedHours: 50, actualHours: 22.5, completionPct: 45, ...over,
});

describe("comparação diária", () => {
  it("calcula as horas apontadas no dia como diferença entre as fotos", () => {
    const { projects, totals } = diffDailySnapshots(
      [project()], [project({ actualHours: 46.25, completionPct: 46.25 })],
      [mod()], [mod({ actualHours: 28.75 })],
    );
    expect(projects[0].kind).toBe("alterado");
    expect(projects[0].actualDelta).toBe(6.25);
    expect(projects[0].modules[0]).toMatchObject({ moduleName: "Implantação", actualDelta: 6.25 });
    expect(totals.actualDelta).toBe(6.25);
  });

  it("não soma níveis: usa o valor do módulo como está, sem agregação", () => {
    const { projects } = diffDailySnapshots([project()], [project()], [mod(), mod({ moduleName: "Treinamento", actualHours: 10 })], [mod(), mod({ moduleName: "Treinamento", actualHours: 12 })]);
    expect(projects[0].modules).toHaveLength(1);
    expect(projects[0].modules[0].actualDelta).toBe(2);
  });

  it("identifica dia sem mudança", () => {
    const { projects, totals } = diffDailySnapshots([project()], [project()], [mod()], [mod()]);
    expect(projects[0].kind).toBe("sem_mudanca");
    expect(totals.changed).toBe(0);
    expect(totals.actualDelta).toBe(0);
  });

  it("projeto novo e removido ficam fora do total de horas do dia", () => {
    const { projects, totals } = diffDailySnapshots(
      [project({ projectId: 1 }), project({ projectId: 2, projectCode: "200", actualHours: 500 })],
      [project({ projectId: 1, actualHours: 41 }), project({ projectId: 3, projectCode: "300", actualHours: 900 })],
    );
    expect(projects.find((p) => p.projectId === 2)?.kind).toBe("removido");
    expect(projects.find((p) => p.projectId === 3)?.kind).toBe("novo");
    expect(totals).toMatchObject({ added: 1, removed: 1, actualDelta: 1 });
  });

  it("sinaliza correção na origem (horas diminuíram) e mudança de status", () => {
    const { projects, totals } = diffDailySnapshots([project()], [project({ actualHours: 38, status: "amarelo" })]);
    expect(projects[0].actualDelta).toBe(-2);
    expect(projects[0].statusChanged).toBe(true);
    expect(totals.corrections).toBe(1);
  });

  it("ordena pelos maiores movimentos de horas", () => {
    const { projects } = diffDailySnapshots(
      [project({ projectId: 1 }), project({ projectId: 2, projectCode: "200" })],
      [project({ projectId: 1, actualHours: 41 }), project({ projectId: 2, projectCode: "200", actualHours: 60 })],
    );
    expect(projects.map((p) => p.projectId)).toEqual([2, 1]);
  });
});
