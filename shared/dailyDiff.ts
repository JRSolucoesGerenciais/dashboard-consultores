/**
 * Comparação dia a dia entre duas fotos do portfólio.
 *
 * Regra Rev07: nada aqui soma níveis hierárquicos. Cada foto já traz os valores
 * oficiais por projeto e por Gestão/Módulo; a diferença é calculada valor a valor.
 */
export type ProjectSnap = {
  projectId: number;
  projectCode: string;
  projectName: string;
  client: string;
  status: string;
  plannedHours: number;
  actualHours: number;
  completionPct: number;
  totalActivities: number;
};

export type ModuleSnap = {
  projectId: number;
  managementName: string;
  moduleName: string;
  plannedHours: number;
  actualHours: number;
  completionPct: number;
};

export type ModuleDiff = {
  managementName: string;
  moduleName: string;
  kind: "novo" | "removido" | "alterado";
  actualFrom: number;
  actualTo: number;
  actualDelta: number;
  plannedFrom: number;
  plannedTo: number;
  plannedDelta: number;
  completionDelta: number;
};

export type ProjectDiff = {
  projectId: number;
  projectCode: string;
  projectName: string;
  client: string;
  kind: "novo" | "removido" | "alterado" | "sem_mudanca";
  actualFrom: number;
  actualTo: number;
  /** Horas apontadas entre as duas fotos (negativo = correção na origem). */
  actualDelta: number;
  plannedFrom: number;
  plannedTo: number;
  plannedDelta: number;
  completionDelta: number;
  activitiesDelta: number;
  statusFrom: string | null;
  statusTo: string | null;
  statusChanged: boolean;
  modules: ModuleDiff[];
};

export type DailyDiffTotals = {
  projects: number;
  changed: number;
  added: number;
  removed: number;
  actualDelta: number;
  plannedDelta: number;
  corrections: number;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const EPS = 0.005;

function diffModules(prev: ModuleSnap[], curr: ModuleSnap[]): ModuleDiff[] {
  const keyOf = (m: ModuleSnap) => `${m.managementName}|${m.moduleName}`;
  const before = new Map(prev.map((m) => [keyOf(m), m]));
  const after = new Map(curr.map((m) => [keyOf(m), m]));
  const out: ModuleDiff[] = [];
  for (const key of Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]))) {
    const a = before.get(key);
    const b = after.get(key);
    const ref = (b ?? a)!;
    const diff: ModuleDiff = {
      managementName: ref.managementName,
      moduleName: ref.moduleName,
      kind: !a ? "novo" : !b ? "removido" : "alterado",
      actualFrom: a?.actualHours ?? 0,
      actualTo: b?.actualHours ?? 0,
      actualDelta: round2((b?.actualHours ?? 0) - (a?.actualHours ?? 0)),
      plannedFrom: a?.plannedHours ?? 0,
      plannedTo: b?.plannedHours ?? 0,
      plannedDelta: round2((b?.plannedHours ?? 0) - (a?.plannedHours ?? 0)),
      completionDelta: round2((b?.completionPct ?? 0) - (a?.completionPct ?? 0)),
    };
    const changed = diff.kind !== "alterado" || Math.abs(diff.actualDelta) > EPS || Math.abs(diff.plannedDelta) > EPS || Math.abs(diff.completionDelta) > EPS;
    if (changed) out.push(diff);
  }
  return out.sort((l, r) => Math.abs(r.actualDelta) - Math.abs(l.actualDelta));
}

export function diffDailySnapshots(
  prevProjects: ProjectSnap[],
  currProjects: ProjectSnap[],
  prevModules: ModuleSnap[] = [],
  currModules: ModuleSnap[] = [],
): { projects: ProjectDiff[]; totals: DailyDiffTotals } {
  const before = new Map(prevProjects.map((p) => [p.projectId, p]));
  const after = new Map(currProjects.map((p) => [p.projectId, p]));
  const modulesOf = (rows: ModuleSnap[], id: number) => rows.filter((m) => m.projectId === id);

  const projects: ProjectDiff[] = [];
  for (const id of Array.from(new Set([...Array.from(before.keys()), ...Array.from(after.keys())]))) {
    const a = before.get(id);
    const b = after.get(id);
    const ref = (b ?? a)!;
    const modules = diffModules(modulesOf(prevModules, id), modulesOf(currModules, id));
    const base = {
      projectId: id,
      projectCode: ref.projectCode,
      projectName: ref.projectName,
      client: ref.client,
      actualFrom: a?.actualHours ?? 0,
      actualTo: b?.actualHours ?? 0,
      actualDelta: round2((b?.actualHours ?? 0) - (a?.actualHours ?? 0)),
      plannedFrom: a?.plannedHours ?? 0,
      plannedTo: b?.plannedHours ?? 0,
      plannedDelta: round2((b?.plannedHours ?? 0) - (a?.plannedHours ?? 0)),
      completionDelta: round2((b?.completionPct ?? 0) - (a?.completionPct ?? 0)),
      activitiesDelta: (b?.totalActivities ?? 0) - (a?.totalActivities ?? 0),
      statusFrom: a?.status ?? null,
      statusTo: b?.status ?? null,
      statusChanged: Boolean(a && b && a.status !== b.status),
      modules,
    };
    const changed =
      Math.abs(base.actualDelta) > EPS || Math.abs(base.plannedDelta) > EPS || Math.abs(base.completionDelta) > EPS ||
      base.activitiesDelta !== 0 || base.statusChanged || modules.length > 0;
    projects.push({
      ...base,
      kind: !a ? "novo" : !b ? "removido" : changed ? "alterado" : "sem_mudanca",
    });
  }

  projects.sort((l, r) => Math.abs(r.actualDelta) - Math.abs(l.actualDelta) || l.projectCode.localeCompare(r.projectCode));
  const totals: DailyDiffTotals = {
    projects: projects.length,
    changed: projects.filter((p) => p.kind !== "sem_mudanca").length,
    added: projects.filter((p) => p.kind === "novo").length,
    removed: projects.filter((p) => p.kind === "removido").length,
    // Projetos novos/removidos não entram no total de horas do dia: não há ponto de comparação.
    actualDelta: round2(projects.filter((p) => p.kind === "alterado" || p.kind === "sem_mudanca").reduce((sum, p) => sum + p.actualDelta, 0)),
    plannedDelta: round2(projects.filter((p) => p.kind === "alterado" || p.kind === "sem_mudanca").reduce((sum, p) => sum + p.plannedDelta, 0)),
    corrections: projects.filter((p) => p.actualDelta < -EPS).length,
  };
  return { projects, totals };
}
