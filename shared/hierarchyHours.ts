export type HierarchyHoursRow = {
  level?: unknown;
  managementCode?: unknown;
  managementName?: unknown;
  moduleCode?: unknown;
  moduleName?: unknown;
  ppsaCode?: unknown;
  ppsaId?: unknown;
  parentPpsaId?: unknown;
  plannedHours?: unknown;
  plannedModuleHours?: unknown;
  actualHours?: unknown;
  moduleActualHours?: unknown;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function moduleKey(row: HierarchyHoursRow): string {
  const management = textValue(row.managementCode ?? row.managementName, "SEM_GESTAO");
  const module = textValue(row.moduleCode ?? row.moduleName, "SEM_MODULO");
  if (management === "SEM_GESTAO" && module === "SEM_MODULO") {
    return `SEM_MODULO|${textValue(row.ppsaId ?? row.ppsaCode, "SEM_PPSA")}`;
  }
  return `${management}|${module}`;
}

function ppsaKey(row: HierarchyHoursRow): string {
  return `${moduleKey(row)}|${textValue(row.ppsaId ?? row.ppsaCode, "SEM_PPSA")}`;
}

function highestLevel(rows: HierarchyHoursRow[]): number {
  return [1, 2, 3, 4].find((level) => rows.some((row) => numberValue(row.level) === level)) ?? 0;
}

function representative<T extends HierarchyHoursRow>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((left, right) => {
    const moduleActual = numberValue(right.moduleActualHours) - numberValue(left.moduleActualHours);
    if (moduleActual !== 0) return moduleActual;
    const actual = numberValue(right.actualHours) - numberValue(left.actualHours);
    if (actual !== 0) return actual;
    return numberValue(right.plannedHours) - numberValue(left.plannedHours);
  })[0] ?? null;
}

function groupByModule<T extends HierarchyHoursRow>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  rows.forEach((row) => {
    const key = moduleKey(row);
    result.set(key, [...(result.get(key) || []), row]);
  });
  return result;
}

/**
 * Retorna uma representação de cada PPSA da camada canônica, sem somar os
 * valores propagados de pai e filho. A camada escolhida é N1; se o módulo não
 * possui N1, usa N2, depois N3 e N4.
 */
export function canonicalHierarchyRows<T extends HierarchyHoursRow>(rows: T[]): T[] {
  const result: T[] = [];
  for (const moduleRows of Array.from(groupByModule(rows).values())) {
    const level = highestLevel(moduleRows);
    const selected = level > 0 ? moduleRows.filter((row) => numberValue(row.level) === level) : moduleRows;
    if (level === 1) {
      const row = representative(selected);
      if (row) result.push(row);
      continue;
    }
    const byPpsa = new Map<string, T[]>();
    selected.forEach((row) => byPpsa.set(ppsaKey(row), [...(byPpsa.get(ppsaKey(row)) || []), row]));
    for (const ppsaRows of Array.from(byPpsa.values())) {
      const row = representative(ppsaRows);
      if (row) result.push(row);
    }
  }
  return result;
}

/** Total executivo: soma HORAS_REALIZADAS_MODULO uma vez por módulo. */
export function sumCanonicalActualHours<T extends HierarchyHoursRow>(rows: T[]): number {
  let total = 0;
  for (const moduleRows of Array.from(groupByModule(rows).values())) {
    const moduleActual = Math.max(...moduleRows.map((row) => numberValue(row.moduleActualHours)), 0);
    if (moduleActual > 0) {
      total += moduleActual;
      continue;
    }
    total += canonicalHierarchyRows(moduleRows).reduce((sum, row) => sum + numberValue(row.actualHours), 0);
  }
  return Number(total.toFixed(2));
}

export function canonicalActualRows<T extends HierarchyHoursRow>(rows: T[]): T[] {
  return canonicalHierarchyRows(rows);
}

export function canonicalPlannedHours(row: HierarchyHoursRow): number {
  const modulePlan = numberValue(row.plannedModuleHours);
  return numberValue(row.level) === 1 && modulePlan > 0 ? modulePlan : numberValue(row.plannedHours);
}

/** Total executivo: capacidade HORAS_MODULO_PLANEJADAS uma vez por módulo. */
export function sumCanonicalPlannedHours<T extends HierarchyHoursRow>(rows: T[]): number {
  let total = 0;
  for (const moduleRows of Array.from(groupByModule(rows).values())) {
    const modulePlan = Math.max(...moduleRows.map((row) => numberValue(row.plannedModuleHours)), 0);
    if (modulePlan > 0) {
      total += modulePlan;
      continue;
    }
    total += canonicalHierarchyRows(moduleRows).reduce((sum, row) => sum + numberValue(row.plannedHours), 0);
  }
  return Number(total.toFixed(2));
}
