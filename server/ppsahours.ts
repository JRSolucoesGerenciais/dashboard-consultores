import { sumCanonicalActualHours, sumCanonicalPlannedHours } from "../shared/hierarchyHours";

export type PpsaInputRow = {
  projectKey: string;
  ppsaCode: string;
  level: number;
  topCode?: unknown;
  processCode?: unknown;
  plannedHours: unknown;
  actualHours: unknown;
  raw: Record<string, any>;
};

export type CanonicalPpsaRow = PpsaInputRow & {
  plannedHours: number;
  actualHours: number;
  sourceRows: number;
};

export type PpsaProjectTotals = {
  plannedHours: number;
  actualHours: number;
  selectedLevel: number;
  canonicalRows: number;
  duplicateRowsRemoved: number;
};

/**
 * A SQL RevAtual adiciona linhas por Gestão/Módulo fora do cronograma e também
 * pode trazer apontamentos avulsos sem PPSA. Nenhuma dessas linhas é PPSA e
 * elas não podem virar Nível 1 por fallback de campo nulo.
 */
export function isOutsideScopeRow(row: Record<string, any>): boolean {
  const hasPpsa = String(row.CODPPSA ?? "").trim() !== "" || String(row.IDPPSA ?? "").trim() !== "";
  const hasCronogram = String(row.IDPROJETOCRONOGRAMA ?? "").trim() !== "";
  return !hasPpsa && !hasCronogram;
}

export function canonicalizePersistedPpsaRows<T extends {
  projectId: number;
  ppsaCode: string;
  level: number;
  sourceProjectCode: number | null;
  sourceProcessCode: number | null;
  plannedHours: unknown;
  actualHours: unknown;
  [key: string]: any;
}>(rows: T[]): T[] {
  const byProject = new Map<number, T[]>();
  rows.forEach((row) => byProject.set(row.projectId, [...(byProject.get(row.projectId) || []), row]));
  const result: T[] = [];
  for (const projectRows of Array.from(byProject.values())) {
    const sourceIsFinalSql = projectRows.some((row) => {
      const source = String(row.sourceSheet || "").toUpperCase();
      return source.includes("SQL FINAL") || source.includes("REV06") || source.includes("REV07") || source.includes("REV ATUAL") || source.includes("REV_ATUAL") || source.includes("SQL VIEW");
    });
    const consolidated = consolidatePpsaRows(projectRows.map((row) => ({
      projectKey: String(row.projectId),
      ppsaCode: row.ppsaCode,
      level: row.level,
      topCode: row.sourceProjectCode,
      processCode: row.sourceProcessCode,
      plannedHours: row.plannedHours,
      actualHours: row.actualHours,
      raw: row,
    })), { applyHierarchyCorrection: !sourceIsFinalSql });
    result.push(...consolidated.rows.map((item) => {
      const row = item.raw as T;
      const planned = item.plannedHours;
      const actual = item.actualHours;
      const completion = planned > 0 ? Number(((actual / planned) * 100).toFixed(2)) : null;
      const overrun = completion === null
        ? row.hoursOverrunStatus
        : completion > 100
          ? `ESTOURO DE HORAS (${completion.toFixed(2)}%)`
          : completion === 100
            ? "REALIZADO CONFERE COM O PLANEJADO (100%)"
            : `SALDO DE HORAS (${(100 - completion).toFixed(2)}%)`;
      return {
        ...row,
        plannedHours: planned.toFixed(2),
        actualHours: actual.toFixed(2),
        hoursCompletionPct: completion === null ? row.hoursCompletionPct : completion.toFixed(2),
        hoursOverrunStatus: overrun,
      };
    }));
  }
  return result.sort((left, right) => left.ppsaCode.localeCompare(right.ppsaCode, undefined, { numeric: true }));
}

export function parsePpsaHours(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text || text === ":" || text === "-") return 0;
  if (text.includes(":")) {
    const [hours, minutes] = text.split(":");
    return Math.round(((Number.parseFloat(hours) || 0) + (Number.parseFloat(minutes) || 0) / 60) * 100) / 100;
  }
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keyPart(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function hierarchyScope(row: PpsaInputRow) {
  const parts = row.ppsaCode.split(".");
  return {
    top: keyPart(row.topCode, parts[0] || "0"),
    process: keyPart(row.processCode, parts[1] || "0"),
  };
}

function rowScore(row: PpsaInputRow) {
  return (
    (parsePpsaHours(row.plannedHours) > 0 ? 2 : 0) +
    (parsePpsaHours(row.actualHours) > 0 ? 2 : 0) +
    (row.raw.DESCRICAO || row.raw.description ? 1 : 0) +
    (row.raw.INICIO_PROGRAMADO || row.raw.plannedStart ? 1 : 0)
  );
}

function hasSourcePlannedHours(row: PpsaInputRow): boolean {
  if (typeof row.raw.__PPSA_HAS_SOURCE_PLANNED_HOURS === "boolean") {
    return row.raw.__PPSA_HAS_SOURCE_PLANNED_HOURS;
  }
  const sourceValue = row.raw.TOTAL_HORA_DIAS_PROGRAMADOS ?? row.raw.plannedHoursText;
  return parsePpsaHours(sourceValue) > 0;
}

/**
 * Consolida o retorno da API/planilha em uma linha por projeto + código PPSA + nível.
 * Repetições causadas por joins de cronograma não são somadas: horas repetidas usam o
 * maior valor observado, evitando inflar planejado/realizado. Conflitos de nível são
 * preservados para a árvore, mas nunca entram juntos nos totalizadores.
 */
export function consolidatePpsaRows(inputRows: PpsaInputRow[], options?: { applyHierarchyCorrection?: boolean }): {
  rows: CanonicalPpsaRow[];
  totalsByProject: Map<string, PpsaProjectTotals>;
} {
  const grouped = new Map<string, PpsaInputRow[]>();
  for (const row of inputRows) {
    const key = `${row.projectKey}|${row.ppsaCode}|${row.level}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const rows: CanonicalPpsaRow[] = Array.from(grouped.values()).map((group) => {
    const representative = [...group].sort((left, right) => rowScore(right) - rowScore(left))[0];
    const plannedHours = Math.max(...group.map((row) => parsePpsaHours(row.plannedHours)));
    const actualHours = Math.max(...group.map((row) => parsePpsaHours(row.actualHours)));
    return {
      ...representative,
      plannedHours: Number(plannedHours.toFixed(2)),
      actualHours: Number(actualHours.toFixed(2)),
      sourceRows: group.length,
    };
  });

  const applyHierarchyCorrection = options?.applyHierarchyCorrection !== false;
  const level3Sums = new Map<string, number>();
  rows.filter((row) => row.level === 3).forEach((row) => {
    const scope = hierarchyScope(row);
    const key = `${row.projectKey}|${scope.top}|${scope.process}`;
    level3Sums.set(key, (level3Sums.get(key) || 0) + row.plannedHours);
  });

  const level2Effective = new Map<string, number>();
  rows.filter((row) => row.level === 2).forEach((row) => {
    const scope = hierarchyScope(row);
    const scopeKey = `${row.projectKey}|${scope.top}|${scope.process}`;
    const effective = hasSourcePlannedHours(row)
      ? row.plannedHours
      : level3Sums.has(scopeKey)
        ? level3Sums.get(scopeKey)!
        : row.plannedHours;
    level2Effective.set(`${row.projectKey}|${row.ppsaCode}|${row.level}`, Number(effective.toFixed(2)));
  });

  const level2Sums = new Map<string, number>();
  rows.filter((row) => row.level === 2).forEach((row) => {
    const scope = hierarchyScope(row);
    const key = `${row.projectKey}|${scope.top}`;
    level2Sums.set(key, (level2Sums.get(key) || 0) + (level2Effective.get(`${row.projectKey}|${row.ppsaCode}|${row.level}`) || 0));
  });

  const correctedRows = applyHierarchyCorrection ? rows.map((row) => {
    const scope = hierarchyScope(row);
    const key = `${row.projectKey}|${scope.top}`;
    const rowKey = `${row.projectKey}|${row.ppsaCode}|${row.level}`;
    const plannedHours = row.level === 2
      ? level2Effective.get(rowKey) ?? row.plannedHours
      : row.level === 1
        ? hasSourcePlannedHours(row)
          ? row.plannedHours
          : level2Sums.has(key) ? level2Sums.get(key)! : row.plannedHours
        : row.plannedHours;
    return { ...row, plannedHours: Number(plannedHours.toFixed(2)) };
  }) : rows;

  const totalsByProject = new Map<string, PpsaProjectTotals>();
  const projectKeys = Array.from(new Set(correctedRows.map((row) => row.projectKey)));
  for (const projectKey of projectKeys) {
    const projectRows = correctedRows.filter((row) => row.projectKey === projectKey);
    const selectedLevel = projectRows.some((row) => row.level === 1)
      ? 1
      : projectRows.some((row) => row.level === 2)
        ? 2
        : projectRows.some((row) => row.level === 3)
          ? 3
          : 0;
    const selected = projectRows.filter((row) => row.level === selectedLevel);
    const canonicalActual = sumCanonicalActualHours(selected.map((row) => ({
      level: row.level,
      managementCode: row.raw.CODGESTAO,
      moduleName: row.raw.CODMODULO,
      ppsaCode: row.ppsaCode,
      actualHours: row.actualHours,
    })));
    totalsByProject.set(projectKey, {
      plannedHours: Number(selected.reduce((sum, row) => sum + row.plannedHours, 0).toFixed(2)),
      actualHours: canonicalActual,
      selectedLevel,
      canonicalRows: projectRows.length,
      duplicateRowsRemoved: projectRows.reduce((sum, row) => sum + Math.max(0, row.sourceRows - 1), 0),
    });
  }

  return { rows: correctedRows, totalsByProject };
}

export function toPpsaInputRow(
  projectKey: string,
  row: Record<string, any>,
  fallbackIndex: number,
): PpsaInputRow {
  const outsideScope = isOutsideScopeRow(row);
  const management = String(row.CODGESTAO ?? "SEM_GESTAO").trim() || "SEM_GESTAO";
  const module = String(row.CODMODULO ?? "SEM_MODULO").trim() || "SEM_MODULO";
  const ppsaCode = String(row.CODPPSA || (outsideScope
    ? `FORA_ESCOPO_${management}_${module}`
    : `${row.PROJETO || ""}.${row.PROCESSO || ""}.${row.SUBPROCESSO || ""}.${row.ATIVIDADE || fallbackIndex + 1}`)).slice(0, 80);
  return {
    projectKey,
    ppsaCode: ppsaCode || `ROW-${fallbackIndex + 1}`,
    level: outsideScope ? 0 : Number(row.NIVEL ?? 1) || 1,
    topCode: row.PROJETO,
    processCode: row.PROCESSO,
    plannedHours: row.HORAS_ATIVIDADE_PLANEJADAS_DECIMAL ?? row.HORAS_ATIVIDADE_PLANEJADAS ?? row.TOTAL_HORA_DIAS_PROGRAMADOS,
    actualHours: row.HORAS_REALIZADAS_CONSOLIDADAS_DECIMAL ?? row.HORAS_TOTAL,
    raw: row,
  };
}

export type ManagementModuleSummaryItem = {
  level: number;
  managementKey: string;
  managementCode: number | null;
  managementName: string;
  moduleKey: string;
  moduleName: string;
  ppsaCount: number;
  ppsaCodes: string[];
  plannedHours: number;
  actualHours: number;
  balanceHours: number;
  hoursProgressPct: number;
  plannedDays: number;
  plannedWeeks: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  status: "concluido" | "em_andamento" | "nao_iniciado" | "atrasado";
};

export function buildManagementModuleSummary<T extends {
  ppsaCode: string;
  level: number;
  managementCode?: number | null;
  managementName?: string | null;
  moduleName?: string | null;
  plannedHours?: unknown;
  plannedModuleHours?: unknown;
  actualHours?: unknown;
  moduleActualHours?: unknown;
  moduleSummaryPlannedHours?: unknown;
  moduleSummaryActualHours?: unknown;
  moduleSummaryCompletionPct?: unknown;
  managementSummaryPlannedHours?: unknown;
  managementSummaryActualHours?: unknown;
  managementSummaryCompletionPct?: unknown;
  plannedDays?: unknown;
  plannedWeeks?: unknown;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  status?: string | null;
}>(
  rows: T[],
  officialTotals?: { plannedHours?: number | null; actualHours?: number | null } | null,
  options?: { preserveLevels?: boolean }
): ManagementModuleSummaryItem[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const mgmtCode = row.managementCode ?? null;
    const mgmtName = (row.managementName || (mgmtCode ? `Gestão ${mgmtCode}` : "Gestão Geral")).trim();
    const modName = (row.moduleName || "Módulo Geral").trim();
    const key = options?.preserveLevels
      ? `${mgmtCode ?? "SEM_CODIGO"}|${mgmtName}|${modName}|N${row.level}`
      : `${mgmtCode ?? "SEM_CODIGO"}|${mgmtName}|${modName}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const items: ManagementModuleSummaryItem[] = [];

  for (const [key, groupRows] of Array.from(groups.entries())) {
    const first = groupRows[0];
    const mgmtCode = first.managementCode ?? null;
    const mgmtName = (first.managementName || (mgmtCode ? `Gestão ${mgmtCode}` : "Gestão Geral")).trim();
    const modName = (first.moduleName || "Módulo Geral").trim();
    const level = options?.preserveLevels
      ? first.level
      : ([2, 1, 3, 4].find((candidate) => groupRows.some((row) => row.level === candidate)) ?? groupRows[0]?.level ?? 0);
    const summaryRows = options?.preserveLevels ? groupRows : groupRows.filter((row) => row.level === level);
    const rowsForDisplay = summaryRows.length > 0 ? summaryRows : groupRows;
    const maxProvided = (values: unknown[]) => {
      const parsed = values.map(parsePpsaHours).filter((value) => value > 0);
      return parsed.length > 0 ? Math.max(...parsed) : null;
    };
    const distinctPpsaN1 = !options?.preserveLevels &&
      rowsForDisplay.every((row) => row.level === 1) &&
      rowsForDisplay.length > 1 &&
      new Set(rowsForDisplay.map((row) => row.ppsaCode)).size === rowsForDisplay.length;

    const plannedHours = options?.preserveLevels
      ? (first.level === 1 && maxProvided(groupRows.map((r) => r.plannedModuleHours)) != null
          ? maxProvided(groupRows.map((r) => r.plannedModuleHours))!
          : Number(groupRows.reduce((sum, r) => sum + parsePpsaHours(r.plannedHours), 0).toFixed(2)))
      : (maxProvided(groupRows.map((r) => r.moduleSummaryPlannedHours))
        ?? (distinctPpsaN1 && maxProvided(groupRows.map((r) => r.plannedModuleHours)) == null
          ? Number(rowsForDisplay.reduce((sum, r) => sum + parsePpsaHours(r.plannedHours), 0).toFixed(2))
          : maxProvided(groupRows.map((r) => r.plannedModuleHours)))
        ?? Number(sumCanonicalPlannedHours(rowsForDisplay.map((row) => ({
          level: row.level,
          managementCode: row.managementCode,
          managementName: row.managementName,
          moduleName: row.moduleName,
          ppsaCode: row.ppsaCode,
          plannedHours: row.plannedHours,
          plannedModuleHours: row.plannedModuleHours,
        }))).toFixed(2)));

    const actualHours = options?.preserveLevels
      ? (maxProvided(groupRows.map((r) => r.moduleActualHours))
          ?? (first.level === 1 && groupRows.length > 1 && new Set(groupRows.map((r) => parsePpsaHours(r.actualHours))).size === 1
            ? Number(parsePpsaHours(groupRows[0].actualHours).toFixed(2))
            : Number(Array.from(
                groupRows.reduce((acc, row) => {
                  acc.set(row.ppsaCode, Math.max(acc.get(row.ppsaCode) || 0, parsePpsaHours(row.actualHours)));
                  return acc;
                }, new Map<string, number>()).values(),
              ).reduce((sum, value) => sum + value, 0).toFixed(2))))
      : (maxProvided(groupRows.map((r) => r.moduleSummaryActualHours))
        ?? maxProvided(groupRows.map((r) => r.moduleActualHours))
        ?? (distinctPpsaN1 && new Set(rowsForDisplay.map((r) => parsePpsaHours(r.actualHours))).size === 1
          ? Number(parsePpsaHours(rowsForDisplay[0].actualHours).toFixed(2))
          : sumCanonicalActualHours(rowsForDisplay.map((row) => ({
            level: row.level,
            managementCode: row.managementCode,
            managementName: row.managementName,
            moduleName: row.moduleName,
            ppsaCode: row.ppsaCode,
            actualHours: row.actualHours,
          })))));
    const balanceHours = Number((plannedHours - actualHours).toFixed(2));
    const hoursProgressPct = plannedHours > 0 ? Number(((actualHours / plannedHours) * 100).toFixed(2)) : 0;

    const plannedDays = Number(
      (options?.preserveLevels
        ? groupRows.reduce((sum, r) => sum + (Number(r.plannedDays) || 0), 0)
        : Math.max(...rowsForDisplay.map((r) => Number(r.plannedDays) || 0), 0)
      ).toFixed(2)
    );
    const officialWeeks = groupRows
      .map((r) => Number(r.plannedWeeks))
      .filter((value) => Number.isFinite(value) && value > 0);
    const plannedWeeks = officialWeeks.length
      ? Number((options?.preserveLevels || distinctPpsaN1 ? officialWeeks.reduce((sum, value) => sum + value, 0) : Math.max(...officialWeeks)).toFixed(2))
      : null;

    const validPlannedStarts = groupRows.map((r) => r.plannedStart).filter((d): d is string => Boolean(d && d !== "Sem data" && !d.startsWith("0000")));
    const validPlannedEnds = groupRows.map((r) => r.plannedEnd).filter((d): d is string => Boolean(d && d !== "Sem data" && !d.startsWith("0000")));
    const validActualStarts = groupRows.map((r) => r.actualStart).filter((d): d is string => Boolean(d && d !== "Sem data" && !d.startsWith("0000")));
    const validActualEnds = groupRows.map((r) => r.actualEnd).filter((d): d is string => Boolean(d && d !== "Sem data" && !d.startsWith("0000")));

    const plannedStart = validPlannedStarts.length ? [...validPlannedStarts].sort()[0] : null;
    const plannedEnd = validPlannedEnds.length ? [...validPlannedEnds].sort().slice(-1)[0] : null;
    const actualStart = validActualStarts.length ? [...validActualStarts].sort()[0] : null;
    const actualEnd = validActualEnds.length ? [...validActualEnds].sort().slice(-1)[0] : null;

    const statuses = groupRows.map((r) => r.status || "nao_iniciado");
    const allDone = statuses.length > 0 && statuses.every((s) => s === "concluido");
    const hasDelay = statuses.some((s) => s === "atrasado");
    const hasProgress = statuses.some((s) => s === "em_andamento" || s === "concluido");
    const status: ManagementModuleSummaryItem["status"] = allDone
      ? "concluido"
      : hasDelay
        ? "atrasado"
        : hasProgress
          ? "em_andamento"
          : "nao_iniciado";

    items.push({
      level,
      managementKey: `${mgmtCode ?? "0"}-${mgmtName}`,
      managementCode: mgmtCode,
      managementName: mgmtName,
      moduleKey: modName,
      moduleName: modName,
      ppsaCount: new Set(rowsForDisplay.map((r) => r.ppsaCode)).size,
      ppsaCodes: Array.from(new Set(rowsForDisplay.map((r) => r.ppsaCode))),
      plannedHours,
      actualHours,
      balanceHours,
      hoursProgressPct,
      plannedDays,
      plannedWeeks,
      plannedStart,
      plannedEnd,
      actualStart,
      actualEnd,
      status,
    });
  }

  return items.sort((a, b) => {
    const mgmtComp = (a.managementCode ?? 999) - (b.managementCode ?? 999);
    if (mgmtComp !== 0) return mgmtComp;
    const moduleComp = a.moduleName.localeCompare(b.moduleName);
    return moduleComp !== 0 ? moduleComp : a.level - b.level;
  });
}
